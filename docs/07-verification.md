# 07 — Verification

Use this playbook after **engine**, **market**, **product book**, or **WF1 parity** changes.

**Bible (local, gitignored):** `Gift AIF Working File 1.xlsm` + `AIF - Notes.xlsx`
**Runtime input:** `Product_Input_File.xlsx` (six put legs — same book as WF1 As per HS)
**Authority:** WF1 formulas override Notes where they differ (BS rates, vols).

Master index: [README.md](README.md).

---

## Executive Verdict (2026-07-25)

| Layer | Verdict | Evidence |
|-------|---------|----------|
| Path 1 / Path 10 terminal totals | **PASS** | Component-exact vs WF1 Summary (Δ ≈ 10⁻⁸–10⁻⁷ Cr) |
| Path 1 Hedging Sheet Req. Delta (1258 days) | **PASS** | 1258/1258 date-aligned; max \|Δ\| ≈ 2.67×10⁻⁵ |
| Path 235 Computation body (delta/futures stack) | **PASS** | Cols C–I, E–H, Q, R, T, W match engine on 1242 rows |
| Path 235 Computation roll/cash/NAV | **FAIL (Excel only)** | K/L/N/O/Z zeroed by A1≠body mismatch — not an engine bug |
| WF1 Summary cache (all paths) | **Mixed** | See bucket tables below — stale Excel, not NAV formula bugs |
| Engine beyond Path 235 | **PASS** | Monthly paths 236…250 through market last date |

**Crux:** Working File 1 As-per-HS quantities match `Product_Input_File.xlsx`. Notes define roll / NAV **structure**; Macro Paths in Excel still stop at Path 235 while the engine extends. BS: Forward **6.6%**, Discount **7.6%**, Near/Far vols per strike (Notes’ 7%/8%/13.3% is historical).

---

## Market As Of Today

| Series | Value |
|--------|------:|
| Nifty daily | 2001-01-01 → **latest session** (e.g. 2026-07-31 after sync) |
| First roll shift | 2001-01-25 |
| First roll cost | **4.7713** index pts (19 trading days) |
| Open-month roll | Pinned to latest Nifty session (`pin_current_month_roll_to_latest`) — Backtester parity |

Auto-sync triggers: API startup · `GET /api/sync` · `scripts/sync_market_data.py`. Trading-day / roll counts move with sync — do not hardcode them in desk copy.

---

## Backtester calculation parity (must hold)

| Check | Expected |
|-------|----------|
| `nav.py` / `black_scholes.py` | Identical to Gift AIF Backtester |
| Product rate defaults | Identical (Forwardtester adds Simulation End Days only) |
| First roll | 19 TD → ≈ 4.7713 |
| Open-month pin | `pin_current_month_roll_to_latest` on `load_market` + sync |
| Hedge observation Nifty | Path spot on/before expiry (equals `market.nifty_on` on history) |

```powershell
$env:PYTHONPATH = "backend"
.\.venv\Scripts\python.exe scripts\verify_roll_costs.py
```

---

## Forward Calendar (desk rules — must pass)

Horizon = **As Of Today** + **Simulation End Days** from Product Input (default **7300**). Final path ends on that date’s last Mon–Fri session.

| Rule | Expected |
|------|----------|
| Sessions | Mon–Fri only — **zero** Sat/Sun closes after as-of |
| Month lengths | Real calendar (28/29/30/31; leap Feb e.g. 2028-02-29) |
| Monthly option expiry | **Last Tuesday** of each complete month ≤ Simulation End |
| Futures shift | **Last trading day** (last Mon–Fri) of each complete month |
| Roll cost (first) | `avg(TD closes ≤ first shift) × 7% × N_td/365` — **19** TDs → ≈ **4.7713** |
| Roll cost (later) | `avg(TD closes in (prev, shift]) × 7% × calendar_Δt/365` — Sat/Sun in Δt, not in avg |
| Open-month hist roll | Pinned to latest Nifty session (Backtester `pin_current_month_roll_to_latest`) |
| Path spots | GBM on path trading days only; hedge/NAV = Backtester engines |
| Dynamic as-of | After deploy / `/api/sync`, as-of and horizon advance with latest Nifty |
| Intel UI | Market Calendar = shared dates; path Nifty / rolls on Hedging / MC Matrix |

