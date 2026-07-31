# 02 — Excel Sheet Logic (Working File)

Local source workbook (not committed to git): **`Gift AIF Working File 1.xlsm`**
Narrative notes (not committed): **`AIF - Notes.xlsx`**

When Notes prose and WF1 formulas disagree (e.g. Notes Fwd 7% / Disc 8% / Vol 13.3% vs WF1 **6.6% / 7.6% / Near–Far vols**), the engine follows WF1.

This document explains what each WF1 sheet does and how the Python engine mirrors it. UI naming: Excel **As per HS** → desk **Hedging Sheet** ([06-ui-ux.md](06-ui-ux.md)).

---

## Sheet Map

| Excel Sheet | Engine module(s) | Data / UI | Role |
|-------------|------------------|-----------|------|
| Macro Paths | `paths.py`, `gbm.py`, `forward_calendar.py` | Paths tab | **Forward** staggered tenure windows from as-of → Simulation End (no 235 CSV pins) |
| Roll Cost + Paths | `market.py`, `market_sync.py`, `forward_calendar.py` | `nifty_daily.csv`, `roll_costs.csv` · Intel | Historical through as-of; forward Mon–Fri closes + month-end shifts |
| Expiry | `calendar_build.py`, `forward_calendar.py` | `nifty_expiries.csv` · Intel | Historical NSE calendar; forward = last Tuesday of each month |
| As per HS | `hedge.py`, `black_scholes.py`, `product.py` | Hedging Sheet UI | Observations + options book + Req. Delta (Backtester-identical) |
| Computation | `nav.py` | Computation / Daily Ledger UI | Daily NAV / result block (Backtester-identical) |
| Summary | `forwardtest.py` summary rows | Analytics · Path Summary | Cached path totals & IRRs |

No hidden sheets in WF1. Notes workbook has a single sheet **Notes**.

---

## 1. Macro Paths → Forward Path Atlas

### Working File (Backtester reference)

- Historical Macro Paths: path `i` starts on the first trading day of calendar month `i` from Jan-2001.
- End ≈ last calendar day of the month before the ~5-year anniversary, floored onto a Nifty trading day.
- WF1 contains **235** pinned monthly rows — used by the **Backtester**, not this Forwardtester.

### Forwardtester engine (`paths.py` + `gbm.py` + `forward_calendar.py`)

| Item | Rule |
|------|------|
| Path 1 | Starts on **as-of** = latest Nifty session (dynamic after deploy / `/api/sync`) |
| Simulation End | `asof + Simulation End Days` (product input, default **3650**); **final path ends** on last Mon–Fri on/before this date |
| Tenure end | Same Backtester `path_end_calendar` rule for intermediate windows |
| Trading days | Mon–Fri only on the forward pad; Sat/Sun never priced |
| Spots | Per-path GBM from live S₀ along path trading days |
| Pins | **None** — no `macro_path_windows.csv` |

### Frequencies

| Frequency | Start rule |
|-----------|------------|
| Monthly | First trading day of each calendar month from as-of through last start |
| Weekly | First trading day of each ISO week |
| Daily | Every Mon–Fri session that still fits (UI default) |
| Quarterly / Semi-annual | First trading day of quarter / half-year |

Default UI frequency: **Daily**. Full calendar rules: [04-forwardtest-engine.md](04-forwardtest-engine.md).

---

## 2. Roll Cost + Paths

### Content

| Area | Excel | Engine CSV |
|------|-------|------------|
| Trading series | Cols E/F Date + Nifty close | `data/nifty_daily.csv` |
| Shift dates | Col B monthly futures shifts from **2001-01-25** | `roll_costs.csv` through latest Nifty month |
| Roll cost | Col C index points on shift dates | Same; Excel-seeded where present |

### Formulas (Notes / Working File)

Roll uses a **7% futures carry model** — separate from BS Forward 6.6% on the options book.

| Period | Formula | Anchor |
|--------|---------|--------|
| First month | `avg(Nifty on trading days ≤ first shift) × 7% × N_td/365` | **19** = trading days from 2001-01-01 through 2001-01-25 → ≈ **4.7713** pts. Sat/Sun never in avg or count. |
| Later months | `avg(Nifty on trading days in (prev, shift]) × 7% × (calendar days between shifts) / 365` | Calendar Δt between shift dates (Sat/Sun **in** Δt; not in avg) |

