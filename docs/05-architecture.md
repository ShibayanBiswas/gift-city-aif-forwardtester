# 05 — Architecture

Gift City AIF Forward Tester is a **Next.js 15 + FastAPI** desk application with CSV-backed market data, optional MongoDB Atlas, and a numpy engine that mirrors WF1. Production runs **Vercel (frontend) + Render (backend)**; local dev uses `./start.ps1` (Windows) or `./start.sh`.

**Repo:** https://github.com/ShibayanBiswas/gift-city-aif-forwardtester

**Engine internals:** [04-forwardtest-engine.md](04-forwardtest-engine.md) · **Deploy:** [08-deploy-vercel-render.md](08-deploy-vercel-render.md) · **UI:** [06-ui-ux.md](06-ui-ux.md).

---

## Repository Layout

```
gift-city-aif-forwardtester/   # https://github.com/ShibayanBiswas/gift-city-aif-forwardtester
├── Product_Input_File.xlsx    # Sample product (tracked)
├── README.md                  # Root quick start + deploy pointer
├── start.ps1 / start.bat / start.sh
├── .env.example               # Mongo / BACKEND_URL template (never commit .env)
├── docs/                      # Documentation set (01–09 + README)
├── data/
│   ├── nifty_daily.csv
│   ├── roll_costs.csv
│   ├── nifty_expiries.csv
│   ├── nifty_all_expiries.csv
│   ├── expiry_overrides.csv
│   ├── uploads/               # gitignored
│   └── jobs/                  # gitignored
├── backend/
│   ├── requirements.txt
│   └── app/
│       ├── main.py
│       ├── db/mongo.py
│       └── engine/            # paths, gbm, mc_matrix, forward_calendar, hedge, nav, …
├── frontend/                  # Next.js 15 App Router
└── scripts/                   # verify_*, sync_market_data, build_product_input
```

**Note:** Forwardtester does **not** use Macro Paths CSV pins for the forward atlas. Futures shifts equal monthly option expiries on load/sync and on the forward pad (same as Backtester / WF1).

**Local only (gitignored):** `Gift AIF Working File 1.xlsm`, `AIF - Notes.xlsx`, `.env` — never commit secrets.

---

## Engine Module Map (`backend/app/engine/`)

| Module | File | Inputs | Outputs |
|--------|------|--------|---------|
| Product | `product.py` | `.xlsx` upload / sample | `ProductSpec` (+ tenure, Monte Carlo Paths) |
| Market | `market.py` | `data/*.csv` | Historical `MarketDB`, lookups, cache |
| Market sync | `market_sync.py` | Yahoo API, CSVs | Updated CSVs through present (as-of) |
| Calendar (hist) | `calendar_build.py` | Overrides, NSE eras, `last_monthly_expiry_on_or_before` | Historical expiries (= futures shifts) |
| Forward calendar | `forward_calendar.py` | Hist market, horizon | Mon–Fri pad; rolls = monthly option expiries |
| GBM | `gbm.py` | Historical returns **2001→as-of** | μ/σ/drift (dynamic each Run), `gbm_spots` |
| Monte Carlo matrix | `mc_matrix.py` | GbmParams, horizon dates, n_paths | Path×date matrix, `.npz`, Excel export |
| Paths | `paths.py` | Market, product, n_paths | Forward `PathSpec[]` (as-of → Product End; frequency ignored) |
| Hedge | `hedge.py` | Product, path, market | `req_delta`, legs, observations |
| Black–Scholes | `black_scholes.py` | Spot, strike, τ, σ, rates | Price, central delta |
| NAV | `nav.py` | Deltas, spots, rolls | Summary + daily rows |
| Forward test | `forwardtest.py` | Product, market, n_paths | Job results, KPIs |
| Runtime | `runtime.py` | Host env | Parallelism mode |
| Init | `__init__.py` | — | Package exports |

WF1 sheet mapping: [02-excel-sheet-logic.md](02-excel-sheet-logic.md). Forward calendar detail: [04-forwardtest-engine.md](04-forwardtest-engine.md).

---

## Runtime Topology

```
Browser
 └─ Next.js (port 3000 / 3001)
 rewrite /api/* ──► FastAPI (port 8000)
 ├─ engine (numpy; threads or processes)
 ├─ data/*.csv
 ├─ data/jobs/*.json
 ├─ data/uploads/current_product.xlsx
 └─ MongoDB Atlas (optional)
```

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 App Router, React, TypeScript |
| Backend | FastAPI, uvicorn, numpy, scipy, openpyxl |
| Market feed | Yahoo `^NSEI` via sync script |
| Persistence | CSV (market), JSON (jobs), Mongo (optional) |