```powershell
$env:PYTHONPATH = "backend"
.\.venv\Scripts\python.exe scripts\windup_suite.py
# or individually:
.\.venv\Scripts\python.exe scripts\verify_forward_calendar.py
.\.venv\Scripts\python.exe scripts\verify_roll_costs.py
.\.venv\Scripts\python.exe scripts\audit_forward_parity.py
.\.venv\Scripts\python.exe scripts\e2e_smoke_five.py
```

Intel `/api/market/{nifty,expiries,rolls}` returns **calendar / estimation** surfaces (hist Nifty for μ/σ; forward expiry & shift *dates*). Simulated prices and roll points are per path — Hedging / Computation / MC Matrix after a Run. Full path×date grid: Home **Download Simulated Nifty Paths** or `GET /api/forwardtest/{id}/mc-matrix.xlsx`.

### GBM estimation (must be dynamic)

| Check | Expected |
|-------|----------|
| Window | First Nifty date ≈ **2001-01-01** through **As Of Today** |
| Recompute | Every Run / after `/api/sync` advances as-of — μ, σ, drift are not hard-coded constants |
| Excel params | Download lists Estimation Start / Estimation End / As Of matching that window |
| Columns | Header row `Path \\ Date` then ISO trading dates as-of → Simulation End |

---

## Monthly Path Count (Forwardtester)

Path starts are **forward** from As Of Today through Simulation End (default **7300** calendar days). There is no historical Macro Paths pin file.

| Frequency (7300d sample, as-of 2026-07-31) | Paths | Start rule |
|-------------------------------------------|-----:|------------|
| Daily | **3233** | Every trading day in [as-of, last start] |
| Weekly | **785** | First trading day of each ISO week |
| Monthly | **182** | First trading day of each calendar month |
| Quarterly | **62** | First trading day of each quarter |
| Semi-annual | **32** | First trading day of each H1 / H2 |

Path 1 is always **As Of Today**. Last start is the latest date whose tenure still ends on Simulation End. Verify: `scripts/verify_path_counts.py`. Desk frequency dropdown shows live counts from `market.path_counts`.

**Deploy memory:** default frequency **Monthly**. All frequencies including **Daily** run path-by-path without a full float matrix in RAM. Excel export is queued + streamed; completed jobs are saved to Mongo so Download can recover after a restart.

Path count is **product-dependent**: `max(observation_months)` gates which starts still have a resolvable last observation on the live expiry calendar (float `m × 30.5`, same as hedge). Desk catalogue supports **1…7 observation months**. Regression: `scripts/verify_dynamic_products.py`, `scripts/windup_suite.py`.

**Stability pins (Forwardtester, not WF1 historical):**

| Check | Expected |
|-------|----------|
| Path 1 total (monthly, sample book) | Stable across re-runs (e.g. ≈ **85.1785** Cr at as-of 2026-07-31) |
| MC matrix | `n_paths` × `n_dates`; col-0 = S0; same date differs by path |
| μ / σ | Recomputed 2001-01-01 → as-of every Run |

Historical WF1 Path 1 / Path 10 golds apply to the **Backtester** twin only.

---

## Gold Pin Component Parity

### Path 1 (2026-07-25)

| Component | WF1 Summary (Cr) | Engine (Cr) | Δ (Cr) | Verdict |
|-----------|------------------:|------------:|-------:|---------|
| Invt | 100.0000000000 | 100.0000000000 | 0 | PASS |
| MTM Futures | 48.8223347082 | 48.8223346611 | −4.7×10⁻⁸ | PASS |
| Cash + Int | 7.0894837361 | 7.0894837346 | −1.4×10⁻⁹ | PASS |
| Gsec | 33.2093398102 | 33.2093398102 | −8.5×10⁻¹³ | PASS |
| Transaction Cost | −0.8528477289 | −0.8528477289 | −1.7×10⁻¹² | PASS |
| Fees | −7.4958904110 | −7.4958904110 | −9.9×10⁻¹⁴ | PASS |
| **Total** | **180.7724201145** | **180.7724200660** | **−4.9×10⁻⁸** | **PASS** |

Additional Path 1 anchors: Spot₀ = **1254.3** · Day-0 Req. Delta ≈ **972,694.91** · Observation expiries **2004-03-25 … 2005-09-29**.

### Path 10 (2026-07-25)

