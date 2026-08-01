# 09 — Formulas & Product Books (Complete Reference)

**Audience:** Desk quants, engine maintainers, verification reviewers.
**UI policy:** The web app does **not** render equation cards or Working File path totals as banners. This document is the canonical formula reference.

**Related:** [02-excel-sheet-logic.md](02-excel-sheet-logic.md) · [03-product-input-spec.md](03-product-input-spec.md) · [07-verification.md](07-verification.md) · `frontend/components/ProductSpecTables.tsx`

**Authority rule:** When `AIF - Notes.xlsx` prose and `Gift AIF Working File 1.xlsm` formulas disagree, the engine follows WF1. Notes still define structural intent (235 monthly pins, 7% roll, cash/Gsec seeds, Total composition).

**Verified:** 2026-07-25 against WF1 Path 1 / Path 10 anchors. Forward calendar / roll / open-month pin re-verified 2026-07-31 (`verify_roll_costs.py`, `verify_forward_calendar.py`).

---

## 1. Live Sources

| Source | File | Role |
|--------|------|------|
| Working File 1 | `Gift AIF Working File 1.xlsm` (local, gitignored) | Excel methodology bible — Macro Paths, Roll, Expiry, As per HS, Computation, Summary |
| Product Input | `Product_Input_File.xlsx` (repo sample) | Sole **Run** input — parsed by `backend/app/engine/product.py` (+ Simulation End Days) |
| Notes | `AIF - Notes.xlsx` (local, gitignored) | Narrative methodology — structure only; BS rates superseded by WF1 |
| Gift AIF Backtester | sibling Desktop project | Byte-identical `nav.py` / `black_scholes.py`; shared `pin_current_month_roll_to_latest` |
| GitHub | https://github.com/ShibayanBiswas/gift-city-aif-forwardtester | Canonical Forwardtester source |

The engine does **not** read WF1 at runtime. It parses Product Input and pins WF1-equivalent defaults where cells are blank.

### 1.1 Active book (Working File 1 = Product Input)

| Field | Value |
|-------|-------|
| Principal | ₹100 crore (`1e9` INR notional) |
| Tenure days | **1930** calendar days (IRR denominator) |
| Observation months | **38, 41, 44, 47, 50, 53, 56** (seven observations) |
| Option type | Put Option (all six legs) |
| Raw quantities | −91.5 · +90.5 · +1 · −25.6 · +24 · +1 |
| Strike % | 137 · 136 · 125 · 85 · 84 · 70 |
| BS Forward | **6.6%** (0.066) — path-invariant |
| BS Discount | **7.6%** (0.076) — `Forward + 1%` on As per HS |
| Full hedge 0.6 @ 10% | **Not present** in live HS or Product Input |

**Path invariance:** Forward, Discount, and Near/Far vols are **identical for Path 1 and Path 235** (and every Macro Path 1…235). Only Spot₀, observation dates, Nifty path, deltas, MTM, and rolls change with path start. Column H on As per HS is **hardcoded** — not XLOOKUP from Macro Paths. Engine audit across all 235 pinned paths: **0 vol deviations**.

---

## 2. Six-Leg Desk Table (Active Book)

Display order matches Product Input / As per HS. Return Level = `(Strike% / 100) − 1`.

| # | Side | Qty | Strike % | Return | Fwd | Disc | IV obs 1 (Near) | IV obs 2…7 (Far) |
|--:|------|----:|---------:|-------:|----:|-----:|----------------:|-----------------:|
| 1 | Sold Put | −91.5 | 137.00% | 37.00% | 6.60% | 7.60% | **14.37%** | **14.79%** |
| 2 | Bought Put | 90.5 | 136.00% | 36.00% | 6.60% | 7.60% | **14.42%** | **14.85%** |
| 3 | Bought Put | 1.0 | 125.00% | 25.00% | 6.60% | 7.60% | **15.12%** | **15.62%** |
| 4 | Sold Put | −25.6 | 85.00% | −15.00% | 6.60% | 7.60% | **20.24%** | **20.61%** |
| 5 | Bought Put | 24.0 | 84.00% | −16.00% | 6.60% | 7.60% | **20.41%** | **20.77%** |
| 6 | Bought Put | 1.0 | 70.00% | −30.00% | 6.60% | 7.60% | **23.01%** | **23.20%** |