Local rewrite: `frontend/next.config.ts` → `http://127.0.0.1:8000/api/:path*`.
Production: rewrite destination = Render service URL ([08-deploy-vercel-render.md](08-deploy-vercel-render.md)).

Bootstrap: frontend calls `/api/sync` first to wake sleeping Render instance and refresh market through present.

---

## Key API Groups

### Health and market

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Liveness |
| GET | `/api/sync` | Extend Nifty / rolls / expiries; clear cache |
| GET | `/api/mongo/status` | Atlas connectivity |
| GET | `/api/market/meta` | Horizon meta: asof, product_end, tenure_days, n_paths, trading_days & expiries for **as-of→Product End** |
| GET | `/api/market/nifty` | Daily series |
| GET | `/api/market/expiries` | Monthly (+ Nifty on expiry) |
| GET | `/api/market/rolls` | Shift dates + roll costs |

### Product

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/product/current` | Parsed spec for UI |
| GET | `/api/product/sample` | Download sample workbook |
| POST | `/api/product/upload` | Replace current product |

### Forward-test jobs

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/forwardtest/run` | `{ "n_paths": 1000 }` (optional; default 1000) → `{ job_id }` |
| GET | `/api/forwardtest/{id}/status` | Progress, phase, error |
| GET | `/api/forwardtest/{id}/summary` | All-path KPIs + rows |
| GET | `/api/forwardtest/{id}/paths/{pathId}` | Computation detail + series |
| GET | `/api/forwardtest/{id}/paths/{pathId}/hedging` | Hedging Sheet payload |
| GET | `/api/forwardtest/{id}/paths/{pathId}/horizon-market` | Full as-of→Product End path market payload (API; UI calendar uses `/api/market/*`) |
| GET | `/api/forwardtest/{id}/mc-matrix` | Matrix meta (n_paths, n_dates, GBM params) |
| GET | `/api/forwardtest/{id}/mc-matrix/preview` | Truncated grid for Intel UI (early + late date sample) |
| GET | `/api/forwardtest/{id}/mc-matrix.xlsx` | Full Excel download (Home + Intel) |

**Job lifecycle:**

1. `POST /api/forwardtest/run` — default **Monte Carlo Paths = 1000**
2. Poll `/status` until `done` (or `cancelled` / `error`)
3. Load `/summary` then `/paths/{pathId}` for detail; optionally download `/mc-matrix.xlsx`

Starting a new run **cancels** any prior queued/running job. `GET /api/sync` refreshes market through present (session count moves with Yahoo sync).

---

## Environment Variables (production)

Full layman guide: [08-deploy-vercel-render.md](08-deploy-vercel-render.md). Template: `.env.example`.

| Host | Variable | Required? | Purpose |
|------|----------|-----------|---------|
| **Render** | `MONGODB_URI` | Recommended | Atlas URI (`MONGO_URI` alias OK) |
| **Render** | `MONGODB_DB` | Recommended | Default `gift_aif_forwardtester` |
| **Render** | `FORWARDTEST_WORKERS` | Optional | Cap workers (legacy: `BACKTEST_WORKERS`) |
| **Render** | `FORWARDTEST_MODE` | Optional | `serial` / `threads` / `processes` (legacy: `BACKTEST_MODE`) |
| **Render** | `FORWARDTEST_CONSTRAINED` | Optional | Force free-tier mode (legacy: `BACKTEST_CONSTRAINED`) |
| **Vercel** | `BACKEND_URL` | **Yes** | Render base URL, no trailing slash |
| **Vercel** | `NEXT_PUBLIC_BACKEND_URL` | Optional | Same URL for faster cold wakes |

Render injects `PORT`, `RENDER`, `RENDER_SERVICE_ID` — do not set manually. Never put Mongo secrets on Vercel.

## Frontend Structure

