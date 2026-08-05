# 04 — Forward Test Engine

The Forward Test Engine is a deterministic numpy pipeline under `backend/app/engine/`. It reproduces WF1 **As per HS + Computation** methodology for every forward path, with **Geometric Brownian Motion** spots from today’s as-of close through **Product End**.

**Authority:** WF1 formulas override Notes where they differ. Verification: [07-verification.md](07-verification.md).

---

## Pipeline Overview

```
Product Excel (Product_Input_File.xlsx or upload)
 │
 ▼
 product.py parse → ProductSpec · tenure · Monte Carlo Paths N (default 1000)
 │
 ▼
 market.py Nifty · expiries · rolls (CSV + LRU cache)
 market_sync.py auto-extend historical series to present on startup / /api/sync
 │
 ▼
 forward_calendar.py + paths.py + mc_matrix.py
   As-of = latest Nifty session (dynamic after deploy)
   Product End = path_end_calendar(asof, tenure)
   Forward sessions = Mon–Fri only (Sat/Sun closed; projected holidays excluded)
   Forward rolls = monthly option expiries (same as Expiry sheet)
   Forward monthly expiries = last Thu/Tue by NSE era (holiday → previous session)
   Every path: Start = as-of, End = Product End (N independent GBM seeds)
   Logical GBM matrix: rows = paths, columns = trading dates — **never held fully in RAM**
   Each path regenerates its GBM row from seed + params on demand
   μ / σ / drift re-estimated each Run from Nifty **2001-01-01 → as-of**
 │
 ▼
 For each path: simulate spots → hedge.py → nav.py  (same as Backtester)
 │
 ▼
 forwardtest.py run_forwardtest · KPIs · queued mc-matrix.xlsx · Intel desk market through Product End
```

Shared `/api/market/*` exposes **calendar horizon** (and historical Nifty for μ/σ). Simulated prices and roll points live on each path — Hedging / Computation / Simulated Nifty Paths. Intel · Market Calendar is dates only. Home and Intel · Simulated Nifty Paths download via queued `/api/forwardtest/{id}/mc-matrix/export` then `/mc-matrix.xlsx` (streaming Excel; job meta recovered from Mongo after Render restart when configured). Path count is **Monte Carlo Paths N** (not a frequency grid).

**GBM (image / Excel parity):** \(S_t = S_{t-1}\cdot\exp(\mathrm{drift}+\sigma Z)\) with \(Z\sim N(0,1)\), independent seed stream per `path_id`. Engine uses float64 log-cumsum (stable on long horizons) and stores the matrix as float32.

Sheet mirror reference: [02-excel-sheet-logic.md](02-excel-sheet-logic.md). API wiring: [05-architecture.md](05-architecture.md).

---

## Engine Module Map

| Module | File | Responsibility |
|--------|------|----------------|
| Product parser | `product.py` | Excel → `ProductSpec`, tenure, Monte Carlo Paths, legs |
| Market loader | `market.py` | Historical CSV load, `nifty_on`, roll model, LRU cache |
| Market sync | `market_sync.py` | Yahoo `^NSEI` append through present; historical calendars |
| Forward calendar | `forward_calendar.py` | Mon–Fri pad; rolls = monthly option expiries |
| Path rolls | `market.path_roll_vector` | 7% points from that path's GBM spots |
| GBM | `gbm.py` | Estimate μ/σ from history **2001 → as-of** (dynamic); per-path `gbm_spots` |
| Monte Carlo matrix | `mc_matrix.py` | Build / persist / Excel-export path×date Nifty grid |
| Path builder | `paths.py` | N copies of one tenure window (as-of → Product End) |
| Expiry builder | `calendar_build.py` | Historical NSE expiries (Thu→Tue era); `month_ends`; holiday floor **backward** |
| Hedging | `hedge.py` | Observations, legs, required futures delta (Backtester math; obs Nifty from path spots for GBM) |
| Black–Scholes | `black_scholes.py` | Forward/discount puts, central ±0.5 delta — **byte-identical to Backtester** |
| NAV / Computation | `nav.py` | Futures inventory, MTM, rolls, cash, Gsec, fees, tx, total, IRR — same ledger as Backtester; Forwardtester passes path-local roll points |
| Hedge | `hedge.py` | Same quantity / strike / BS delta math as Backtester; observation Nifty from path GBM spots |
| Orchestration | `forwardtest.py` | `run_forwardtest`, path detail |
| Runtime | `runtime.py` | Process / thread / serial workers |