### 2.1 Exact fractions pinned in engine / HS (0 bp vs Excel)

| Qty | Strike % | Vol Near | Vol Far |
|----:|---------:|---------:|--------:|
| −91.5 | 137 | 0.14368857564668683 | 0.14793275750723667 |
| 90.5 | 136 | 0.1441638312604284 | 0.14848846191959258 |
| 1 | 125 | 0.15118881279350588 | 0.15619717745743442 |
| −25.6 | 85 | 0.20241167320096648 | 0.2061305717267251 |
| 24 | 84 | 0.2041294400033543 | 0.20774616738378116 |
| 1 | 70 | 0.23005561163223529 | 0.2319842472882776 |

Product Input stores each strike **once**. As per HS repeats each strike **seven times** (rows 8–49: 6 strikes × 7 observations). The engine expands Product Input legs × `n_obs` at runtime.

### 2.2 WF1 vs Notes BS rates

| Parameter | Notes (R23 prose) | WF1 As per HS | Engine default |
|-----------|------------------:|--------------:|---------------:|
| Forward | 7% | **6.6%** | `DEFAULT_FORWARD = 0.066` |
| Discount | 8% | **7.6%** (`=F+1%`) | `DEFAULT_DISCOUNT = 0.076` |
| Volatility | single 13.3% | **Near/Far per strike** (col H) | Per-leg from Product Input |

Path 1 Total ≈ **180.7724** Cr matches WF1 rates only. Notes 7%/8%/13.3% describe an earlier generic book.

### 2.3 Roll rate vs BS forward (do not conflate)

| Model | Rate | Used for |
|-------|-----:|----------|
| Futures roll carry | **7%** | Roll Cost + Paths col C — index points on monthly futures shifts |
| BS forward | **6.6%** | Options delta pricing on Hedging Sheet |
| BS discount | **7.6%** | Options delta pricing (not the roll model) |

---

## 3. Observation Target Date

For each observation month offset `m` from Product Input (sample: **38, 41, 44, 47, 50, 53, 56**)

\[
\text{offset\_days} = m \times 30.5
\]

\[
\text{target} = \text{path\_start} + \text{offset\_days}
\]

Then map to the monthly Nifty **option expiry** for the calendar month containing `target`

1. VLOOKUP-style index into Expiry sheet (WF1 cols B/C).
2. VLOOKUP index+1 into Expiry cols C/D for the actual expiry date used.
3. Nifty on expiry = lookup from Roll Cost + Paths cols E/F.

Engine: `build_observation_details` in `hedge.py` + `calendar_build.py`.

### 3.1 Path 1 verified observation map

| Obs | Month | Expiry | Nifty on expiry |
|----:|------:|--------|----------------:|
| 1 | 38 | 2004-03-25 | 1704.4 |
| 2 | 41 | 2004-06-24 | 1470.7 |
| 3 | 44 | 2004-09-30 | 1745.5 |
| 4 | 47 | 2004-12-30 | 2059.8 |
| 5 | 50 | 2005-03-31 | 2035.6 |
| 6 | 53 | 2005-06-30 | 2220.6 |
| 7 | 56 | 2005-09-29 | 2611.2 |

Path 1 window: `2001-01-01 → 2005-12-30` · Spot₀ = **1254.3** · last observation expiry = **2005-09-29** (= Computation roll gate D14 when A1=1).

### 3.2 Path 10 observation anchors

Path 10 window: `2001-10-01 → 2006-09-29`. Observation expiries: `2004-12-30 … 2006-06-29`. Obs Nifties (rounded): 2060, 2036, 2221, 2611, 2822, 3419, 2998.

---

## 4. Strike Level

\[
\text{Strike} = \text{Spot}_0 \times \frac{\text{Strike\%}}{100}
\]