| Component | WF1 Summary (Cr) | Engine (Cr) | Δ (Cr) | Verdict |
|-----------|------------------:|------------:|-------:|---------|
| Invt | 100 | 100 | 0 | PASS |
| MTM Futures | (see JSON) | (see JSON) | ~2×10⁻⁷ on total | PASS |
| Cash + Int | match | match | ~10⁻⁸ | PASS |
| Gsec | match | match | ~10⁻¹² | PASS |
| Tx / Fees | match | match | ~10⁻¹² | PASS |
| **Total** | **216.4729879081** | **216.4729881312** | **+2.2×10⁻⁷** | **PASS** |

Full component rows: claim `D_path1_path10_totals`.

---

## Path 1 Hedging Sheet — 1258-Day Delta PASS

Path 1 Hedging Sheet Req. Delta tally:

| Metric | Value |
|--------|------:|
| HS trading days | **1258** |
| Engine trading days | **1258** |
| Date-aligned matches | **1258 / 1258** |
| Max \|Req. Delta engine − HS\| | **2.67×10⁻⁵** |
| Mean \|error\| | **4.51×10⁻⁶** |
| Day-0 engine | **972694.912599464** |
| Day-0 HS | **972694.912595786** |

Black–Scholes central difference (±0.5 spot bump), Forward 6.6%, Discount 7.6%, Near/Far vols per strike — identical book for all 235 paths.

**Verdict: PASS** — engine `hedge.py` / `black_scholes.py` matches WF1 As per HS row 3 daily strip.

---

## Path 235 Computation Column Verdicts

Saved WF1 has **A1=1** (HS Path 1) but Computation body **hardcoded for Path 235** (2020-07-01 → 2025-06-30). Roll gate `D14` = Path 1 last obs **2005-09-29**, so Excel zeros K on all Path-235 roll days. Engine implements WF1 **formulas** correctly on a consistent path.

Plausible rows compared: **1242**. Source: `path235_computation_column_tally.columns`.

| Col | Header | Compared | Verdict | Notes |
|-----|--------|----------|---------|-------|
| B | Date | 1242 | **PASS** | Path 235 window |
| C | Nifty | 1242/1242 exact | **PASS** | max err 0 |
| D | Req. Delta | 1242/1242 | **PASS** | max ~1.86×10⁻⁵ |
| E | Change in Delta | 1242/1242 | **PASS** | |
| G | Future Qty | 1242/1242 | **PASS** | |
| H | Fut. Cumulative | 1242/1242 | **PASS** | |
| I | MTM Futures | 1241/1241 | **PASS** | max ~5×10⁻¹⁰ |
| K | Rollover Cost | 1194/1241 | **FAIL** | 47 roll days Excel=0 (A1/D14 mismatch) |
| L | Tax Benefit | cascade | **FAIL** | follows K |
| N | Cash + MTM | 21/1242 | **FAIL** | cascade from missed rolls |
| O | Int on Cash | 21/1241 | **FAIL** | cascade |
| Q | Gsec | 1242/1242 | **PASS** | independent of K |
| R | Int. Gsec | 1241/1241 | **PASS** | |
| T | Tx Futures | 1242/1242 | **PASS** | |
| W | Fees | 1241/1241 | **PASS** | |
| Z | NAV post fees | 21/1242 | **FAIL** | Excel end ~208.64 vs engine ~197.27 |

Summary row for Path 235 dates (mislabeled `path_id=1` in Summary tail): engine **197.272** vs Excel **197.270** (Δ ≈ 0.003) — cache from a **correct** Path-235 run.

---

## Summary Bucket Findings

Two Summary scans use different bucketing; both confirm engine correctness on Path 1 / Path 10 anchors.

### A — Full discrepancy scan (2026-07-24)

Compares WF1 Summary components vs engine for all labeled paths.

| Bucket | Count | Meaning |
|--------|------:|---------|
| **tight** | **148** | \|ΔTotal\| < 1e−4 Cr |
| **soft_mtm** | **25** | Small MTM residual; total still reasonable |
| **gsec_stale** | **56** | Stale Gsec/fees band (~paths 105–160) |
| **hard_mtm** | **4** | Paths 39, 47, 163, 166 — MTM-only Summary drift |
| **missing** | **2** | Paths 234–235 ids absent / mislabeled |

### B — Date-aligned tally (2026-07-25)