### Historical open-month pin (Backtester parity)

Finished months keep monthly option-expiry shifts. The **current / terminal** Nifty month uses `pin_current_month_roll_to_latest`: roll date = latest session in `nifty_daily.csv` for that month (same as Gift AIF Backtester). Hedging Sheet monthly expiries stay on true option dates — do not reuse this helper for them.

Verify: `scripts/verify_roll_costs.py`.

### Maintenance and auto-sync

Working File Excel historically stops mid-year. The engine **extends** futures shifts dynamically to the last Nifty trading month and persists `data/roll_costs.csv`.

**Daily auto-sync** (`market_sync.sync_market_to_present` — API startup + `GET /api/sync` + `scripts/sync_market_data.py`)

1. Append missing `^NSEI` closes through today
2. Extend roll shifts + monthly expiries through last Nifty date
3. Clear market LRU cache so Intel / Hedging / Computation see present calendars

**Engine rule:** never invent a roll on an option-only expiry that is not a futures shift date.

### Forwardtester pad (after as-of)

| Rule | Detail |
|------|--------|
| Sessions | Mon–Fri only through Simulation End — no Sat/Sun closes |
| Futures shift | **Last trading day of each calendar month** |
| Roll cost | Same 7% model on **each path's** GBM closes (path_roll_vector) |
| Incomplete months | Skipped — never invent a shift on a truncated pad day |

After last **observation** expiry on a path, Computation zeros further rolls (`As per HS!D14` = last obs; see §5).

### Notes workbook (local, gitignored)

`AIF - Notes.xlsx` contains a single **Notes** sheet: roll 7% carry model, **235** monthly paths (cell R3), historical BS rates (7%/8%/13.3%), and desk narrative. It does **not** drive the engine at runtime. When Notes prose and WF1 formulas disagree — Forward/Discount/Vol — the engine follows WF1.

---

## 3. Expiry

### Excel vs engine

| Aspect | WF1 Expiry sheet | Engine |
|--------|------------------|--------|
| Historical start | ~2004; duplicate columns B/D | Clean single-column calendar from **2001** |
| Overrides | Excel option dates from 2004+ | `data/expiry_overrides.csv` (authoritative where present) |
| Output | Mixed columns | `data/nifty_expiries.csv` — `expiry_date` only |

### Per-month priority (`calendar_build.py`)

Historical months through as-of use NSE schedule + overrides (Thu era → Tue era from Sep-2025).

### Forwardtester monthly expiries (after as-of)

| Rule | Detail |
|------|--------|
| Monthly option expiry | **Last Tuesday** of each calendar month |
| Completeness | Tuesday must lie on the Mon–Fri pad and on/before Simulation End |
| Weeklies | Not synthesized on the forward pad (Intel monthly list = last Tuesdays) |

Full forward calendar: [04-forwardtest-engine.md](04-forwardtest-engine.md).

1. Option override from WF1 (if present)
2. Else futures shift date from roll schedule
3. Else last **Thursday** trading day on Nifty through Aug-2025
4. From Sep-2025: last **Tuesday** (NSE circular)
5. Holidays snap to **previous** Nifty trading session

### Intel vs Hedging

- Full weekly + monthly option calendar also built for Intel (`nifty_all_expiries.csv`): weeklies from Feb-2019 (Thu era) and Sep-2025+ (Tue era).
- Hedging Sheet uses **monthly expiries only** for observation mapping.
- Intel · Path Market shows **one selected path's** simulated Nifty, monthly expiries, and roll points — not a shared forward workbook.

### Hedging observation mapping

For each observation month `m` ∈ {**38, 41, 44, 47, 50, 53, 56**}

```
offset_days = m × 30.5
target = path_start + offset_days
expiry = VLOOKUP-style monthly expiry for target month
 (WF1: VLOOKUP index then VLOOKUP+1 into Expiry cols)
nifty_exp = Nifty close on expiry (from Roll Cost + Paths lookup)
```

Path 1 verified expiries: `2004-03-25 … 2005-09-29`.

### Rebuild commands

```bash
PYTHONPATH=backend .venv/bin/python scripts/sync_market_data.py
PYTHONPATH=backend .venv/bin/python scripts/verify_nifty_expiries.py
```