Equivalently, when Return Level is expressed as decimal return `r`

\[
\text{Strike\%} = (1 + r) \times 100 \quad\Rightarrow\quad \text{Strike} = \text{Spot}_0 \times (1 + r)
\]

WF1 As per HS col C: `=$J$5*B%` where `J5` = Spot₀ (Nifty on path start).

---

## 5. Contract Quantity

For each **active** leg and each observation expiry

\[
Q_{\text{contract}} = \frac{\text{raw\_qty} \times \text{principal}}{\text{Spot}_0 \times n_{\text{obs}}}
\]

For the sample product (₹100 Cr principal, seven observations)

\[
Q_{\text{contract}} = \frac{A \times 1{,}000{,}000{,}000}{\text{Spot}_0 \times 7}
\]

WF1 As per HS col I: `=A*1000000000/$J$5/7`.

**Vol selection:** Observation 1 → Vol Near; observations 2…7 → Vol Far (per leg). BS rates → Forward / Discount from leg (defaults 6.6% / 7.6%).

---

## 6. Black–Scholes Delta (Required Futures Delta)

### 6.1 Single-leg central difference

Excel As per HS uses NORMDIST-based Black–Scholes with a **central spot bump**

\[
\Delta_{\text{BS}}(S) = P(S + b) - P(S - b)
\]

where

- `b` = **0.5** index points (engine constant `_BUMP = 0.5`)
- Excel does **not** divide by `2 × b` — raw price difference, then × contract qty
- `P(·)` = BS put price with Forward **6.6%**, Discount **7.6%**, leg vol
- `τ` = time to expiry in years (calendar day-count from trading day to expiry)
- Expired or invalid τ → delta contribution **0**

Engine: `central_delta` / `central_delta_book` in `black_scholes.py` (`scipy.special.erf` for norm CDF).

### 6.2 Book aggregation

For trading day `t`

\[
\text{Req.\ Delta}_t = \sum_{\text{legs } \ell} \sum_{\text{obs } o} \Delta_{\text{BS}}(S_t, K_{\ell,o}, \tau_{t,o}, \sigma_{\ell,o}) \times Q_{\text{contract},\ell}
\]

- Sum across all **42** live leg×observation rows (6 legs × 7 obs) that have τ > 0.
- As per HS row 3 (J3) = `SUM(J8:J49)` for that day.
- Feeds Computation col **D** (Req. Delta).

This is **not** a cross-path sum — it is one path's daily futures hedge requirement.

### 6.3 Path 1 delta parity (2026-07-25)

Path 1 Hedging Sheet Req. Delta tally:

| Metric | Value |
|--------|------:|
| HS trading days | 1258 |
| Engine trading days | 1258 |
| Date-aligned matches | **1258 / 1258** |
| Max \|engine − HS\| | **2.67×10⁻⁵** |
| Mean \|error\| | **4.51×10⁻⁶** |
| Day-0 engine | **972694.912599464** |
| Day-0 HS | **972694.912595786** |

**Verdict: PASS.**

---

## 7. Roll Cost (Futures — Separate from BS)

Roll Cost + Paths uses a **7% futures carry model** on monthly **futures shift** dates (not option-only expiries).

### 7.0 Forwardtester calendars (after as-of)

| Calendar | Rule |
|----------|------|
| Trading sessions | **Mon–Fri only** through Simulation End (Sat/Sun closed; leap/30/31 via real calendar) |
| Futures shift | **Last trading day of each month** |
| Monthly option expiry | **Last Tuesday of each month** |
| Roll points | Same 7% formula on **each path's** GBM closes via `path_roll_vector` (Intel Path Market = same points) |
| As-of | Latest Nifty session after deploy sync — horizon = as-of + Simulation End Days |

Historical months through as-of keep CSV / NSE builder behaviour, including **`pin_current_month_roll_to_latest`** (open month = latest Nifty session) — same as Gift AIF Backtester. See [04-forwardtest-engine.md](04-forwardtest-engine.md).

### 7.1 First gap (seed)

