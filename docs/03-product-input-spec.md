# 03 — Product Input Specification

The Product Input workbook is the **sole desk-controlled input** to the Forward Test Engine. Whatever you upload (or the shipped sample) becomes the options book, observation schedule, principal, and tenure for every path on **Run**. The engine does not read WF1 at runtime — it parses Product Input and pins WF1-equivalent defaults where cells are blank.

**Related:** Active book formulas [09-formulas-and-product-books.md](09-formulas-and-product-books.md) · WF1 mirror [02-excel-sheet-logic.md](02-excel-sheet-logic.md) · Parser `backend/app/engine/product.py` · UI Product tab [06-ui-ux.md](06-ui-ux.md) · `frontend/components/ProductSpecTables.tsx`

---

## Files and API Surface

| File / endpoint | Role |
|-----------------|------|
| `Product_Input_File.xlsx` | Default / sample product **tracked in repo** |
| `GET /api/product/sample` | Header **Sample Input** — downloads branded sample |
| `POST /api/product/upload` | Header **Upload** — accepts `.xlsx` / `.xlsm` |
| `GET /api/product/current` | Returns parsed spec for Product tab |
| `data/uploads/current_product.xlsx` | Gitignored copy of last upload |
| Mongo (optional) | Product upsert + upload log when `MONGODB_URI` set on **Render** (never on Vercel) |

Upload flow: file copied to `data/uploads/` → parsed → optional Mongo upsert → next **Run** uses new spec. Prior job may be cancelled when a new run starts ([05-architecture.md](05-architecture.md)).

Sample file is built by `scripts/build_product_input.py` with Anand Rathi logo and desk borders. Rates display as Excel percentages (e.g. Forward **6.60%**); option type as **Put Option** (not `P`).

---

## Required Content

The parser (`backend/app/engine/product.py`) scans the **first sheet** that looks like a product/input sheet (label rows for Principal, Tenure, Observation, Qty).

| Item | How it is found | Validation / notes |
|------|-----------------|-------------------|
| Principal | Row label containing `Principal` + numeric value | INR notional (e.g. `1000000000` = ₹100 Cr). Cash / G-Sec sleeves scale with this. |
| Tenure Days | Label containing `Tenure` + integer | Calendar days for product economics / IRR (sample: **1930**) |
| Cash Buffer % | Label containing `Cash Buffer` (or Cash %) | Fraction of principal at day 0 (sample **5%** → 5 Cr on 100 Cr, 2.5 Cr on 50 Cr) |
| G-Sec Sleeve % | Label containing `G-Sec` / `Gsec` sleeve | Residual bond sleeve (sample **95%**). If cash+gsec ≠ 100%, engine sets gsec = 1 − cash. |
| Cash / G-Sec Interest | `Cash Interest Rate`, `G-Sec Interest Rate` | Sample **6%** / **6%** |
| Management Fee Rate | `Management Fee Rate` / `Fee Rate` | Sample **1.5%** of principal × Δt/365 |
| Buy / Sell Brokerage | `Buy Brokerage`, `Sell Brokerage` | Futures Tx rates **every day** (including day 0). Single rate card — no Buy/Sell Rate or Rate Switch Date. |
| GST Rate | `GST Rate` | WF1 AG = AF × rate (sample **18%**); cash AF currently 0 |
| Futures Roll Rate | `Futures Roll Rate` | Sample **7%** — scales `roll_costs.csv` (built at 7%) |
| Tax Benefit On Roll | `Tax Benefit On Roll` | Sample **42.744%** of roll cost |
| Monte Carlo Paths | `Monte Carlo Paths` / `N Paths` / `Path Count` | Independent GBM seeds over the single as-of → Product End window. Default **1000** if omitted; clamp **1…10000**. UI presets 100 / 500 / 1000 / 5000 / 10000 or Custom. Confirm at ≥ 5000. Free hosts clamp near **2000**. |
| Simulation End Days | `Simulation End Days` / `Horizon Days` | **Legacy only** — parsed for workbook compat but **ignored as horizon**. Product End = `path_end_calendar(asof, tenure)`. |
| Observation months | Column under an `Observation` header | Offsets in `[1, 120]`; sample: **38, 41, 44, 47, 50, 53, 56** |
| Options book | Header row with `Qty` / `Quantity` | One row per strike level; signed quantities |

### Parser tolerance

The parser accepts