---

## 4. Hedging Sheet (Excel: As per HS)

**Visible WF1 sheets:** Expiry · Roll Cost + Paths · Macro Paths · As per HS · Computation · Summary.

### Path selector (A1)

| Cell | Meaning |
|------|---------|
| A1 | Path id **1…235** (Macro Paths row selector) |
| B1:H1 | `XLOOKUP(A1, Macro Paths)` → path start date |
| J5 | Spot₀ = Nifty on path start |
| D14 | `=H5` = last observation expiry for **current A1 path** (roll cutoff for Computation) |

### What changes when you change Path (A1 = 1…235)

| Changes every path | Does **not** change (path-invariant) |
|--------------------|--------------------------------------|
| Path start/end, Spot₀, daily Nifty strip | Qty / Strike% / Option type (Put) |
| Observation expiry dates (B5:H5) | Forward **6.6%** (col F, hardcoded) |
| Obs Nifty (B6:H6) | Discount **7.6%** (`G = F+1%`) |
| Absolute strikes, contract qtys | **Implied vols Near / Far (col H)** |
| Daily BS deltas → Req. Delta | Fee / int / cash / Gsec / buy-sell rates (Computation) |

**Vols never flip at some path number.** Column H on rows 8–49 is **hardcoded values** (not formulas, not XLOOKUP into Macro Paths). Audited all 235 engine paths: every path uses the same 12 near/far vols from Product Input / HS. Macro Paths only stores dates + Nifty levels — **no vol column**.

### Book (display = Product Input / desk)

| # | Side | Qty | Strike % | Return | Fwd | Disc | Vol Near (1st obs) | Vol Far (obs 2…7) |
|--:|------|----:|---------:|-------:|----:|-----:|-------------------:|------------------:|
| 1 | Sold Put | −91.5 | 137% | 37% | 6.60% | 7.60% | **14.37%** | **14.79%** |
| 2 | Bought Put | 90.5 | 136% | 36% | 6.60% | 7.60% | **14.42%** | **14.85%** |
| 3 | Bought Put | 1.0 | 125% | 25% | 6.60% | 7.60% | **15.12%** | **15.62%** |
| 4 | Sold Put | −25.6 | 85% | −15% | 6.60% | 7.60% | **20.24%** | **20.61%** |
| 5 | Bought Put | 24.0 | 84% | −16% | 6.60% | 7.60% | **20.41%** | **20.77%** |
| 6 | Bought Put | 1.0 | 70% | −30% | 6.60% | 7.60% | **23.01%** | **23.20%** |

Exact HS fractions (engine pins): [03-product-input-spec.md](03-product-input-spec.md). No 0.6@10% leg in live HS / Product Input.

### Options block (rows 8–49: 6 strikes × 7 observations)

| Col | Header | Rule |
|-----|--------|------|
| A | Raw qty | Signed desk quantity |
| B | Strike % | 137, 136, 125, 85, 84, 70 |
| C | Strike | `=$J$5*B%` |
| D | Expiry | Links to observation row B5:H5 |
| E | Option | `P` (Put) |
| F | Forward | **6.6%** hardcoded |
| G | Discount | `=F+1%` → **7.6%** |
| H | Vol | Near on obs 1; Far on obs 2…7 |
| I | Contract qty | `=A*1e9/$J$5/7` |

### Daily Req. Delta

Each trading day: Black–Scholes **central difference** with spot bump **±0.5** (Excel does **not** divide by `2×bump`; raw price difference × contract qty). Row sum = **Req. Delta** → feeds Computation col D.

Engine: `hedge.py` + `black_scholes.py` (`scipy.special.erf`). Path 1: 1258/1258 days, max |Δ| ≈ 2.67×10⁻⁵ vs HS.

---

## 5. Computation (`nav.py`)

**First data row (row 5) seeded; later rows formula-driven.** Roll cutoff cell is `As per HS!$D$14` which equals **`H5` = last observation expiry of the A1 path** — not a fixed calendar date.

### Global seeds