| Anchor | Value |
|--------|------:|
| Path open | 2001-01-01 |
| First shift | 2001-01-25 |
| Trading days in gap | **19** (Mon–Fri sessions only — Sat/Sun never in the Nifty series) |
| Formula | `avg(Nifty on trading days ≤ first shift) × 7% × 19/365` |
| Seed roll cost | ≈ **4.7713** index points |

WF1: `C3 = AVERAGEIF(…E:E,"<="&B3,F:F)*7%*19/365`.

**Weekends / holidays:** the average and the **19** count use only rows present in the trading calendar. Saturday and Sunday are never priced and never counted here.

### 7.2 Later gaps

\[
\text{roll\_pts}_k = \overline{\text{Nifty}}_{(\text{shift}_{k-1}, \text{shift}_k]} \times 7\% \times \frac{\Delta t_{\text{calendar}}}{365}
\]

WF1: `C4 = AVERAGEIFS(…)*7%*(B4-B3)/365` — **calendar** days between shift dates (Sat/Sun **included** in Δt). The average still uses trading-day closes only (weekends absent from the series).

Verify: `PYTHONPATH=backend .venv/Scripts/python scripts/verify_roll_costs.py`.

### 7.3 Computation application

On roll day `t` with futures inventory `H_t` (cumulative)

\[
K_t = \begin{cases}
0 & \text{if } B_t > D_{14} \text{ (last obs expiry)} \\
-\text{roll\_pts}(B_t) \times H_t / 10^7 & \text{otherwise}
\end{cases}
\]

- `D14` = As per HS `H5` = last observation expiry for the **selected A1 path**.
- After last observation, rolls are **zeroed** — engine `last_observation` gate in `nav.py`.
- Engine never invents a roll on an option-only expiry that is not a futures shift.

Tax benefit (display only, **not in Total**)

\[
L_t = K_t \times 42.744\%
\]

---

## 8. Computation Seeds & Column Formulas

**First data row:** Computation row 5 is seeded; row 6+ is formula-driven. Engine mirrors the same initialization.

### 8.1 Global seeds (row 5 / header constants)

| Item | Cell / const | Value | Notes |
|------|--------------|------:|-------|
| Investment | C2 | **100** Cr | Principal sleeve |
| Cash buffer | N5 | **5** Cr | Hardcoded day-zero cash |
| Gsec start | Q5 | **95** Cr | `=C2−N5` |
| Cash interest | O formula | **6%** | `N_{t−1} × 6% × Δt/365` |
| Gsec compound | Q formula | **6%** | `Q_{t−1} × (1 + 6%×Δt/365)` |
| Fee rate | W2 | **1.5%** | `100 × 1.5% × Δt/365` |
| Tax on roll | L | **42.744%** | `K × 42.744%` — **excluded from Total** |
| Buy all-in | AK3 | **5.49855129382014×10⁻⁵** | Until AK2 |
| Sell all-in | AK4 | **0.000182485512938201** | Until AK2 |
| Brokerage-only buy | AL3 | **5.32155129382014×10⁻⁵** | After AK2 (2024-10-31) |
| Brokerage-only sell | AL4 | **0.000180715512938201** | After AK2 |
| Rate switch date | AK2 | **2024-10-31** | Immaterial for early paths |
| Roll cutoff | D14 | `=As per HS!H5` | Last observation expiry |

Engine constants in `nav.py`: `BUY_RATE`, `SELL_RATE`, `BUY_BROKERAGE`, `SELL_BROKERAGE` (GST = rate − brokerage).

### 8.2 Daily column map (row 5 seed, row t ≥ 6)

