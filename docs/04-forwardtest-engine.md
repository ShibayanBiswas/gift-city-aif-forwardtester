# 04 — Forward Test Engine

The Forward Test Engine is a deterministic numpy pipeline under `backend/app/engine/`. It reproduces WF1 **As per HS + Computation** methodology for every forward path, with **Geometric Brownian Motion** spots from today’s as-of close through **Simulation End**.

**Authority:** WF1 formulas override Notes where they differ. Verification: [07-verification.md](07-verification.md).

---

## Pipeline Overview

```
Product Excel (Product_Input_File.xlsx or upload)
 │
 ▼
 product.py parse → ProductSpec · Simulation End Days (default 3650)
 │
 ▼
 market.py Nifty · expiries · rolls (CSV + LRU cache)
 market_sync.py auto-extend historical series to present on startup / /api/sync
 │
 ▼
 forward_calendar.py + paths.py
   As-of = latest Nifty session (dynamic after deploy)
   Simulation End = as-of + Simulation End Days
   Forward sessions = Mon–Fri only (Sat/Sun closed)
   Forward rolls = last trading day of each month
   Forward monthly expiries = last Tuesday of each month
   Path 1 starts at as-of; final path ends on Simulation End
 │
 ▼
 For each path: GBM spots → hedge.py → nav.py  (same as Backtester)
 │
 ▼
 forwardtest.py run_forwardtest · KPIs · Intel desk market through Simulation End
```

Intel `/api/market/{nifty,expiries,rolls}` serves **as-of → Simulation End** only, with Path One GBM forward closes and the forward calendars above.

Sheet mirror reference: [02-excel-sheet-logic.md](02-excel-sheet-logic.md). API wiring: [05-architecture.md](05-architecture.md).

---

## Engine Module Map

| Module | File | Responsibility |
|--------|------|----------------|
| Product parser | `product.py` | Excel → `ProductSpec`, Simulation End Days, legs |
| Market loader | `market.py` | Historical CSV load, `nifty_on`, roll model, LRU cache |
| Market sync | `market_sync.py` | Yahoo `^NSEI` append through present; historical calendars |
| Forward calendar | `forward_calendar.py` | Mon–Fri pad, month-end rolls, last-Tuesday expiries, Path-1 GBM closes |
| GBM | `gbm.py` | Estimate μ/σ from history; per-path `gbm_spots` |
| Path builder | `paths.py` | Staggered forward tenure windows from as-of → Simulation End |
| Expiry builder | `calendar_build.py` | Historical NSE expiries (Thu→Tue era); `month_ends` for leap/30/31 |
| Hedging | `hedge.py` | Observations, legs, required futures delta (Backtester-identical) |
| Black–Scholes | `black_scholes.py` | Forward/discount puts, central ±0.5 delta |
| NAV / Computation | `nav.py` | Futures inventory, MTM, rolls, cash, Gsec, fees, tx, total, IRR |
| Orchestration | `forwardtest.py` | `run_forwardtest`, path detail |
| Runtime | `runtime.py` | Process / thread / serial workers |

---

## 1. Dynamic as-of and Simulation End

| Concept | Rule |
|---------|------|
| **As-of** | `market.last_date` after CSV load + Yahoo sync = latest Nifty session (**As Of Today** in the header strip) |
| **Simulation End Days** | Product Input field (default **3650**); must be > tenure days |
| **Simulation End** | `asof + Simulation End Days` (calendar). Final path ends on the last Mon–Fri on/before this date |
| **Trading Days / Monthly Expiries** | Header counts for **as-of → Simulation End** only (not full 2001→present history) |
| After deploy | Startup + `/api/sync` refresh Nifty; as-of and horizon move with the live calendar |

Header chips (horizontal scroll): **As Of Today** · **Simulation End** · **Simulation End Days** · **Trading Days** · **Monthly Expiries**.

---

## 2. Forward trading calendar (`forward_calendar.py`)

### Sessions (Nifty closes)

- From the day **after** as-of through Simulation End (plus a short pad for path tenure / observations).
- **Monday–Friday only.** Saturday and Sunday never receive a close.
- Real calendar stepping: January 31, April 30, February 28 / **29 in leap years** (e.g. 2028-02-29) are handled via `datetime` month arithmetic (`month_ends`).
- Forward pad does **not** model NSE holidays — every weekday is a session.

### Futures shift / roll (forward months)