---

## 1. Dynamic as-of and Product End

| Concept | Rule |
|---------|------|
| **As-of** | `market.last_date` after CSV load + Yahoo sync = latest Nifty session (**As Of Today** in the header strip) |
| **Tenure Days** | Product Input field (sample **1930**) |
| **Product End** | `path_end_calendar(asof, tenure)` — Backtester anniversary rule when tenure ∈ [1700, 2000]; else `asof + tenure_days`. Every path ends here |
| **Monte Carlo Paths** | Default **1000**; presets 100 / 500 / 1000 / 5000 / 10000 or Custom 1…10000; confirm at ≥ 5000; free hosts clamp near **2000** |
| **Simulation End Days** | Legacy Product Input field — **ignored** for horizon (API may still echo tenure span for compat) |
| **Trading Days / Monthly Expiries** | Header counts for **as-of → Product End** only (not full 2001→present history) |
| After deploy | Startup + `/api/sync` refresh Nifty; as-of and Product End move with the live calendar |

Header chips: **As Of Today** · **Product End** · **Tenure Days** · **Monte Carlo Paths** · **Trading Days** · **Monthly Expiries** — full-width equal cards.

---

## 2. Forward trading calendar (`forward_calendar.py`)

### Sessions (Nifty closes)

- From the day **after** as-of through Product End (plus a short pad for path tenure / observations).
- **Monday–Friday only.** Saturday and Sunday never receive a close.
- Real calendar stepping: January 31, April 30, February 28 / **29 in leap years** (e.g. 2028-02-29) are handled via `datetime` month arithmetic (`month_ends`).
- Forward pad **projects** recent historical weekday holidays onto future month–days (`project_holidays`) so expiry holiday floors can snap backward correctly.

### Futures shift / roll (forward months)

- **Monthly-last Nifty option expiry** for each complete month after as-of (same date as the Expiry calendar).
- Holiday rule: scheduled Thu/Tue floored to the **previous** trading session — never forward to Wednesday.
- Truncated pad months never invent a fake shift on the pad’s last day.
- Roll **cost** = same 7% average-spot × day-fraction model as the Backtester (`path_roll_vector` / `_recompute_roll_costs`), recomputed on **that path's** GBM closes. Historical CSV seeds through as-of are for estimation / hist calendar only.

### Monthly Nifty option expiry (forward months)

- Same builder as Backtester: `last_monthly_expiry_on_or_before` (Thu era → Tue era from Sep-2025).
- **Identical** to the futures shift list for those months.

### Historical vs forward (do not conflate)

| Era | Sessions | Monthly expiry | Futures shift |
|-----|----------|----------------|---------------|
| Historical (≤ as-of) | Nifty CSV (holiday-aware) | NSE Thu→Tue via `calendar_build` + overrides | **= monthly option expiry** (`roll_shifts == expiries`) |
| Forward (> as-of) | Mon–Fri + projected holidays | Same monthly-last builder; **as-of month kept** if expiry still ahead | **= monthly option expiry** |

### Backtester calc parity

| Module | Parity |
|--------|--------|
| `black_scholes.py` | Byte-identical |
| `calendar_build.py` / `market_sync.py` | Byte-identical |
| `nav.py` | Same ledger math; Forwardtester adds optional path-local roll points (`roll_on_day`) |
| Product rate defaults | Identical (Forwardtester adds Monte Carlo Paths; Simulation End Days is legacy/ignored) |
| `_recompute_roll_costs` | Same 7% first-TD / later-calendar rules |
| Futures / expiry calendars | Identical lists; `pin_current_month_roll_to_latest` is a deprecated no-op |
| `hedge.py` | Same BS / contract math; observation Nifty taken from **path spots** (required for GBM; on history equals `market.nifty_on`) |

Engines are a **forked twin** of Gift AIF Backtester (not a shared import package). Re-run `scripts/windup_suite.py` after engine edits.

---

## 3. Paths (`paths.py`)

### Atlas rule