| Col | Header | Row 5 | Row t ≥ 6 |
|-----|--------|-------|-----------|
| B | Date | Path trading day | Next trading day |
| C | Nifty | Close | Close |
| D | Req. Delta | From HS | From HS |
| E | Change in Delta | `=D5` | `=D_t − D_{t−1}` |
| G | Future Qty | `=E5` | `=E_t` |
| H | Fut. Cumulative | `=G5` | `=H_{t−1}+G_t` |
| I | MTM Futures | 0 | `=H_{t−1}×(C_t−C_{t−1})/10⁷` |
| K | Rollover Cost | 0 | `IF(B_t > D14, 0, −XLOOKUP(roll)×H_t/10⁷)` |
| L | Tax Benefit | 0 | `=K_t×42.744%` |
| N | Cash + MTM | **5** | `=N_{t−1}+I_t+K_t` |
| O | Int on Cash | 0 | `=N_{t−1}×6%×Δt/365` |
| Q | Gsec | **95** | `=Q_{t−1}×(1+6%×Δt/365)` |
| R | Int. Gsec | 0 | `=MAX(Q_t−Q_{t−1}, 0)` |
| T | Tx Futures | `(H5×C5×AK3)/10⁷` | Buy/sell rate on \|ΔH\|×spot / 10⁷ |
| U | Tx Cash | ≈0 | `SUM(AF:AG)` — GST on cash tx |
| W | Fees | — | `=C2×W2×Δt/365` |
| Y | NAV (pre-fee) | `=N5+Q5` | Prior + I+K+O+R − T − U − Tprev − Uprev |
| Z | NAV post fees | `=N5+Q5` | Same as Y but also `−W_t` |

Engine NAV series = **post-fees** (Z-style). Tax benefit L is stored for display but **excluded from Total**.

Day-0 futures transaction: `T5 = H5 × C5 × AK3 / 10⁷` (initial inventory at buy all-in rate).

---

## 9. Terminal Total & IRR

### 9.1 Result block (Computation AC → Summary Base)

| Cell | Label | Formula | Path 1 (Cr) |
|------|-------|---------|------------:|
| AC3 | Invt | `=C2` | 100.0000 |
| AC4 | MTM Futures | `=I2+K2` (Σ MTM + Σ Roll) | 48.8223347082 |
| AC5 | Cash + Int | `=O2+N5` (Σ int_cash + 5) | 7.0894837361 |
| AC6 | Gsec | `=Q2` (ending Gsec interest component) | 33.2093398102 |
| AC7 | Transaction Cost | `=−(T2+U2)` | −0.8528477289 |
| AC8 | Fees | `=−W4` (Σ fees) | −7.4958904110 |
| AC9 | **Total** | `=SUM(AC3:AC8)` | **180.7724201145** |
| AC10 | IRR | `((AC9/100)^(365/tenure_days)) − 1` | (product tenure) |

\[
\text{Total} = \text{Invt} + \text{MTM} + \text{CashInt} + \text{Gsec} + \text{Tx} + \text{Fees}
\]

Tax benefit on roll (col L) is **not** included in Total.

### 9.2 IRR

\[
\text{IRR} = \left(\frac{\text{Total}}{100}\right)^{365 / \text{tenure\_days}} - 1
\]

- Numerator uses terminal Total (Cr).
- Denominator uses **100 Cr** principal.
- `tenure_days` = product calendar tenure from Product Input (**1930** for sample).
- Compounding uses calendar day exponent — matches WF1 AC10.

---

## 10. Hit Rate (Analytics / Summary)

Hit rate measures how often a path's terminal Total exceeds principal