Matches Summary rows by **start/end dates** (handles Path 235 mislabeled as id 1).

| Bucket | Count | Meaning |
|--------|------:|---------|
| **PASS_TIGHT** | **65** | \|ΔTotal\| < 1e−4 |
| **PASS_SOFT** | **84** | \|ΔTotal\| < 0.05 Cr |
| **GSEC_STALE_CACHE** | **5** | Paths 106, 107, 110, 132, 138 — Gsec/fees stale, MTM OK |
| **HARD_MTM_OR_CACHE** | **80** | Mostly paths 35–160 band — MTM/cash Summary drift |
| **MISSING_SUMMARY** | **1** | Path 234 — no date-matched Summary row |

**Component stats (date-aligned, n=234 compared):**

| Component | Tight | Soft | Fail | Max \|Δ\| (Cr) |
|-----------|------:|-----:|-----:|---------------:|
| Invt | 234 | 0 | 0 | 0 |
| MTM | 66 | 91 | 77 | 9.81 |
| Cash | 86 | 104 | 44 | 0.73 |
| Gsec | 178 | 0 | 56 | 31.28 |
| Tx | 153 | 78 | 3 | 0.16 |
| Fees | 178 | 0 | 56 | 0.12 |
| Total | 65 | 84 | 85 | 32.20 |

**Interpretation:** Invt is exact on every compared path. Hard failures cluster in WF1 Summary **cached rows** (especially Gsec band 105–160 and duplicate/mislabeled tail). Engine recomputes live — trust **Analytics / engine** over stale Summary cells.

**Summary date-alignment caveat:** Sheet tail has **path_id=1 twice** — real Path 1 and Path **235** dates mislabeled as 1. Paths **234** and **235** ids missing from labels; tally uses date windows.

---

## Product Book (WF1 = Live)

| Source | Book (Excel order) |
|--------|--------------------|
| WF1 As per HS + `Product_Input_File.xlsx` | −91.5@137 · +90.5@136 · +1@125 · −25.6@85 · +24@84 · +1@70 |

Forward **6.6%**, Discount **7.6%**, Near/Far vols **path-invariant** (identical Path 1…235). Full table: [09-formulas-and-product-books.md](09-formulas-and-product-books.md) · [03-product-input-spec.md](03-product-input-spec.md).

---

## Excel Consistency Caveats

### A1 vs Computation body

| Sheet | A1 behaviour |
|-------|----------------|
| As per HS | **Live** — A1 selects path; D14 = last obs of that path |
| Computation | **Often pasted** — B/C/D may be hardcoded for a single path (235 in saved file) |

When A1 path ≠ Computation body path, col **K** zeros for dates > `D14` → N, O, Z cascade fail. Recalculate Excel with matching A1, or trust Summary (when healthy) / **engine**.

### Paths 105–160

Macro Paths strip length in CSV is **+21 trading days** vs live Nifty calendar for same start/end. Engine uses **live** sessions. Same band as Summary Gsec stale cache. Windows (start/end dates) remain exact vs WF1.

---

## Smoke / market regen

Requires local `Gift AIF Working File 1.xlsm` only for Excel Summary checks in `verify_monthly_excel.py`.

```bash
# From repo root (directory containing start.sh)

# Path pins + Path 1/10 smoke vs Excel Summary
PYTHONPATH=backend .venv/bin/python scripts/verify_monthly_excel.py

# Dynamic obs/tenure books
PYTHONPATH=backend .venv/bin/python scripts/verify_dynamic_products.py

# Market CSV extend-through-present
PYTHONPATH=backend .venv/bin/python scripts/sync_market_data.py
```

---

## Automated Smoke Tests

### 1 — Path 1 total (no Excel required)

```bash
# From repo root
PYTHONPATH=backend .venv/bin/python - <<'PY'
from backend.app.engine.product import parse_product_workbook
from backend.app.engine.market import load_market
from backend.app.engine.paths import build_paths
from backend.app.engine.backtest import _evaluate_path

p = parse_product_workbook('Product_Input_File.xlsx')
assert len(p.active_legs) == 6
assert not any(abs(lg.quantity - 0.6) < 1e-9 for lg in p.legs), "legacy 0.6 hedge row must not be present"

m = load_market
path1 = next(x for x in build_paths(m, p.tenure_days, 'monthly') if x.path_id == 1)
s, _ = _evaluate_path(path1, p, m, store=False)
assert abs(s.total - 180.77242011453939) < 1e-4, s.total
print('Path 1 OK', s.total)
PY
```