- **Last trading day of each calendar month** = last Mon–Fri on/before the real month-end.
- Only **complete** months are emitted (true month-end weekday must lie on the trading calendar and on/before the horizon). Truncated pad months never invent a fake shift on the pad’s last day.
- Roll **cost** = same 7% average-spot × day-fraction model as the Backtester (`_recompute_roll_costs`), recomputed on forward GBM closes. Historical CSV seeds through as-of are preserved.

### Monthly Nifty option expiry (forward months)

- **Last Tuesday** of each calendar month.
- Same completeness guard as rolls (Tuesday must be on the calendar and ≤ horizon).

### Historical vs forward (do not conflate)

| Era | Sessions | Monthly expiry | Futures shift |
|-----|----------|----------------|---------------|
| Historical (≤ as-of) | Nifty CSV (holiday-aware) | NSE Thu→Tue via `calendar_build` + overrides | CSV / historical builder |
| Forward (> as-of) | Mon–Fri synthetic | Last Tuesday | Last trading day of month |

---

## 3. Paths (`paths.py`)

### Atlas rule

| Item | Behaviour |
|------|-----------|
| Path 1 start | **As-of** (latest Nifty close) |
| Start grid | Frequency: daily / weekly / monthly / quarterly / semi-annual between as-of and last start |
| Tenure end | Same Backtester rule: ~5Y anniversary floored to prior month-end when tenure ∈ [1700, 2000]; else `start + tenure_days` |
| Final path | Calendar end snapped to **last trading day on/before Simulation End** |
| Spots | GBM along **path trading days only** (no weekend prices); S₀ = live as-of Nifty |
| Hedge / NAV | Identical engines to Gift AIF Backtester; spots come from path GBM |

There are **no** Macro Paths CSV pins (235 historical windows). Those belong to the Backtester.

### Frequency start grids

| Frequency | Start rule |
|-----------|------------|
| **Daily** (UI default) | Every Mon–Fri session from as-of through last start |
| Weekly | First trading day of each ISO week |
| Monthly | First trading day of each calendar month |
| Quarterly / Semi-annual | First trading day of quarter / half-year |

Path count = f(frequency, Simulation End Days, tenure, observation months) — not a fixed dropdown.

---

## 4. Market history + sync (`market.py` + `market_sync.py`)

### Historical loads

| Asset | File | Notes |
|-------|------|-------|
| Nifty daily closes | `data/nifty_daily.csv` | Trading sessions from 2001-01-01 through as-of |
| Monthly expiries | `data/nifty_expiries.csv` | Historical monthly option dates |
| Expiry overrides | `data/expiry_overrides.csv` | WF1 option dates (authoritative 2004+) |
| Roll shifts + costs | `data/roll_costs.csv` | Historical futures shifts through as-of |

### Daily auto-sync

`market_sync.sync_market_to_present`

- Runs on **API startup** and every **`GET /api/sync`**
- Appends missing Yahoo `^NSEI` closes through today (weekends skipped)
- Extends **historical** roll + expiry calendars through last Nifty month
- Clears market LRU cache when data changes

Forward pad is built **in memory** by `extend_market_forward` / `build_forward_market` — not written back as CSV history.

CLI: `PYTHONPATH=backend .venv/Scripts/python scripts/sync_market_data.py`

---

## 5. Hedging Sheet (`hedge.py`) — Backtester parity

1. **`build_observation_details`** — For each month offset in product (`38…56` for sample)
   `target = path_start + m × 30.5` → map to monthly Nifty expiry + Nifty on expiry (path GBM spots floored on/before expiry).
2. **`build_legs`** — For each active leg × each observation: strike, vol (Near/Far), contract qty.
3. **`compute_req_delta`** — Central finite-difference BS delta; futures hedge inventory for NAV.

Vol Near on 1st observation; Vol Far thereafter — **path-invariant** book.

---

## 6. Computation / NAV (`nav.py`) — Backtester parity

Same daily ledger as the Backtester: futures inventory, MTM, 7% rolls (gated after last observation), cash, G-Sec, fees, transaction costs, Total, IRR. Only the **spot path** differs (GBM forward vs historical Nifty strip).

---

## 7. Intel desk market

| Sheet | Range | Content |
|-------|-------|---------|
| Nifty daily | as-of → Simulation End | Historical close on as-of; Path-1 GBM thereafter; Mon–Fri only |
| Monthly expiries | as-of → Simulation End | Forward = last Tuesdays; Nifty on expiry from desk market |
| Futures rolls | as-of → Simulation End | Forward = month-end trading days + 7% model costs |

See [02-excel-sheet-logic.md](02-excel-sheet-logic.md) for WF1 sheet names vs engine modules.
