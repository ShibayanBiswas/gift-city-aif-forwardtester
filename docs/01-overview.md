# 01 — Overview

## Purpose

Gift City AIF Forward Tester is a production-style Anand Rathi Wealth desk application that answers:

> *From today’s Nifty close through Simulation End, what do terminal value, IRR, and path behaviour look like under Geometric Brownian Motion, using the same hedge and Computation engine as the Backtester?*

The web app is a **live reimplementation** of `Gift AIF Working File 1.xlsm` hedging and Computation methodology. Path starts are forward from **as-of** (latest Nifty session), not historical 2001 rolling windows. Narrative methodology lives in `AIF - Notes.xlsx` (local, gitignored). Visual language: maroon / gold glass panels, Cormorant Garamond display type, full-width desk sections.

**Authority rule:** When Notes prose and WF1 formulas disagree — for example Notes Forward 7% / Discount 8% / Vol 13.3% vs WF1 Forward **6.6%** / Discount **7.6%** / per-strike Near–Far vols — the engine follows WF1.

---

## What the Desk Gets

| Capability | Detail |
|------------|--------|
| Any product input | Parse principal, tenure days, Simulation End Days, observation months, option book |
| Forward path atlas | Frequency starts from **as-of** through last start so the **final path ends on Simulation End** |
| Forward calendars | Sat/Sun closed; monthly expiry = last Tuesday; futures shift = last trading day of month; leap/30/31 aware |
| Hedging Sheet parity | Same as Backtester: `month × 30.5` → expiry map; options book; required futures delta |
| Computation parity | Same as Backtester: MTM, rolls, cash, G-Sec, fees, tx, NAV, IRR |
| Header horizon strip | **As Of Today** · Simulation End · Simulation End Days · Trading Days · Monthly Expiries (as-of→horizon; horizontal scroll) |
| Intel Market DB | Rolls, expiries, closes from as-of → Simulation End; forward closes via Path One GBM |
| Desk UX | Full-form labels, Title Case, branded Excel downloads, card rails that scroll sideways instead of wrapping |
| Ops | Local `./start.ps1`, optional MongoDB Atlas, Vercel + Render |

Default UI / API path frequency: **Daily**. Simulation End Days default: **3650**. See [04-forwardtest-engine.md](04-forwardtest-engine.md).

---

## Default Sample Product (`Product_Input_File.xlsx`)

Matches **Working File 1 · As per HS** book (six put legs only). Full parser spec: [03-product-input-spec.md](03-product-input-spec.md). Complete formula reference: [09-formulas-and-product-books.md](09-formulas-and-product-books.md).

| Field | Value |
|-------|--------|
| Principal | ₹100 crore (`1e9` INR notional) |
| Tenure | 1930 calendar days |
| Observation months | **38, 41, 44, 47, 50, 53, 56** |
| Option type | Put Option (all six legs) |
| Forward / Discount | **6.6% / 7.6%** (path-invariant; Discount = Forward + 1%) |
| Options book | −91.5 @ 137% · +90.5 @ 136% · +1 @ 125% · −25.6 @ 85% · +24 @ 84% · +1 @ 70% |

Strike = `Spot₀ × Strike% / 100`. Path 1 Total (WF1 Summary / engine) ≈ **180.7724** Cr. Component stack verified to ~10⁻⁸ Cr: MTM ≈ 48.8223 · Cash+Int ≈ 7.0895 · Gsec ≈ 33.2093 · Tx ≈ −0.8528 · Fees ≈ −7.4959.

**Anchors:** Path 1 and Path 10 match WF1 Summary to component precision. Path 1 Req. Delta: **1258/1258** (max |Δ| ≈ 2.67×10⁻⁵). Smoke playbook: [07-verification.md](07-verification.md).

**Vol Near ≠ Vol Far; both path-invariant.** Column H on As per HS is hardcoded per strike — not XLOOKUP from Macro Paths.

---

## End-to-End Data Flow