| Item | Behaviour |
|------|-----------|
| Path 1…N start | **As-of** (latest Nifty close) — every path |
| Start grid | **None** — frequency argument accepted for API compat but ignored |
| Product End | Same Backtester `path_end_calendar`: ~5Y anniversary floored to prior month-end when tenure ∈ [1700, 2000]; else `start + tenure_days` |
| Path count | **Monte Carlo Paths N** — default 1000; clamp 1…10000; free hosts ceiling ~2000 |
| Spots | GBM along **path trading days only** (no weekend prices); S₀ = live as-of Nifty; independent seed per `path_id` |
| Hedge / NAV | **Forked twin** engines to Gift AIF Backtester (`black_scholes` byte-identical; path spots / path rolls for GBM) |

### GBM matrix (parity with desk Monte Carlo Excel)

μ, σ, and drift are estimated **every Run** from Nifty daily closes **2001-01-01 through today’s as-of** (`estimate_gbm_params` in `gbm.py`). As the Yahoo sync advances as-of, the sample grows and parameters change.

Simulate the shared horizon with GBM:

\[
S_t = S_{t-1} \cdot \exp\bigl(\mathrm{drift} + \sigma \cdot Z\bigr),
\qquad Z \sim N(0,1)
\]

```text
S_t = S_{t-1} · exp(drift + σ · Z)
```

Excel / download layout (authoritative):

| Axis | Meaning |
|------|---------|
| **Rows (vertical)** | Path numbers \(1, 2, 3, \ldots, N\) |
| **Columns (horizontal)** | Forward **trading dates** from as-of through Product End |
| Cell \((i,d)\) | Path \(i\) simulated Nifty on trading date \(d\) |
| Params block | S₀, μ, σ (%), drift, estimation start/end, path & date counts, formula |

**Same calendar date does not imply the same price across paths.**
Path 1 on 2026-08-03 ≠ Path 2 on 2026-08-03 in general.

Downloads:

| Surface | Action |
|---------|--------|
| Home | **Download Simulated Nifty Paths** |
| Intel → Monte Carlo Matrix | Preview (early + late date sample) + Download Excel (full grid) |
| API | `GET /api/forwardtest/{job_id}/mc-matrix.xlsx` |

Therefore:

- **No** shared “Market Reference Workbook” of forward Nifty closes
- **Yes** shared calendar rules (Mon–Fri sessions; monthly option expiry = futures shift)
- **Yes** path-local Nifty, expiry marks, and roll *points* (Hedging / Computation / Monte Carlo Matrix)

There are **no** Macro Paths CSV pins (235 historical windows). Those belong to the Backtester.

### Path count

Path count = **Monte Carlo Paths N** from the UI / product / `FORWARDTEST_N_PATHS` env — not f(frequency, horizon, tenure). Legacy frequency start grids are unused.

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

| Sheet | Range | Columns (no Source) | Content |
|-------|-------|---------------------|---------|
| Market Calendar · Futures shifts | as-of → Product End | Row · Shift Date · Weekday | Monthly option expiry dates (identical to Expiry sheet) |
| Market Calendar · Expiries | as-of → Product End | Row · Expiry · Weekday · Contract | Last Tuesdays (dates only) |
| Monte Carlo Matrix | all paths × all horizon dates | Path \\ Date · desk dates | Full grid + Excel (same as Home download); on-screen preview samples early + late dates |
| Hedging / Computation | selected path tenure | Path Nifty · roll points · obs marks | Per-path GBM + `path_roll_vector` |

UI meta cards on Market Calendar: As Of / Product End / shift count / expiry count. See [06-ui-ux.md](06-ui-ux.md).

See [02-excel-sheet-logic.md](02-excel-sheet-logic.md) for WF1 sheet names vs engine modules.


## Market Calendar vs shared prices

| Layer | Shared? | Contents |
|-------|---------|----------|
| Historical Nifty ≤ as-of | Yes | μ / σ / S₀ estimation sample |
| Forward session calendar | Yes | Mon–Fri dates to Product End |
| Monthly expiry dates | Yes | Last Tuesday of complete months |
| Futures shift dates | Yes | Monthly option expiries (identical list) |
| Simulated Nifty closes | **No — per path** | `gbm_spots(..., path_id)` |
| Roll *points* | **No — per path** | `path_roll_vector(dates, spots, shifts)` |
| Obs Nifty / deltas / NAV | **No — per path** | hedge + nav on path spots |

There is no separate “Market Reference Workbook” of forward prices: under GBM lognormals each path is its own market sheet.

See also the path × day matrix section in [02-excel-sheet-logic.md](02-excel-sheet-logic.md) (mirrors `Nifty Simulations.xlsx`: vertical = path id, horizontal = day).
