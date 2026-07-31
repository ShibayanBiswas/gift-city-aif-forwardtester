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
│       └── engine/            # paths, gbm, forward_calendar, hedge, nav, …
├── frontend/                  # Next.js 15 App Router
└── scripts/                   # verify_*, sync_market_data, build_product_input
```

**Note:** Forwardtester does **not** use Macro Paths CSV pins for the forward atlas. Historical roll open-month pin matches Backtester via `pin_current_month_roll_to_latest`.

**Local only (gitignored):** `Gift AIF Working File 1.xlsm`, `AIF - Notes.xlsx`, `.env` — never commit secrets.

---

## Engine Module Map (`backend/app/engine/`)

| Module | File | Inputs | Outputs |
|--------|------|--------|---------|
| Product | `product.py` | `.xlsx` upload / sample | `ProductSpec` (+ Simulation End Days) |
| Market | `market.py` | `data/*.csv` | Historical `MarketDB`, lookups, cache |
| Market sync | `market_sync.py` | Yahoo API, CSVs | Updated CSVs through present (as-of) |
| Calendar (hist) | `calendar_build.py` | Overrides, NSE eras, **`pin_current_month_roll_to_latest`** | Historical expiries / open-month roll pin |
| Forward calendar | `forward_calendar.py` | Hist market, horizon | Mon–Fri pad, month-end rolls, last-Tue expiries |
| GBM | `gbm.py` | Historical returns | μ/σ, `gbm_spots` |
| Paths | `paths.py` | Market, product, frequency | Forward `PathSpec[]` (as-of → Simulation End) |
| Hedge | `hedge.py` | Product, path, market | `req_delta`, legs, observations |
| Black–Scholes | `black_scholes.py` | Spot, strike, τ, σ, rates | Price, central delta |
| NAV | `nav.py` | Deltas, spots, rolls | Summary + daily rows |
| Forward test | `forwardtest.py` | Product, market, frequency | Job results, KPIs |
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
| GET | `/api/market/meta` | Horizon meta: asof, simulation_end, simulation_end_days, trading_days & expiries for **as-of→Simulation End** |
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
| POST | `/api/forwardtest/run` | `{ "frequency": "daily"|"monthly"|… }` → `{ job_id }` |
| GET | `/api/forwardtest/{id}/status` | Progress, phase, error |
| GET | `/api/forwardtest/{id}/summary` | All-path KPIs + rows |
| GET | `/api/forwardtest/{id}/paths/{pathId}` | Computation detail + series |
| GET | `/api/forwardtest/{id}/paths/{pathId}/hedging` | Hedging Sheet payload |

**Job lifecycle:**

1. `POST /api/forwardtest/run` — default UI frequency **daily**
2. Poll `/status` until `done` (or `cancelled` / `error`)
3. Load `/summary` then `/paths/{pathId}` for detail

Starting a new run **cancels** any prior queued/running job. `GET /api/sync` refreshes market through present (6352 sessions as of 2026-07-24 verify).

---

## Frontend Structure

| Path / module | Responsibility |
|---------------|----------------|
| `lib/store.tsx` | Product, job, path selection, progress, filtered KPIs, cancel-safe runs |
| `lib/download.ts` | Branded `.xlsx` — logo, typed number/date/percent cells |
| `components/ui/Shared.tsx` | Path picker, KpiBand (mean + median), tabs |
| `app/page.tsx` | Home — product strip, KPIs, yearly chart |
| `app/product` | Spec tables + observation map |
| `app/paths` | Trading calendar |
| `app/hedging` | Hedging Sheet |
| `app/computation` | Result, Buy/Sell, Brokerage/GST, Daily Rows, Trade Cost Ledger |
| `app/computation/ledger` | Daily Ledger charts (NAV + Req. Delta) |
| `app/analytics` | Yearly Lab + Path Summary |
| `app/intel` | Path Market + Logic Atlas |

Theme: Cormorant Garamond display + Source Sans 3 UI; AR maroon/gold tokens in `globals.css`. Full UX spec: [06-ui-ux.md](06-ui-ux.md).

---

## Persistence Choices

| Store | Contents | Git |
|-------|----------|-----|
| `data/nifty_daily.csv` etc. | Market history (auto-extended) | Tracked |
| `data/macro_path_windows.csv` | Backtester-only Macro Path pins — **not used** by Forwardtester path atlas | Optional / unused |
| Header `/api/market/meta` | As Of Today, Simulation End, horizon Trading Days & Monthly Expiries | Live |
| `data/uploads/` | Current product workbook | Ignored |
| `data/jobs/` | Slim forward-test results (~12 newest kept) | Ignored |
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
| Local (ample RAM) | Process pool for daily | ~10–15s daily; ~2–5s monthly |
| Render free / constrained | Threads or serial | Higher; avoids OOM |

Env: `BACKTEST_CONSTRAINED`, `BACKTEST_WORKERS`, `BACKTEST_MODE`.

| Frequency | Path count (approx.) |
|-----------|---------------------:|
| Monthly | 250 (235 pins + dynamic) |
| Daily | ~5119 |
| Weekly | ~1074 |

---

## Path and Product Constants (desk reference)

| Item | Value |
|------|-------|
| Default product book | −91.5@137 … +1@70 (six puts) |
| Observation months | 38, 41, 44, 47, 50, 53, 56 |
| BS Forward / Discount | 6.6% / 7.6% |
| Path 1 Total | ≈ 180.7724 Cr |
| WF1 pin count | 235 |
| Engine monthly extension | Through market last date (Path 250 @ 2026-07-24 verify) |

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

- `.env` holds `MONGODB_URI` — never commit; encode `@` in passwords as `%40`
- Product upload accepts `.xlsx`/`.xlsm` only; stored under `data/uploads/`
- No authentication layer in v1 — desk deployment assumes private URL / network
- Market sync requires outbound HTTPS to Yahoo Finance

Public repo: https://github.com/ShibayanBiswas/gift-city-aif-forwardtester