```
Product_Input_File.xlsx (or upload)
 │
 ▼
 product.py → ProductSpec (principal, tenure, Simulation End Days, obs months, legs)
 │
 ▼
 market.py + market_sync.py → historical Nifty / rolls / expiries through present (as-of)
 │
 ▼
 forward_calendar.py → Mon–Fri pad to Simulation End
                         · last-Tuesday monthly expiries
                         · month-end futures shifts + 7% rolls
                         · Path-1 GBM closes for Intel
 │
 ▼
 paths.py → staggered forward tenure windows (Path 1 = as-of … final path ends on Simulation End)
            per-path GBM spots on trading days only
 │
 ├─► hedge.py → observations · legs · req_delta[]   (Backtester-identical)
 └─► nav.py → daily Computation · summary · IRR     (Backtester-identical)
 │
 ▼
 FastAPI job → KPIs · yearly rollup · on-demand path detail
 │
 ▼
 Next.js desk → Home · Analytics · Desk · Intel
```

Sheet-level mirror map: [02-excel-sheet-logic.md](02-excel-sheet-logic.md). Module map: [04-forwardtest-engine.md](04-forwardtest-engine.md), [05-architecture.md](05-architecture.md).

---

## Path Identity Checks (Hedge / NAV Parity Anchors)

Forwardtester **path starts are from as-of**, not 2001 Macro Path pins. The rows below are **Backtester / WF1 gold pins** used to keep `hedge.py` + `nav.py` byte-identical when fed the same historical spots. Full tables: [09-formulas-and-product-books.md](09-formulas-and-product-books.md) §11 · [07-verification.md](07-verification.md).

| Check | Expected |
|-------|----------|
| WF1 Path 1 window | `2001-01-01 → 2005-12-30` (1258 trading days) — Backtester parity only |
| WF1 Path 1 Total | **180.7724201145** Cr WF1 · engine Δ ≈ 10⁻⁸ |
| WF1 Path 10 Total | **216.4729879081** Cr WF1 · engine Δ ≈ 10⁻⁷ |
| First futures roll (hist) | 19 TD from Jan-2001 → ≈ **4.7713** pts |
| Forward Path 1 | Starts on **As Of Today** (latest Nifty session) |
| Forward final path | Ends on **Simulation End** (as-of + Simulation End Days) |
| Header Trading Days / Expiries | Count **as-of → Simulation End** (Mon–Fri; last-Tuesday expiries) |

---

## What “Net Required Futures Delta” Means

For one path and one trading day, the Hedging Sheet sums Black–Scholes central-difference deltas across the **active** options book:

\[
\text{Req. Delta}_t = \sum_{\text{legs}} \Delta_{\text{BS}}(S_t, K, \tau, \sigma) \times Q_{\text{contract}}
\]

This is Excel Computation column **Req. Delta** / As per HS daily aggregate — **not** a sum across different paths. Contract quantity per leg per observation:

```
contract_qty = raw_qty × principal / Spot₀ / n_obs
```

BS inputs: Forward **6.6%**, Discount **7.6%**, Vol Near on observation 1, Vol Far on observations 2…7 (path-invariant). Central bump **±0.5**; Excel does not divide by `2×bump`. Full formula set: [09-formulas-and-product-books.md](09-formulas-and-product-books.md).

---

## Documentation Map (This Set)

| Doc | Role |
|-----|------|
| [01-overview.md](01-overview.md) | This page — purpose, default product, gold pins, authority rule |
| [02-excel-sheet-logic.md](02-excel-sheet-logic.md) | WF1 sheet-by-sheet formulas and engine mirror |
| [03-product-input-spec.md](03-product-input-spec.md) | Upload format, parser, active book |
| [04-forwardtest-engine.md](04-forwardtest-engine.md) | Engine pipeline, modules, frequencies |
| [05-architecture.md](05-architecture.md) | Repo layout, API, persistence, performance |
| [06-ui-ux.md](06-ui-ux.md) | Desk tabs, path picker, Logic Atlas |
| [07-verification.md](07-verification.md) | Smoke tests, parity anchors, regen scripts |
| [08-deploy-vercel-render.md](08-deploy-vercel-render.md) | Production deployment |
| [09-formulas-and-product-books.md](09-formulas-and-product-books.md) | Complete formula reference, six-leg book, gold pins |

Master index: [README.md](README.md).

---

## Quick Desk Workflow

1. Open UI → **Sample Input** (or upload custom product) → confirm Product tab shows six put legs and observation months **38…56**.
2. Set **Path Frequency** (default **Daily**) → **Run**.
3. Spot-check **Path 1** on Hedging Sheet (observations, Fwd/Disc/Vols) and Computation result block (Total ≈ **180.77**).
4. Use Analytics Yearly Lab / Path Summary for distribution; Intel Logic Atlas for pipeline map.
5. After engine changes, run verification in [07-verification.md](07-verification.md).
