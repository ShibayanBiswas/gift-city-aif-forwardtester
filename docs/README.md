# Gift City AIF Forwardtester — Documentation Index

Gift City AIF Forwardtester projects structured-unit outcomes from **As Of Today** (latest Nifty close) through **Product End** under Geometric Brownian Motion. Hedge and Computation follow **`Gift AIF Working File 1.xlsm`**. When Notes narrative and WF1 formulas disagree, the engine follows WF1.

**Source repo:** https://github.com/ShibayanBiswas/gift-city-aif-forwardtester

| Doc | Topic |
|-----|--------|
| [01-overview.md](01-overview.md) | Purpose, desk capabilities, sample product, header horizon strip |
| [02-excel-sheet-logic.md](02-excel-sheet-logic.md) | WF1 sheet mirror + forward calendar + roll day-count |
| [03-product-input-spec.md](03-product-input-spec.md) | Product Input + Monte Carlo Paths |
| [04-forwardtest-engine.md](04-forwardtest-engine.md) | Path atlas, GBM, Mon–Fri pad, hedge/NAV Backtester parity |
| [05-architecture.md](05-architecture.md) | Next.js + FastAPI + GitHub layout |
| [06-ui-ux.md](06-ui-ux.md) | Desk UI, Home download, Intel · Market Calendar / Monte Carlo Matrix |
| [07-verification.md](07-verification.md) | Checks · `scripts/windup_suite.py` · **wind-up confirmation** · calendar / Monte Carlo / rolls |
| [08-deploy-vercel-render.md](08-deploy-vercel-render.md) | **Layman** Vercel + Render deploy + **all** env vars |
| [09-formulas-and-product-books.md](09-formulas-and-product-books.md) | Formulas + forward calendars + roll 7% + GBM |

## Recent desk locks (keep docs in sync)

| Area | Current rule |
|------|----------------|
| Product End | `path_end_calendar(asof, tenure)` — Start = as-of; every path shares one tenure window |
| Monte Carlo Paths | default **1000**; presets **100 / 500 / 1000 / 5000 / 10000** or Custom 1…10000; confirm at **≥ 5000**; free hosts clamp near **2000** |
| Header chips | As Of Today · Product End · Tenure Days · Monte Carlo Paths · Trading Days · Monthly Expiries — full-width equal cards |
| Horizon (legacy) | **Simulation End Days** / frequency start grids are **ignored** — not the horizon |
| Forward calendar | Mon–Fri (+ stable projected holidays / fixed national dates); monthly option expiry = futures shift (Thu→Tue era; holiday → prior session); **as-of month included** when expiry still ahead |
| Roll cost | First = trading-day count (19 → ≈4.7713); later = calendar Δt; weekends never in avg |
| Futures / expiry calendars | Identical lists: `roll_shifts == expiries` (WF1 / Backtester) — no open-month last-TD pin |
| Hedge / NAV | `black_scholes` byte-identical; `nav`/`hedge` forked twins with path-local roll points / spots |
| Daily as-of | Yahoo sync on calendar-day roll + Vercel `/api/wake` → `/api/sync` + desk focus / Run |
| GBM μ / σ | **Dynamic** every Run from Nifty **2001-01-01 → today’s as-of** (`estimate_gbm_params`) |
| GBM matrix | Rows = path \(1…N\); cols = **trading dates** as-of→Product End; \(S_t = S_{t-1}\cdot\exp(\mathrm{drift}+\sigma Z)\) |
| Path count | User / product **N** (Monte Carlo Paths) — not f(frequency, horizon) |
| Analytics | **Path Charts** + **Path Summary** (no yearly-by-start-year — all paths share as-of) |
| Simulated Nifty preview | On-screen samples **early + late** dates so Product End is visible; Excel has the **full** grid |
| KPIs | Monte Carlo Paths first, then terminal / IRR, then above/below mean & median terminal & IRR counts (no “Paths Since YEAR”) |
| Simulated Nifty Excel | Queued streaming export with full desk chrome · logo · maroon headers · gold rule; path-by-path GBM body; Mongo restores job meta after restart; set `NEXT_PUBLIC_BACKEND_URL` for direct downloads |
| GBM formula | \(S_t = S_{t-1}\cdot\exp(\mathrm{drift}+\sigma Z)\), \(Z\sim N(0,1)\); float64 log-cumsum, float32 matrix storage |
| Home download | **Download Excel** → branded Parameters + Simulated Nifty sheets |
| Intel · Market Calendar | Shared futures shift / monthly expiry **dates** only (path Nifty & roll points on Monte Carlo Matrix / Hedging / Computation) |
| Intel · Monte Carlo Matrix | Preview table + same Excel download as Home |
| Card rails | Backtester-parity glass / meta-chip / equal header grid |
| Per-path rolls | Calendar shift dates shared; roll points = 7% × path avg spot × day fraction |
| Deploy | Render root `backend` · Vercel root `frontend` · Render: `MONGODB_*` · Vercel: `BACKEND_URL` |

**Dynamic Product Input:** Upload or change any field (tenure, observations, legs, rates, Monte Carlo Paths). The desk refreshes market meta immediately; prior Run results clear when the product fingerprint no longer matches. Header · Intel · Logic Atlas · path atlas all key off the live `ProductSpec` — Product End follows tenure via `path_end_calendar`, not a frozen 7300-day horizon.