| Path / module | Responsibility |
|---------------|----------------|
| `lib/store.tsx` | Product, job, path selection, progress, filtered KPIs, cancel-safe runs |
| `lib/download.ts` | Branded `.xlsx` — logo, typed number/date/percent cells |
| `components/ui/Shared.tsx` | Path picker, KpiBand (mean + median), tabs |
| `app/page.tsx` | Home — product strip, KPIs, GBM band, **Download Simulated Nifty Paths** |
| `app/product` | Spec tables + observation map |
| `app/paths` | Trading calendar |
| `app/hedging` | Hedging Sheet |
| `app/computation` | Result, Buy/Sell, Brokerage/GST, Daily Rows, Trade Cost Ledger |
| `app/computation/ledger` | Daily Ledger charts (NAV + Req. Delta) |
| `app/analytics` | Path Charts + Path Summary |
| `app/intel` | Market Calendar + Monte Carlo Matrix + Logic Atlas |

Theme: Cormorant Garamond display + Source Sans 3 UI; AR maroon/gold tokens in `globals.css`. Full UX spec: [06-ui-ux.md](06-ui-ux.md).

---

## Persistence Choices

| Store | Contents | Git |
|-------|----------|-----|
| `data/nifty_daily.csv` etc. | Market history (auto-extended) | Tracked |
| `data/nifty_daily.csv` | Historical Nifty closes for GBM μ/σ |
| Header `/api/market/meta` | As Of Today, Product End, Tenure Days, Monte Carlo Paths, Trading Days & Monthly Expiries | Live |
| `data/uploads/` | Current product workbook | Ignored |
| `data/jobs/` | Slim forward-test results + `mc_matrix.npz` (~12 newest kept) | Ignored |
| Mongo (optional) | Product upsert, upload log, job KPI snapshot | Cloud |

Jobs reload from disk on API restart; unknown job IDs return clear errors to UI.

---

## Timeouts (Frontend Client)

| Call | Timeout |
|------|--------:|
| Health / Sync / Market meta | 60s |
| Job status poll | 20s |
| Summary | 90s |
| Path detail / hedging / computation | 180s |
| Full Nifty / rolls / expiries | 120s |
| Upload / sample | 60–90s |

Status polling interval: **~180–280ms** (faster while warming).

---

## Performance Notes

| Host | Mode | Typical latency |
|------|------|-----------------|
| Local (ample RAM) | Process / thread pool | Scales with Monte Carlo Paths N and tenure trading days |
| Render free / constrained | Threads or serial | Higher; avoids OOM |

Env: prefer `FORWARDTEST_CONSTRAINED`, `FORWARDTEST_WORKERS`, `FORWARDTEST_MODE` (legacy `BACKTEST_*` still accepted). Optional `FORWARDTEST_N_PATHS` overrides default path count.

| Monte Carlo Paths | Notes |
|-------------------|-------|
| Default **1000** | Presets 100 / 500 / 1000 / 5000 / 10000; clamp 1…10000 |
| Larger N | Longer Run + Excel queue; prefer 100–1000 for quick desk checks on free hosts |

Do **not** hardcode “235 Macro Paths” or frequency-driven path counts in ops docs — the Forwardtester atlas is **N independent seeds** over one as-of → Product End window.

---

## Path and Product Constants (desk reference)

| Item | Value |
|------|-------|
| Default product book | −91.5@137 … +1@70 (six puts) |
| Observation months | 38, 41, 44, 47, 50, 53, 56 |
| BS Forward / Discount | 6.6% / 7.6% |
| Path 1 Total | ≈ 180.7724 Cr (WF1 / Backtester historical gold — hedge/NAV parity) |
| Forward path count | **Monte Carlo Paths N** (default 1000) — no fixed 235 Macro Path pin file; no frequency start grid |
| Futures / expiry calendars | `roll_shifts = list(expiries)` on load + sync; forward pad same rule |

---

## Verification

| Artifact | Purpose |
|----------|---------|
| [07-verification.md](07-verification.md) | Smoke tests and Path 1 / Path 10 anchors |
| `scripts/verify_monthly_excel.py` | Monthly pin smoke vs WF1 Summary |
| `scripts/verify_dynamic_products.py` | Dynamic obs/tenure books |
| `scripts/sync_market_data.py` | Extend market CSVs through present |

---

## Security and Ops Notes

- `.env` holds `MONGODB_URI` / `BACKEND_URL` — never commit; encode `@` in passwords as `%40`
- Product upload accepts `.xlsx`/`.xlsm` only; stored under `data/uploads/`
- No authentication layer in v1 — desk deployment assumes private URL / network
- Market sync requires outbound HTTPS to Yahoo Finance
- Production: Render (API) + Vercel (UI) — see [08-deploy-vercel-render.md](08-deploy-vercel-render.md)

Public repo: https://github.com/ShibayanBiswas/gift-city-aif-forwardtester