- Excel percent cells (`6.60%` stored as 0.066)
- Percent-point numbers (`6.6` meaning 6.6%)
- Strings (`6.6%`, `Put Option`, `P`)
- Optional `Include` column (`Yes` / `No`) — excluded legs skipped by `active_legs`

**Do not include a Maturity Value column** — payoff / XIRR display columns are not engine input.

---

## Options Book Columns (Working File 1 layout)

| Column | Required | Default / notes |
|--------|----------|-----------------|
| Return Level | Yes | Used with Strike % |
| Strike % | Preferred | Else `(1 + return) × 100` |
| Option | No | **P** / Put Option by default |
| Forward | No | **0.066** (6.6%) — path-invariant in As per HS |
| Discount | No | **0.076** (Forward + 1%) |
| Vol Near | No | 1st observation vol (Excel H for obs 1) |
| Vol Far / Vol | No | Observations 2…7 (Excel H thereafter) |
| Qty | Yes | Signed raw quantity (sold = negative) |
| Include | No | `Yes` / `No` — defaults to included |

Rates are **path-invariant**: Forward **6.6%**, Discount **7.6%**, Near/Far vols identical for Path 1 and Path 235. Changing Macro Path in Excel **does not** reload vols from Macro Paths.

---

## Active Book (Working File 1 · As per HS)

**Only these six levels** — no extra return-grid rows and no full-hedge 0.6 row. All legs are **Put Option**.

**Path invariance (all 235 Macro Paths):** Forward, Discount, and Near/Far vols are **the same for Path 1 and Path 235**. Hardcoded on As per HS (col F/H; G=`F+1%`). Engine audit: **0 paths** with a different vol set.

### Desk / Product Input display

| # | Side | Type | Qty | Strike % | Return | Fwd | Disc | IV 1st obs | IV later obs |
|--:|------|------|----:|---------:|-------:|----:|-----:|-----------:|-------------:|
| 1 | Sold Put Option | Put Option | −91.5 | 137.00% | 37.00% | 6.60% | 7.60% | 14.37% | 14.79% |
| 2 | Bought Put Option | Put Option | 90.5 | 136.00% | 36.00% | 6.60% | 7.60% | 14.42% | 14.85% |
| 3 | Bought Put Option | Put Option | 1.0 | 125.00% | 25.00% | 6.60% | 7.60% | 15.12% | 15.62% |
| 4 | Sold Put Option | Put Option | −25.6 | 85.00% | −15.00% | 6.60% | 7.60% | 20.24% | 20.61% |
| 5 | Bought Put Option | Put Option | 24.0 | 84.00% | −16.00% | 6.60% | 7.60% | 20.41% | 20.77% |
| 6 | Bought Put Option | Put Option | 1.0 | 70.00% | −30.00% | 6.60% | 7.60% | 23.01% | 23.20% |

UI Trade Side labels: **Sold Put Option** / **Bought Put Option** ([06-ui-ux.md](06-ui-ux.md)).

### Exact fractions pinned in engine / HS (0 bp vs Excel)

| Qty | Strike % | Vol Near | Vol Far |
|----:|---------:|---------:|--------:|
| −91.5 | 137 | 0.14368857564668683 | 0.14793275750723667 |
| 90.5 | 136 | 0.1441638312604284 | 0.14848846191959258 |
| 1 | 125 | 0.15118881279350588 | 0.15619717745743442 |
| −25.6 | 85 | 0.20241167320096648 | 0.2061305717267251 |
| 24 | 84 | 0.2041294400033543 | 0.20774616738378116 |
| 1 | 70 | 0.23005561163223529 | 0.2319842472882776 |

In As per HS each strike is repeated **7 times** (one row per observation). Product Input stores each strike **once**; the engine expands × **7** observations. Obs 1 uses Vol Near; obs 2…7 use Vol Far.

Observation months (separate column): **38, 41, 44, 47, 50, 53, 56**.

---

## Parsed Object (`ProductSpec`)