\[
\text{Hit Rate} = \frac{\#\{\text{Total} > 100\}}{N_{\text{paths}}}
\]

- Principal sleeve Invt is always **100 Cr** — Total > 100 means net gain vs principal.
- Computed on engine path summary rows (Analytics · Path Summary), not WF1 cached Summary alone.
- For monthly frequency with sample product: compare across all paths in the run (Daily default ≈ 5,178 paths; Monthly pinned 235 + 15 extension = **250** as of 2026-07-24).

---

## 11. Path 1 / Path 10 Gold Pins

These are the desk anchors after every engine or market change. Full verification: [07-verification.md](07-verification.md).

### 11.1 Path 1 (primary gold)

| Check | WF1 Summary | Engine | Δ (Cr) | Verdict |
|-------|------------:|-------:|-------:|---------|
| Window | 2001-01-01 → 2005-12-30 | same | — | PASS |
| Trading days | 1258 | 1258 | 0 | PASS |
| Spot₀ | 1254.3 | 1254.3 | — | PASS |
| Day-0 Req. Delta | 972694.9126 | 972694.9126 | ~10⁻⁶ | PASS |
| Invt | 100.0000000000 | 100.0000000000 | 0 | PASS |
| MTM Futures | 48.8223347082 | 48.8223346611 | −4.7×10⁻⁸ | PASS |
| Cash + Int | 7.0894837361 | 7.0894837346 | −1.4×10⁻⁹ | PASS |
| Gsec | 33.2093398102 | 33.2093398102 | −8.5×10⁻¹³ | PASS |
| Transaction Cost | −0.8528477289 | −0.8528477289 | −1.7×10⁻¹² | PASS |
| Fees | −7.4958904110 | −7.4958904110 | −9.9×10⁻¹⁴ | PASS |
| **Total** | **180.7724201145** | **180.7724200660** | **−4.9×10⁻⁸** | **PASS** |

### 11.2 Path 10 (secondary gold)

| Check | WF1 Summary | Engine | Δ (Cr) | Verdict |
|-------|------------:|-------:|-------:|---------|
| Window | 2001-10-01 → 2006-09-29 | same | — | PASS |
| Trading days | 1248 | 1248 | 0 | PASS |
| **Total** | **216.4729879081** | **216.4729881312** | **+2.2×10⁻⁷** | **PASS** |

Path 1 / Path 10 terminal totals:

### 11.3 Path 235 (last WF1 pin)

| Check | Value |
|-------|-------|
| Window | 2020-07-01 → 2025-06-30 |
| Trading days | 1242 |
| Engine Total | ≈ **197.272** Cr |
| WF1 Summary (date-aligned) | ≈ **197.270** Cr (Δ ≈ 0.003 — SOFT) |

Path 235 Summary row may be **mislabeled** as path id 1 at sheet tail — match by dates, not id alone.

### 11.4 Extension beyond WF1 (engine only)

| Item | Value (2026-07-25) |
|------|-------------------|
| WF1 last pin | Path 235 |
| Engine monthly paths | **250** (235 pins + 15 dynamic) |
| First extension | Path 236 · 2020-08-03 → 2025-07-31 · Total ≈ **196.58** Cr |
| Latest path | Path 250 · 2021-10-01 → **2026-07-24** · Total ≈ **138.88** Cr (partial tenure) |
| Market last date | **2026-07-24** · 6352 Nifty sessions · 306 monthly shifts |

---

## 12. Market Anchors (Roll & Calendar)

| Series | Value |
|--------|------:|
| Nifty daily range | 2001-01-01 → **latest session** (moves with `/api/sync`) |
| First roll shift | 2001-01-25 |
| First roll cost | **4.7713** index pts (**19** trading days) |
| Open-month futures shift | Latest Nifty session in terminal month (`pin_current_month_roll_to_latest`) — **Backtester parity** |
| Expiry rule (through Aug-2025) | Last **Thursday** trading day of month |
| Expiry rule (from Sep-2025) | Last **Tuesday** (NSE circular) |
| Holiday handling | Snap to **previous** Nifty session |
| Forward (> as-of) | Mon–Fri; last-Tuesday expiry; month-end futures shift |

Auto-sync: API startup · `GET /api/sync` · `scripts/sync_market_data.py`. Trading-day counts are dynamic — do not hardcode in desk copy.

**Verify rolls:** `PYTHONPATH=backend .venv/Scripts/python scripts/verify_roll_costs.py`

---

## 13. Excel Consistency Caveat (A1 vs Computation)

Saved WF1 may have **A1 ≠ Computation body path**

| Sheet | Behaviour |
|-------|-----------|
| As per HS | **Live** — A1 selects path; D14 = last obs of that path |
| Computation | **Often pasted** — B/C/D hardcoded for Path **235** in saved file |

When A1=1 but Computation body = Path 235, roll gate D14 = **2005-09-29** while dates run to 2025 → every **K** = 0 → N, O, Z cascade fail. This is an Excel paste mismatch, not an engine bug. Trust Summary path rows (when healthy) or **engine**.

---

## 14. WF1 Summary Cache (Not Engine)

235-path Summary scan (2026-07-24): **148 tight** (|ΔTotal| < 1e−4 Cr), remainder mostly Excel cache drift

| Band / paths | Issue |
|--------------|-------|
| ~105–160 | Stale Gsec (near-linear fake decline) + fixed fee offset (~29 extra fee-days) |
| 39, 47, 163, 166 | Hard MTM-only Summary drift |
| 234–235 | Missing / mislabeled at sheet tail |

Engine recomputes every path live from Product Input + market. Analytics shows engine totals.

---

## 15. Verification Commands

```bash
# Path 1 / Path 10 smoke (no Excel required for engine side)
PYTHONPATH=backend .venv/bin/python scripts/verify_monthly_excel.py

# Dynamic obs/tenure books
PYTHONPATH=backend .venv/bin/python scripts/verify_dynamic_products.py

# Market extend-through-present
PYTHONPATH=backend .venv/bin/python scripts/sync_market_data.py
```

Six-leg book guard

```bash
PYTHONPATH=backend .venv/bin/python -c "
from backend.app.engine.product import parse_product_workbook
p = parse_product_workbook('Product_Input_File.xlsx')
qs = [round(lg.quantity, 1) for lg in p.active_legs]
assert qs == [-91.5, 90.5, 1.0, -25.6, 24.0, 1.0], qs
print('Book OK', qs)
"
```

---

## 16. One-Line Conclusion

**Gift City AIF Forward Tester formulas = Working File 1 As per HS + Computation methodology (Backtester-identical `nav` / `black_scholes`):** six-leg put book at 6.6%/7.6% + Near/Far vols; 7% roll with 19-day first gap (≈4.7713 pts) and open-month pin; forward paths use GBM from As Of Today through Simulation End (default 7300 days) with μ/σ estimated dynamically from **2001-01-01 → as-of**. Notes prose is structural reference only where it diverges from WF1 BS rates.


### GBM step (Monte Carlo)

Authority: desk Monte Carlo Excel layout + `gbm.py` / `mc_matrix.py`.

**Parameters** — estimated **dynamically every Run** from `nifty_daily.csv` closes **2001-01-01 through As Of Today** (latest synced session). Not hard-coded constants; the sample grows as `/api/sync` advances as-of.

| Symbol | Definition |
|--------|------------|
| \(S_0\) | As-of Nifty close |
| \(\mu\) | Mean daily simple return over **2001 → as-of** |
| \(\sigma\) | Sample stdev of daily returns (`STDEV` / `ddof=1`) |
| \(\mathrm{drift}\) | \(\mu - \tfrac12\sigma^2\) |

**Recurrence** (one Mon–Fri session):

\[
S_t = S_{t-1} \cdot \exp\bigl(\mathrm{drift} + \sigma \cdot Z\bigr),
\qquad Z \sim N(0,1)
\]

```text
S_t = S_{t-1} · exp(drift + σ · Z)
```

```excel
=prev * EXP($drift + $sigma * NORM.INV(RAND(), 0, 1))
```

**Path matrix (download / Excel layout):**

- Vertical \(1,2,3,\ldots\) = **path numbers**
- Horizontal = forward **trading dates** (ISO `YYYY-MM-DD`) from as-of through Simulation End
- Params block above the grid: S₀, μ, σ (%), drift, Estimation Start/End, path & date counts, formula
- For a fixed calendar date, Path \(i\) and Path \(j\) generally show **different** Nifty levels

**Desk downloads:** Home **Download Simulated Nifty Paths** and Intel → Monte Carlo Matrix both call `GET /api/forwardtest/{job_id}/mc-matrix.xlsx`.

Independent RNG per `path_id`. Shared forward calendar supplies expiry / futures-shift **dates** only; **levels and roll points** always come from that path’s simulated series. There is no shared forward price workbook.