### 2 — verify_monthly_excel.py (full pin + Path 10)

```bash
PYTHONPATH=backend .venv/bin/python scripts/verify_monthly_excel.py
```

Expect: Path 1 ≈ **180.772420**, Path 10 ≈ **216.472988**, ≥235 monthly paths, last pin 2020-07-01.

### 3 — API health (local or production)

```bash
curl -s http://127.0.0.1:8000/api/health | python3 -m json.tool
curl -s http://127.0.0.1:8000/api/sync | python3 -m json.tool
```

Production: hit the same paths via Vercel proxy (`/api/health`, `/api/sync`).

### 4 — Six-leg book guard

```bash
PYTHONPATH=backend .venv/bin/python -c "
from backend.app.engine.product import parse_product_workbook
p = parse_product_workbook('Product_Input_File.xlsx')
qs = [round(lg.quantity, 1) for lg in p.active_legs]
assert qs == [-91.5, 90.5, 1.0, -25.6, 24.0, 1.0], qs
print('Book OK', qs)
"
```

### 5 — Dynamic products (any observation count)

```bash
PYTHONPATH=backend .venv/bin/python scripts/verify_dynamic_products.py
```

Expect PASS for every observation count **1…7** (prefix + suffix schedules), early vs late 3-obs path counts, weekly/quarterly, one-leg books, rejection of 0 / 8+ observations, and Path 1 / Path 10 gold on the live 7-obs sample.

---

## Manual Desk Checks

After `./start.ps1` / `./start.sh` or production deploy

1. **Product tab** — six As-per-HS legs; Observation months **38, 41, 44, 47, 50, 53, 56**; no Maturity Value column in sample.
2. **Run** — Home GBM band: Estimation **2001-01-01 → As Of Today**; S₀ / μ / σ / drift present.
3. **Home → Download Simulated Nifty Paths** — Excel has params + path rows × date columns through Simulation End.
4. **Desk → Hedging Sheet / Computation** — selected path populates; sample monthly gold Path 1 Total ≈ **180.77** Cr only when feeding historical Backtester windows (parity engines).
5. **Desk → Daily Ledger** — charts render for selected path.
6. **Intel → Market Calendar** — futures shift / expiry **dates** only (no Nifty or roll-cost columns).
7. **Intel → Monte Carlo Matrix** — preview + Download Excel matches Home file.
8. **Header strip** — As Of Today · Simulation End · Simulation End Days · Trading Days · Monthly Expiries (horizon counts).
9. **Production** — follow [08-deploy-vercel-render.md](08-deploy-vercel-render.md); Vercel `/api/health` proxies to Render.

---

## When To Re-Run Verification

| Change | Minimum checks |
|--------|----------------|
| `nav.py`, `hedge.py`, roll logic | Smoke Path 1 + Path 10 + `verify_monthly_excel.py` + `verify_roll_costs.py` |
| `calendar_build` pin / market sync | Open-month roll = last Nifty date; first roll ≈ 4.7713 |
| `product.py` / Product Input sample | Six-leg book guard + Path 1 total + Simulation End Days default 7300 |
| Market CSVs / sync | `/api/sync` meta + first roll cost ≈ 4.7713 |
| Path builder / tenure / forward calendar | `verify_forward_calendar.py` + dynamic product suite |
| `gbm.py` / `mc_matrix.py` | Home download Excel: 2001→as-of params + date columns; MC Matrix differs by path |
| Intel / UI | Market Calendar = dates; header horizon meta from live product calendar |
| Deploy / env | Render `/api/health` + Vercel `/api/health` with `BACKEND_URL` |

---

## Related Docs

| Doc | Purpose |
|-----|---------|
| [docs/README.md](README.md) | Doc index and reading order |
| [09-formulas-and-product-books.md](09-formulas-and-product-books.md) | Stage formulas and live book |
| [02-excel-sheet-logic.md](02-excel-sheet-logic.md) | WF1 sheet mirror |
| [04-forwardtest-engine.md](04-forwardtest-engine.md) | Engine pipeline |
| [08-deploy-vercel-render.md](08-deploy-vercel-render.md) | Layman Vercel + Render + all env vars |