| Item | Cell / const | Value |
|------|--------------|-------|
| Investment | C2 | **100** Cr |
| Cash buffer | N5 | **5** Cr hardcoded |
| Gsec start | Q5 | `=C2−N5` → **95** Cr |
| Cash interest | O | **6%** on prior N |
| Gsec compound | Q | **6%** |
| Fee rate | W2 | **1.5%** on 100 Cr |
| Tax on roll | L | **42.744%** of K — **not in Total** |
| Buy all-in | AK3 | ≈ **5.49855×10⁻⁵** (until AK2) |
| Sell all-in | AK4 | ≈ **1.82486×10⁻⁴** |
| Rate switch | AK2 | **2024-10-31** (brokerage-only AL rates after; immaterial for early paths) |

### Column map

| Col | Header | Excel formula / rule | Engine |
|-----|--------|----------------------|--------|
| B | Date | trading day | `path_dates` |
| C | Nifty | close | `spots` |
| D | Req. Delta | from HS | `req_delta` |
| E | Change in Delta | `D_t − D_{t−1}` (E5=`D5`) | `diff` |
| G | Future Qty | `=E` | same |
| H | Fut. Cumulative | running sum G | `cumsum` |
| I | MTM Futures | `H_{t−1}*(C_t−C_{t−1})/1e7` | same |
| K | Rollover Cost | `0` if `B > D14`; else `−roll_pts(B)*H/1e7` | zero after `last_observation` |
| L | Tax Benefit | `K*42.744%` | computed; **not in Total** |
| N | Cash +MTM | N5=**5**; then `N+I+K` | same |
| O | Int on Cash/MTM | prior `N * 6% * Δt/365` | `cash_rate=0.06` |
| Q | Gsec | Q5=**95**; then prior `Q*(1+6%*Δt/365)` | compound |
| R | Int. Gsec | `max(Q_t−Q_{t−1},0)` | same |
| T | Tx Futures | day0: `H*C*AK3/1e7`; else `ΔH*C*(buy\|sell)/1e7` | `BUY_RATE`/`SELL_RATE` |
| U | Tx Cash | ≈0 in WF1 | — |
| W | Fees | `100 * 1.5% * Δt/365` | `fee_rate=0.015` |
| Y/Z | NAV | prior + I+K+O+R − T − U − Tprev − Uprev (−W for Z) | `nav_post_fees` |

### Result block AC (feeds Summary Base row)

| AC | Label | Formula |
|----|-------|---------|
| AC3 | Invt | `C2` = 100 |
| AC4 | MTM Futures | `I2+K2` = ΣMTM + ΣRoll |
| AC5 | Cash + Int | `O2+N5` = Σint_cash + 5 |
| AC6 | Gsec | `Q2` = ending Gsec interest component |
| AC7 | Transaction Cost | `−(T2+U2)` |
| AC8 | Fees | `−W4` |
| AC9 | **Total** | `SUM(AC3:AC8)` |
| AC10 | IRR | `((AC9/100)^(365/tenure_days))−1` |

\[
Total = Invt + MTM + CashInt + Gsec + Tx + Fees
\]

Path 1 parity: Total **180.7724201145** Cr WF1 vs **180.7724200660** engine (Δ ≈ −4.9×10⁻⁸).

### Excel consistency caveat (A1 vs Computation paste — critical)

Saved `Gift AIF Working File 1.xlsm` can have **A1 ≠ Computation body path**

| Sheet | A1 behaviour in saved file |
|-------|----------------------------|
| As per HS | **Live** — A1=1 refreshes Spot₀, deltas, D14 when recalculated |
| Computation | **Not live-linked** — cols B/C/D often **hardcoded paste** for Path **235** (2020-07-01 → 2025-06-30) |

**Hybrid corruption example:** A1=1 ⇒ `D14=2005-09-29`, but Computation dates = Path 235 ⇒ every `K` row = **0** (all dates > D14). Cascade breaks N, O, Z. Summary Path-235 total (~197.27) was from a correct run; live Computation strip is not trustworthy until A1 and body align.

**Trust for path-by-path parity:** Summary path rows (when healthy) or **engine**; not a mixed A1/Computation paste.

---

## 6. Summary

### Layout

| Row | Content |
|-----|---------|
| 3 Base | Live links to Computation `AC` block |
| 4+ | **Cached values** per path (col B = path id) — **do not auto-refresh** when A1 changes |

Per-path Invt / MTM / Cash / Gsec / Tx / Fees / Total / IRR → Analytics yearly rollups.

### Known WF1 Summary artifacts (not engine bugs)