| Field | Type / meaning |
|-------|----------------|
| `principal` | INR notional (float) |
| `tenure_days` | Calendar days (int) |
| `cash_pct` / `gsec_pct` | Day-0 sleeves as fractions of principal (sample 5% / 95%) |
| `cash_rate` / `gsec_rate` | Interest rates (sample 6% / 6%) |
| `fee_rate` | Management fee on principal (sample 1.5%) |
| `buy_brokerage` / `sell_brokerage` | Futures Tx rates every day (including day 0) |
| `buy_rate` / `sell_rate` | Aliases kept equal to brokerage |
| `roll_rate` / `tax_benefit_rate` | Futures roll carry (sample 7%); tax display factor |
| `observation_months` | `list[float]` — month offsets × 30.5 applied at runtime |
| `legs` | `list[OptionLegSpec]` — all rows parsed |
| `active_legs` | Legs with `include=True` — **engine uses only these** |
| `principal_cr` | Derived: principal / 1e7 |
| `cash_buffer_cr` / `gsec_opening_cr` | Derived: principal_cr × cash_pct / gsec_pct |
| `n_obs` | `len(observation_months)` — divisor for contract qty (7 for sample) |
| `n_paths` | Optional Excel int; `to_dict()` always exposes **resolved** Monte Carlo Paths (default **1000**, clamp 1…10000) |
| `simulation_end_days` | Legacy Excel int if present — **not** used for horizon; `to_dict()` exposes tenure days as API compat span |
| `simulation_end_days_source` | Always `"tenure"` for the live horizon |

Each `OptionLegSpec` carries: `quantity`, strike/return, `option_type`, `forward_rate`, `discount_rate`, `vol_near`, `vol`, `include`.

Defaults when rate cells blank (WF1 HS): Forward **6.6%**, Discount **7.6%**. UI shows `—` when absent rather than inventing display rates.

Changing tenure or Monte Carlo Paths (or any product field) refreshes header horizon meta; a prior Run is cleared when the product fingerprint no longer matches. Market Calendar dates refresh with Product End; per-path GBM Nifty / rolls rebuild on the next Run.

---

## Engine Use Per Path

| Field | Source | Used on each path? |
|-------|--------|---------------------|
| Observation months | Product Input | Yes — same offsets; **dates shift** with path start |
| Forward / Discount / Vol Near / Far | Product Input legs | Yes — **path-invariant** book |
| Principal / tenure | Product Input | Yes |
| Spot₀, strikes, contract qty, daily delta, NAV | Derived from market + path | Path-specific |

Path 1 gold total with brokerage card throughout: **180.7851** Cr ([07-verification.md](07-verification.md)).

---

## Contract Quantity (Hedging Sheet)

For each **active** leg and each observation expiry

```
contract_qty = raw_qty × principal / Spot₀ / n_obs
Strike = Spot₀ × Strike% / 100
Vol = Vol Near on observation 1; Vol Far on observations 2…7
BS rates = Forward / Discount from leg (defaults 6.6% / 7.6%)
```

Matches WF1 As per HS col I: `=A*1000000000/$J$5/7`.

Daily **Req. Delta** = sum of central BS delta × contract_qty across all leg×obs rows for that day. See [09-formulas-and-product-books.md](09-formulas-and-product-books.md).

---

## Tips for Building a New Product Sheet

1. Keep **Principal** and **Tenure** near the top left with clear labels.
2. Put observation months in one clean numeric column under header **Observation** (or similar).
3. Align return / strike / qty / option / forward / discount / vols / Include in one table.
4. Mark full-hedge or unused levels with `Include=No` (red fill optional).
5. **Upload** → confirm **Product** tab (six sections: spec + observation map + options book) → set **Monte Carlo Paths** → **Run** → spot-check Path 1 Hedging Sheet vs WF1.
6. Do not rely on Notes 7%/8%/13.3% BS rates — live WF1 book uses **6.6%/7.6%** + Near/Far.

---

## Verification Checklist (after upload)

| Step | Pass criterion |
|------|----------------|
| Product tab | 6 active put legs; obs months **38…56** |
| Path 1 Run | Total ≈ **180.7851** if book matches sample (Backtester hist gold; Forwardtester uses GBM) |
| Hedging Sheet | Fwd **6.6%**, Disc **7.6%**, vols match table above |
| Parser smoke | `len(active_legs) == 6`; no 0.6 qty leg |

Scripted smoke: [07-verification.md](07-verification.md).

---

## In-app Product (Desk → Product)

The web app renders the live book through `ProductSpecTables` (`frontend/components/ProductSpecTables.tsx`)

| UI section | Content |
|------------|---------|
| Product meta strip | Principal, tenure, obs window, book→HS, Fwd/Disc, NAV seeds (also on Home) |
| Observation Months | Month offsets and calendar days (×30.5) from Product Input |
| Options Book table | Excel row order (never sorted by Sold/Bought) |

Engine formulas and Computation seeds remain in docs 09/11 — not duplicated as UI bible panels.

