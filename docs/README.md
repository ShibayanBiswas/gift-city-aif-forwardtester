# Gift City AIF Forwardtester — Documentation Index

Gift City AIF Forwardtester projects structured-unit outcomes from **As Of Today** (latest Nifty close) through **Simulation End** under Geometric Brownian Motion. Hedge and Computation follow **`Gift AIF Working File 1.xlsm`**. When Notes narrative and WF1 formulas disagree, the engine follows WF1.

**Source repo:** https://github.com/ShibayanBiswas/gift-city-aif-forwardtester

| Doc | Topic |
|-----|--------|
| [01-overview.md](01-overview.md) | Purpose, desk capabilities, sample product, header horizon strip |
| [02-excel-sheet-logic.md](02-excel-sheet-logic.md) | WF1 sheet mirror + forward calendar + roll day-count |
| [03-product-input-spec.md](03-product-input-spec.md) | Product Input + Simulation End Days |
| [04-forwardtest-engine.md](04-forwardtest-engine.md) | Path atlas, GBM, Mon–Fri pad, hedge/NAV Backtester parity |
| [05-architecture.md](05-architecture.md) | Next.js + FastAPI + GitHub layout |
| [06-ui-ux.md](06-ui-ux.md) | Desk UI, Home download, Intel · Market Calendar / MC Matrix |
| [07-verification.md](07-verification.md) | Checks · `scripts/windup_suite.py` · calendar / MC / rolls |
| [08-deploy-vercel-render.md](08-deploy-vercel-render.md) | **Layman** Vercel + Render deploy + **all** env vars |
| [09-formulas-and-product-books.md](09-formulas-and-product-books.md) | Formulas + forward calendars + roll 7% + GBM |

## Recent desk locks (keep docs in sync)

| Area | Current rule |
|------|----------------|
| Simulation End Days | default **7300**; final path ends on as-of + days |
| Header chips | As Of Today · Simulation End · Simulation End Days · Trading Days · Monthly Expiries (as-of→horizon) |
| Forward calendar | Mon–Fri; last-Tuesday monthly expiry; month-end futures shift |
| Roll cost | First = trading-day count (19 → ≈4.7713); later = calendar Δt; weekends never in avg |
| Historical open month | `pin_current_month_roll_to_latest` (Backtester-identical) |
| Hedge / NAV | `black_scholes` identical to Backtester; `nav`/`hedge` add path-local roll points / spots |
| GBM μ / σ | **Dynamic** every Run from Nifty **2001-01-01 → today’s as-of** (`estimate_gbm_params`) |
| GBM matrix | Rows = path \(1,2,3,\ldots\); cols = **trading dates** as-of→Simulation End; \(S_t = S_{t-1}\cdot\exp(\mathrm{drift}+\sigma Z)\) |
| Home download | **Download Excel** → branded Parameters + Simulated Nifty sheets |
| Intel · Market Calendar | Shared futures shift / monthly expiry **dates** only (path Nifty & roll points on MC Matrix / Hedging / Computation) |
| Intel · MC Matrix | Preview table + same Excel download as Home |
| Card rails | Backtester-parity glass / meta-chip / equal header grid |
| Per-path rolls | Calendar shift dates shared; roll points = 7% × path avg spot × day fraction |
| Deploy | Render root `backend` · Vercel root `frontend` · Render: `MONGODB_*` · Vercel: `BACKEND_URL` |

**Dynamic Product Input:** Upload or change any field (Simulation End Days, tenure, observations, legs, rates). The desk refreshes market meta immediately; prior Run results clear when the product fingerprint no longer matches. Header · Intel · Logic Atlas · path atlas all key off the live `ProductSpec` — nothing is frozen to sample 1930/7300 except as the engine default when the Excel field is blank.
