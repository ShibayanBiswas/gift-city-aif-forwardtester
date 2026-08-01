# 08 — Complete Deployment Guide (Vercel + Render)

End-to-end production deploy for **Gift City AIF Forwardtester**.

| Piece | Host | Root directory |
|-------|------|----------------|
| Backend API (FastAPI) | [Render](https://render.com) Web Service | `backend` |
| Frontend (Next.js) | [Vercel](https://vercel.com) | `frontend` |
| Optional DB | [MongoDB Atlas](https://www.mongodb.com/atlas) | — |

**Source repo:** https://github.com/ShibayanBiswas/gift-city-aif-forwardtester

After deploy, smoke-test with [07-verification.md](07-verification.md).

---

## Master Environment Variable List

### Render (backend) — set these on the Web Service

| Variable | Required? | Example / value | Purpose |
|----------|-----------|-----------------|---------|
| `MONGODB_URI` | Recommended | `mongodb+srv://USER:PASSWORD@cluster0.XXXX.mongodb.net/gift_aif_forwardtester?retryWrites=true&w=majority` | Atlas connection. Encode `@` in passwords as `%40`. |
| `MONGODB_DB` | Recommended | `gift_aif_forwardtester` | Database name (default if omitted: `gift_aif_forwardtester`). |
| `MONGO_URI` | Optional alias | Same as `MONGODB_URI` | Code accepts either; prefer one name only. |
| `FORWARDTEST_CONSTRAINED` | Optional | `1` or `0` | Force free-tier mode (`1`) or full local-style pools (`0`). On Render, constrained mode is **auto-detected** via `RENDER` / `RENDER_SERVICE_ID`. Legacy: `BACKTEST_CONSTRAINED`. |
| `FORWARDTEST_WORKERS` | Optional | `2` | Cap parallel workers (e.g. free tier). Legacy: `BACKTEST_WORKERS`. |
| `FORWARDTEST_MODE` | Optional | `serial` \| `threads` \| `processes` | Override auto parallelism. Legacy: `BACKTEST_MODE`. |

**Injected by Render (do not set manually):**

| Variable | Notes |
|----------|--------|
| `PORT` | Bound by start command: `uvicorn … --port $PORT` |
| `RENDER` / `RENDER_SERVICE_ID` | Marks constrained host → prefer serial/threads, no process pool |

**Do not set on Render:** `BACKEND_URL`, `NEXT_PUBLIC_BACKEND_URL`, `API_PORT`, `UI_PORT`.

### Vercel (frontend) — set these on the Project

| Variable | Required? | Example / value | Purpose |
|----------|-----------|-----------------|---------|
| `BACKEND_URL` | **Yes (Production)** | `https://YOUR-SERVICE.onrender.com` | No trailing slash. Used by `next.config.ts` to rewrite `/api/*` → Render, and by `/api/wake` cron. |
| `NEXT_PUBLIC_BACKEND_URL` | Optional | Same as `BACKEND_URL` | Browser can ping Render directly for faster cold starts (CORS is open on the API). |

**Do not set on Vercel:** `MONGODB_URI`, `MONGODB_DB`, `MONGO_URI`, `FORWARDTEST_*`, `BACKTEST_*`.

Apply `BACKEND_URL` to **Production** (and **Preview** if preview deploys should hit the same API). After changing env vars, **Redeploy**.

### Local (repo-root `.env` — copy from `.env.example`)

| Variable | Typical local value | Purpose |
|----------|---------------------|---------|
| `MONGODB_URI` | Atlas URI or omit | Optional persistence |
| `MONGODB_DB` | `gift_aif_forwardtester` | DB name |
| `BACKEND_URL` | `http://127.0.0.1:8000` | Next rewrite target for `npm run dev` |
| `NEXT_PUBLIC_BACKEND_URL` | omit or same as above | Optional |
| `API_PORT` | `8000` | `start.ps1` / `start.sh` |
| `UI_PORT` | `3000` | `start.ps1` / `start.sh` (falls back to 3001 if busy) |
| `FORWARDTEST_*` | omit | Optional local parallelism tuning |

**Never commit** real `.env` secrets. Never put Mongo credentials on Vercel.

### Copy-paste blocks

**Render**

```bash
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.XXXX.mongodb.net/gift_aif_forwardtester?retryWrites=true&w=majority
MONGODB_DB=gift_aif_forwardtester
# Optional:
# FORWARDTEST_WORKERS=2
# FORWARDTEST_MODE=threads
# FORWARDTEST_CONSTRAINED=1
```

**Vercel**

```bash
BACKEND_URL=https://YOUR-SERVICE.onrender.com
# Optional:
# NEXT_PUBLIC_BACKEND_URL=https://YOUR-SERVICE.onrender.com
```

**Local `.env`**

```bash
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.XXXX.mongodb.net/gift_aif_forwardtester?retryWrites=true&w=majority
MONGODB_DB=gift_aif_forwardtester
BACKEND_URL=http://127.0.0.1:8000
# API_PORT=8000
# UI_PORT=3000
```

---

## Before You Start

| Account | Why | Link |
|---------|-----|------|
| GitHub | Code source for Render / Vercel | https://github.com |
| Render | Runs FastAPI 24/7 | https://render.com |
| Vercel | Hosts Next.js UI | https://vercel.com |
| MongoDB Atlas (optional) | Product / job meta persistence | https://www.mongodb.com/atlas |

Confirm on `main`:

- `backend/app/main.py`, `backend/requirements.txt`
- `frontend/package.json`, `frontend/next.config.ts`, `frontend/vercel.json`
- `data/*.csv` market seeds, `Product_Input_File.xlsx`
- `.env.example` (template only)

---

## Part 1 — Deploy Backend On Render

### 1.1 Create Web Service

1. Sign in to Render with GitHub.
2. **New +** → **Web Service**.
3. Connect `gift-city-aif-forwardtester` (or your fork).
4. Settings:

| Setting | Value |
|---------|--------|
| Name | e.g. `gift-aif-api` |
| Region | Closest to you |
| Branch | `main` |
| **Root Directory** | `backend` |
| Runtime | Python 3 |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Instance | Free (OK for demos; sleeps when idle) |

5. **Create Web Service** and wait for the first build.

### 1.2 Set Render Environment Variables

Service → **Environment** → add the Render table from the master list above → **Save** → redeploy if prompted.

Password tip: encode `@` in the password as `%40` inside the URI. Example pattern: `P@ss` → `P%40ss`.

### 1.3 Verify API

When **Live**:

| URL | Expect |
|-----|--------|
| `https://YOUR-SERVICE.onrender.com/api/health` | `"ok": true` |
| `https://YOUR-SERVICE.onrender.com/api/ping` | Fast wake ping |
| `https://YOUR-SERVICE.onrender.com/api/sync` | Market + horizon meta |
| `https://YOUR-SERVICE.onrender.com/docs` | Swagger UI |

Copy the base URL (no path, no trailing slash) for Vercel `BACKEND_URL`.

**Cold start:** Free Render can take 30–90s after idle sleep — normal.

---

## Part 2 — Deploy Frontend On Vercel

### 2.1 How The Proxy Works

`frontend/next.config.ts` rewrites:

```text
Browser → https://your-app.vercel.app/api/*  →  https://your-service.onrender.com/api/*
```

`frontend/vercel.json` also schedules a daily wake cron:

```text
GET /api/wake   (cron: 0 3 * * *)  →  hits Render /api/ping using BACKEND_URL
```

### 2.2 Import Project

1. Sign in to Vercel with GitHub.
2. **Add New…** → **Project** → import the repo.
3. Configure:

| Setting | Value |
|---------|--------|
| Framework | Next.js |
| **Root Directory** | `frontend` |
| Build Command | `npm run build` (default) |
| Install Command | `npm install` (default) |
| Node | 18+ |

### 2.3 Set Vercel Environment Variables

**Settings → Environment Variables** (Production ± Preview):

| Key | Value |
|-----|--------|
| `BACKEND_URL` | `https://YOUR-SERVICE.onrender.com` |

Optional: `NEXT_PUBLIC_BACKEND_URL` = same URL.

### 2.4 Deploy

1. **Deploy**.
2. Open the production URL.
3. Confirm `https://YOUR-APP.vercel.app/api/health` returns 200 (proxy works).

### 2.5 First Desk Run In Production

1. Optional: open the site once, wait ~1 minute (wake Render), or hit `/api/wake`.
2. **Sample Input** → download product Excel.
3. Set path frequency (e.g. **Daily** or **Monthly**). Path count = f(frequency, Simulation End Days, tenure) — not a fixed 235 Macro Paths list.
4. **Run**.
5. Check **Home** GBM band, **Desk → Hedging / Computation**, **Intel → Path Market** (per-path simulated Nifty / expiries / rolls), **Intel → MC Matrix** (full path×date grid + Excel download).

---

## Part 3 — MongoDB Atlas (Optional)

1. Create free **M0** cluster.
2. **Database Access** → user + password.
3. **Network Access** → `0.0.0.0/0` (simplest for Render).
4. **Connect → Drivers** → copy URI → replace `<password>` (URL-encode special chars).
5. Set on Render: `MONGODB_URI`, `MONGODB_DB=gift_aif_forwardtester`.
6. Restart / redeploy Render.
7. Check `GET /api/mongo/status` or `/api/health`.

**Mongo stores (when configured):** uploaded products, job metadata / summaries, upload audit. Full daily ledgers stay on-demand from the engine, not as durable Atlas blobs.

Without Mongo the API still runs; jobs are in-memory / ephemeral disk until the free instance recycles.

---

## Part 4 — Local Development

```powershell
cd "Gift AIF Forwardtester"
.\start.ps1
```

```bash
./start.sh
```

| Service | URL |
|---------|-----|
| UI | http://127.0.0.1:3000 (or 3001) |
| API docs | http://127.0.0.1:8000/docs |
| Health | http://127.0.0.1:8000/api/health |

Launcher: creates `.venv`, installs deps, starts uvicorn + `npm run dev`, sources `.env` if present.

---

## Part 5 — Market Sync In Production

Auto-extends through latest Nifty session on:

- API startup
- `GET /api/sync`
- Optional script: `PYTHONPATH=backend python scripts/sync_market_data.py`

```bash
curl -s https://YOUR-SERVICE.onrender.com/api/sync
```

Expect `market.first_date` ≈ `2001-01-01`, `market.last_date` = latest session, plus horizon fields for Simulation End.

Free Render disk is ephemeral; git `data/*.csv` are the seed; startup re-extends.

Header chips: As Of Today · Simulation End · Simulation End Days · Trading Days · Monthly Expiries.  
Intel · Path Market is **per path** after a Run (no shared forward price workbook).

---

## Part 6 — Post-Deploy Checklist

### Infrastructure

- [ ] Render `/api/health` → ok
- [ ] Render `/api/sync` → current as-of
- [ ] Vercel site loads (Anand Rathi header)
- [ ] Vercel `/api/health` → 200 (confirms `BACKEND_URL`)
- [ ] Vercel `/api/wake` → ok (optional cold-start check)

### Functional

- [ ] Sample Input downloads
- [ ] Run completes for chosen frequency
- [ ] Home shows GBM S₀ / μ / σ / drift after Run
- [ ] Hedging Sheet + Computation populate for a path
- [ ] Intel → Path Market: Simulated Nifty / Monthly Expiries / Rolls for selected path
- [ ] Intel → MC Matrix: preview table + Download Excel (`/api/forwardtest/{job}/mc-matrix.xlsx`)
- [ ] Header chips show live Simulation End Days (default 3650)

### Resilience

- [ ] After ~15 min idle, second Run succeeds within ~90s
- [ ] Mongo OK if configured
- [ ] Push to `main` redeploys both hosts green

---

## Part 7 — Troubleshooting

| Symptom | Cause | Fix |
|---------|--------|-----|
| UI loads, Run / API fails | Missing/wrong `BACKEND_URL` | Set Render URL, no trailing slash; redeploy Vercel |
| First request 30–90s | Free Render cold start | Wait; use `/api/wake` or `NEXT_PUBLIC_BACKEND_URL` |
| 502/504 on Run | API still waking / crash | Render logs; hit `/api/health` directly |
| `Unknown job` | Instance recycled | Run again; enable Mongo for meta persistence |
| Render `ModuleNotFoundError` | Root Directory ≠ `backend` | Set Root = `backend` |
| Vercel can't find pages | Root Directory ≠ `frontend` | Set Root = `frontend` |
| Mongo auth failed | Bad password / `@` not encoded | Use `%40`; check Atlas network |
| Daily run slow on free tier | Many paths + small CPU | Retry; `FORWARDTEST_MODE=threads`, `FORWARDTEST_WORKERS=2` |
| CORS in browser | Calling Render from browser incorrectly | Prefer same-origin `/api/*` via Vercel proxy |

### Debug sequence

1. `curl https://YOUR-RENDER.onrender.com/api/health`
2. `curl https://YOUR-RENDER.onrender.com/api/sync`
3. `curl https://YOUR-VERCEL-APP.vercel.app/api/health`
4. `curl https://YOUR-VERCEL-APP.vercel.app/api/wake`
5. Render Logs during Run · Vercel Build logs if UI fail

---

## Part 8 — Architecture

```text
User browser
    │
    ▼
Vercel (Next.js)  ── /api/* rewrite ──►  Render (FastAPI + GBM engine + CSVs)
    │                                         │
    └── cron /api/wake ───────────────────────┘
                                              │
                                    optional MongoDB Atlas
```

| Data | Where |
|------|--------|
| Market CSVs | Git + runtime extend on Render |
| Sample product | `Product_Input_File.xlsx` in git |
| Uploaded products | Mongo (optional) + ephemeral upload |
| Forward-test results | In-memory + optional Mongo summary; path ledgers on demand |
| WF1 / Notes Excel | Local only (gitignored) — not needed in production |

---

## Part 9 — Updating After Code Changes

1. Push to `main`.
2. Render auto-deploys backend; Vercel auto-deploys frontend.
3. Wait for Render before trusting new engine / CSV behaviour.
4. Smoke: Sample → Run → Computation + Path Market.

| Changed | Re-verify |
|---------|-----------|
| `gbm.py` / `paths.py` | Path Market Nifty differs by path; final path ends on Simulation End |
| `nav.py` / `hedge.py` | Path totals / hedge rows |
| `product.py` | Simulation End Days + six-leg book |
| `next.config.ts` / env | Proxy `/api/health` |
| `data/*.csv` | `/api/sync` dates |

---

## Related Docs

| Doc | Purpose |
|-----|---------|
| [07-verification.md](07-verification.md) | Smoke + parity |
| [05-architecture.md](05-architecture.md) | API surface |
| [04-forwardtest-engine.md](04-forwardtest-engine.md) | GBM + path atlas |
| [docs/README.md](README.md) | Index |