| Band / paths | Issue |
|--------------|-------|
| ~105–160 | Stale Gsec (near-linear fake decline) + fixed fee offset |
| 39, 47, 163, 166 | Hard MTM-only Summary drift |
| 234–235 | Missing / mislabeled at sheet tail (235 dates sometimes under path id 1) |

Engine recomputes every path from Product Input + market. Bucket summary: **148 tight**, 56 gsec_stale, 4 hard_mtm, 2 missing. Verification: [07-verification.md](07-verification.md).

---

## Cross-Reference Index

| Topic | Doc |
|-------|-----|
| Product upload / parser | [03-product-input-spec.md](03-product-input-spec.md) |
| Engine pipeline | [04-forwardtest-engine.md](04-forwardtest-engine.md) |
| Stage formulas | [09-formulas-and-product-books.md](09-formulas-and-product-books.md) |


## Monte Carlo GBM (Forwardtester)

Reference layout: `Nifty Simulations.xlsx` (desk Monte Carlo sheet).

### Inputs (from history through as-of)

| Symbol | Meaning | Excel label |
|--------|---------|-------------|
| \(S_0\) | As-of Nifty close | Current Nifty Level |
| \(\mu\) | Mean of daily simple returns | Daily Average Return |
| \(\sigma\) | Sample stdev of daily returns | Daily Standard Dev |
| \(\mathrm{drift}\) | \(\mu - \tfrac12\sigma^2\) | Drift / Mean Return |

### One-step recurrence (every Mon–Fri session)

\[
S_t = S_{t-1} \cdot \exp\bigl(\mathrm{drift} + \sigma \cdot Z\bigr),
\qquad Z \sim N(0,1)
\]

Equivalent forms:

```text
S_t = S_{t-1} · exp(drift + σ · Z)
```

```excel
=prev * EXP($drift + $sigma * NORM.INV(RAND(), 0, 1))
```

Engine: `backend/app/engine/gbm.py` → `gbm_spots` / `gbm_spots_matrix`.

### Path × day matrix (how the Excel file is laid out)

In `Nifty Simulations.xlsx`:

- **Rows (vertical)** = path numbers \(1, 2, 3, 4, 5, \ldots\)
- **Columns (horizontal)** = simulation day indices \(1, 2, 3, 4, 5, \ldots\)
- Cell \((\mathrm{path}\ i,\ \mathrm{day}\ t)\) = that path’s simulated Nifty at step \(t\)

```text
              Day 1      Day 2      Day 3     …
Path 1     25,999.58   25,614.44   25,051.24  …
Path 2     25,537.72   25,483.62   25,705.77  …
Path 3     25,487.29   24,890.43   24,973.27  …
Path 4     25,832.14   25,681.44   25,595.75  …
Path 5     25,583.00   25,924.99   25,771.45  …
   ⋮           ⋮           ⋮           ⋮
```

**Same day index ⇒ different prices across paths.** Path 1 Day 1 ≠ Path 2 Day 1.
Each path draws its own \(Z\) sequence (engine seed keyed by `path_id`), so the whole Nifty series for path \(i\) is independent of path \(j\).

Desk Forwardtester maps that idea onto **calendar dates** (Mon–Fri only): for a fixed trading date \(D\), simulated closes generally differ by path. That is why there is **no shared forward price database / Market Reference Workbook** — only shared **calendar rules** (when expiries and roll *dates* fall). Nifty levels, monthly-expiry marks, and roll *points* are always taken from the selected path’s column of the matrix (Intel · Path Market).

### Desk vs Excel day-0

| | Excel `Nifty Simulations.xlsx` | Gift AIF Forwardtester |
|--|-------------------------------|-------------------------|
| Column / step 0 | First **future** step from \(S_0\) | Index 0 = live as-of \(S_0\) on path start |
| Later steps | Same recurrence | Same recurrence on path trading days |
| Path identity | Vertical path id | `path_id` in atlas + PathSelect |

### Downstream (path-local)

| Use | Source |
|-----|--------|
| Hedging Sheet obs Nifty | That path’s simulated close on/before expiry |
| Futures roll points | `path_roll_vector` on that path’s spots |
| Computation MTM / NAV | That path’s daily simulated Nifty |
| Intel · Path Market | One selected path’s Nifty · expiries · rolls |
