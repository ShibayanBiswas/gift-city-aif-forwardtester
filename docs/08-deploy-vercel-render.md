# 08 — Complete Deployment Guide (Render + Vercel)

Step-by-step production deploy for someone who has never shipped this app before.

**You will create:**

1. A **backend API** on [Render](https://render.com) (Python / FastAPI)
2. A **website** on [Vercel](https://vercel.com) (Next.js)
3. Optionally a **MongoDB Atlas** database for product / job history

**Source code:** https://github.com/ShibayanBiswas/gift-city-aif-forwardtester

After deploy, run verification from [07-verification.md](07-verification.md) against production URLs.

---

## Before You Start — Accounts Checklist

| Account | Why | Link |
|---------|-----|------|
| GitHub | Hosts the code Render / Vercel pull from | https://github.com |
| Render | Runs the Python API 24/7 (free tier OK) | https://render.com |
| Vercel | Hosts the website | https://vercel.com |
| MongoDB Atlas (optional) | Saves products / job summaries | https://www.mongodb.com/atlas |

Also decide a service name, e.g. `gift-aif-api`.

---

## Part 1 — Confirm The Repo Is Ready

1. Open https://github.com/ShibayanBiswas/gift-city-aif-forwardtester (or your fork).
2. Confirm these exist on `main`
 - `backend/` with `app/main.py` and `requirements.txt`
 - `frontend/` with `package.json` and `next.config.ts`
 - `data/` market CSVs (`nifty_daily.csv`, `nifty_expiries.csv`, `roll_costs.csv`, …)
 - `Product_Input_File.xlsx`
 - `.env.example` (template for env keys — never commit real secrets)
 - `start.sh` (local one-command dev)
3. If you forked, use **your** repo URL in the steps below.

---

## Part 2 — Deploy The Backend On Render

### 2.1 Create The Web Service

1. Sign in to Render with GitHub.
2. Click **New +** → **Web Service**.
3. Choose **Build and deploy from a Git repository** → connect the `gift-city-aif-forwardtester` repo.
4. Fill the form carefully

| Setting | Exact Value | Why |
|---------|-------------|-----|
| Name | `gift-aif-api` (any unique name) | Your public hostname base |
| Region | Closest region (e.g. Singapore / Frankfurt / Oregon) | Latency |
| Branch | `main` | |
| **Root Directory** | `backend` | Critical — without this, build fails |
| Runtime | Python 3 | |
| Build Command | `pip install -r requirements.txt` | Installs FastAPI, numpy, openpyxl, … |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` | Render injects `$PORT` |
| Instance type | Free | Fine for demos; sleeps when idle |

5. Click **Create Web Service**.
6. Watch the build logs. First build takes a few minutes.

### 2.2 Environment Variables On Render (Complete List)

Render → your service → **Environment** → add every row you use.

| Key | Required? | Exact Value To Use |
|-----|-----------|--------------------|
| `MONGODB_URI` | Recommended | Your Atlas URI, e.g. `mongodb+srv://USER:PASSWORD@cluster0.XXXX.mongodb.net/gift_aif_forwardtester?retryWrites=true&w=majority` |
| `MONGODB_DB` | Recommended | `gift_aif_forwardtester` |
| `FORWARDTEST_CONSTRAINED` | Optional | `1` forces free-tier mode (no process pool). Render sets `RENDER` automatically so this is usually unnecessary. Legacy alias: `BACKTEST_CONSTRAINED`. |
| `FORWARDTEST_WORKERS` | Optional | Cap workers, e.g. `2` on free instances. Legacy alias: `BACKTEST_WORKERS`. |
| `FORWARDTEST_MODE` | Optional | `serial` \| `threads` \| `processes` — override auto detection. Legacy alias: `BACKTEST_MODE`. |

**Optional alias (do not set both unless identical):** `MONGO_URI` — same string as `MONGODB_URI`. The code accepts either name.

**Password rule:** if the Mongo password contains `@`, encode it as `%40` inside the URI.
Example: password `Sb@04052003` → `Sb%4004052003` in the URI.

**Not required on Render:**

| Key | Why Not |
|-----|---------|
| `BACKEND_URL` | Frontend-only (Vercel) |
| `PORT` | Render injects `$PORT` automatically |
| `PYTHONPATH` | Root Directory `backend` + start command are enough |

You can omit Mongo entirely; the API still runs. Jobs then live only in memory / `data/jobs/` on disk (ephemeral on free tier).

### 2.3 Verify The API

When status is **Live**

1. Open `https://YOUR-SERVICE.onrender.com/api/health`
 Expect JSON with `"ok": true`.
2. Open `https://YOUR-SERVICE.onrender.com/api/sync`
 Expect market + mongo readiness (desk wake-up ping).
3. Open `https://YOUR-SERVICE.onrender.com/docs`
 Expect Swagger UI.
4. Copy the base URL, e.g. `https://gift-aif-api.onrender.com` — you need it for Vercel.

**Idle sleep:** Free Render spins down after inactivity. The first request after sleep can take 30–90 seconds. That is normal.

---

## Part 3 — Point The Frontend At Render (Via Vercel Env)

`frontend/next.config.ts` reads **`BACKEND_URL`**

- Local default if unset: `http://127.0.0.1:8000`
- Production: set `BACKEND_URL` on Vercel to your Render base URL (no `/api`, no trailing slash)

You do **not** need to hard-code the Render URL in git for production if Vercel env is set.

The Next.js rewrite proxies browser requests

```
Browser → https://your-app.vercel.app/api/* → https://your-render.onrender.com/api/*
```

---

## Part 4 — Deploy The Frontend On Vercel

### 4.1 Import Project

1. Sign in to Vercel with GitHub.
2. **Add New…** → **Project**.
3. Import `gift-city-aif-forwardtester`.

### 4.2 Configure Build

| Setting | Value |
|---------|--------|
| Framework Preset | Next.js |
| **Root Directory** | `frontend` (click Edit → select `frontend`) |
| Build Command | `npm run build` (default) |
| Output Directory | default |
| Install Command | `npm install` (default) |
| Node version | 18+ (Vercel default is fine) |

### 4.3 Environment Variables On Vercel (Complete List)

Vercel → Project → **Settings** → **Environment Variables** → add for **Production** (and Preview if you want)

| Key | Required? | Exact Value To Use |
|-----|-----------|--------------------|
| `BACKEND_URL` | **Yes for production** | `https://YOUR-SERVICE.onrender.com` — replace with your real Render URL, **no trailing slash**. Used by `next.config.ts` to rewrite `/api/*` → Render. |
| `NEXT_PUBLIC_BACKEND_URL` | Optional | Same Render base URL (no trailing slash). Browser can wake/call Render directly for faster cold starts; CORS is open on the API. |

**Do not set on Vercel:** `MONGODB_URI`, `MONGODB_DB` (those belong only on Render).

Example

```
BACKEND_URL=https://gift-aif-api.onrender.com
# Optional:
# NEXT_PUBLIC_BACKEND_URL=https://gift-aif-api.onrender.com
```

### 4.4 Deploy

1. Click **Deploy**.
2. Wait for the build to succeed.
3. Open the production URL, e.g. `https://gift-city-aif-forwardtester.vercel.app`.

### 4.5 First Desk Run On Production

1. Click **Sample Input** (downloads Excel).
2. Set **Since Calendar Year** if desired (default 2001).
3. Choose **Monthly** Path Frequency (235 paths — Macro Paths bible).
4. Click **Run**.
5. If the first attempt times out, wait ~1 minute (Render wake-up) and Run again.
6. Open **Desk → Hedging Sheet** and **Desk → Computation**.
7. Optional stress: switch Path Frequency to **Daily** (~5,119 paths; ~1–2 minutes on Render free).

---

## Part 5 — MongoDB Atlas (Optional, Detailed)

1. Create a free **M0** cluster.
2. **Database Access** → Add user → password auth → save password.
3. **Network Access** → Add IP Address → `0.0.0.0/0` (allow from anywhere) for simplest Render access.
4. **Database** → Connect → Drivers → copy the URI.
5. Replace `<password>` with the real password (URL-encoded).
6. Paste into Render `MONGODB_URI`, set `MONGODB_DB=gift_aif_forwardtester`.
7. **Manual Deploy** → Clear build cache & deploy (or restart) the Render service.
8. Hit `/api/mongo/status` or `/api/health` and confirm mongo `ok`.

**What Mongo stores (when configured):**

- Uploaded product specs
- Job metadata / summaries (not full daily ledgers)
- Upload audit log

Without Mongo, forward tests still run; results are in-memory until the Render instance recycles.

---

## Part 6 — Environment Variable Cheat Sheet

### Render (backend)

```
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.XXXX.mongodb.net/gift_aif_forwardtester?retryWrites=true&w=majority
MONGODB_DB=gift_aif_forwardtester
# Optional tuning
# FORWARDTEST_WORKERS=2
# FORWARDTEST_MODE=threads
# FORWARDTEST_CONSTRAINED=1
```

### Vercel (frontend)

```
BACKEND_URL=https://YOUR-SERVICE.onrender.com
# Optional — faster Render cold starts from the browser:
# NEXT_PUBLIC_BACKEND_URL=https://YOUR-SERVICE.onrender.com
```

### Local (optional `.env` at repo root — copy from `.env.example`)

```
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.XXXX.mongodb.net/gift_aif_forwardtester?retryWrites=true&w=majority
MONGODB_DB=gift_aif_forwardtester
BACKEND_URL=http://127.0.0.1:8000
# Optional local port overrides (start.sh reads these)
# API_PORT=8000
# UI_PORT=3000
```

Never commit real passwords. Never put `MONGODB_*` on Vercel.

---

## Part 7 — Local Development (`start.sh`)

One command starts API + UI

```bash
# Free typical ports first (optional)
fuser -k 3000/tcp 3001/tcp 8000/tcp 2>/dev/null || true

cd "Gift AIF Forwardtester" # repo root
./start.sh
```

### What `start.sh` does

| Step | Action |
|------|--------|
| 1 | Sets `PYTHONPATH=backend` |
| 2 | Sources `.env` if present |
| 3 | Picks UI port **3000**, falls back to **3001** if busy |
| 4 | Kills stale process on API port **8000** if needed |
| 5 | Creates `.venv` + `pip install -r backend/requirements.txt` if missing |
| 6 | Starts `uvicorn app.main:app` on `127.0.0.1:8000` |
| 7 | Runs `npm install` in `frontend/` if needed |
| 8 | Starts `npm run dev` on chosen UI port |
| 9 | Traps Ctrl+C to kill both processes |

| Service | URL |
|---------|-----|
| UI | http://127.0.0.1:3000 or http://127.0.0.1:3001 |
| API | http://127.0.0.1:8000/docs |
| Health | http://127.0.0.1:8000/api/health |
| Sync | http://127.0.0.1:8000/api/sync |

Stop: Ctrl+C in the terminal that owns `start.sh`, or `fuser -k` on those ports again.

### Manual split (if debugging one side)

```bash
# Terminal 1 — API
cd backend && PYTHONPATH=.../.venv/bin/python -m uvicorn app.main:app --reload --port 8000

# Terminal 2 — UI
cd frontend && npm run dev
```

---

## Part 8 — Market Data Sync (Production + Local)

Market calendars **auto-extend through the latest Nifty session** on

- API startup (`load_market` + extend hooks)
- Every `GET /api/sync`
- Manual: `PYTHONPATH=backend .venv/bin/python scripts/sync_market_data.py`

### Verify sync

```bash
curl -s https://YOUR-SERVICE.onrender.com/api/sync | python3 -m json.tool
```

Expect fields like

| Field | Typical value (as of last verify) |
|-------|-----------------------------------|
| `market.first_date` | 2001-01-01 |
| `market.last_date` | 2026-07-24 (moves with Nifty) |
| `market.trading_days` | 6352+ |
| `market.roll_shifts` | 306+ |

### When sync matters

- After Nifty holidays / new month — last expiry and roll shift advance
- After pulling CSV changes from `main`
- Before trusting Path 250+ extension totals in production

Intel → **Market DB** in the UI should match `/api/sync` meta. Futures rolls last row = latest monthly shift.

### Render ephemeral disk note

Free tier disk is **not durable**. Committed `data/*.csv` in git are the baseline; runtime extensions write back when sync runs. On cold deploy, startup re-extends from git seeds + latest fetch logic.

---

## Part 9 — Post-Deploy Checklist

### Infrastructure

- [ ] `GET /api/health` → `ok: true`
- [ ] `GET /api/sync` → `ok` with current `market.last_date`
- [ ] Vercel site loads with Anand Rathi header
- [ ] Vercel `/api/health` proxy returns 200 (confirms `BACKEND_URL`)

### Functional

- [ ] Sample Input downloads `Product_Input_File.xlsx`
- [ ] Monthly Run completes (**235** paths minimum)
- [ ] Daily Run completes (~**5,119** paths) without API errors
- [ ] Path 1 Total ≈ **180.77** Cr (Computation rail)
- [ ] Hedging Sheet shows Sold Put Option / Bought Put Option (6 legs)
- [ ] Computation Result horizontal rail: Invt / MTM / Total / IRR
- [ ] Daily Ledger charts render for a selected path
- [ ] Intel → Monthly Expiries shows Nifty On Expiry through latest month
- [ ] Path picker shows Start Date, End Date, Trading Days, Calendar Days

### Resilience

- [ ] After Render sleep (~15 min idle), second Run succeeds within ~90s
- [ ] Mongo status OK if Atlas configured (`/api/mongo/status`)
- [ ] Re-run after `main` push: both Render and Vercel deploy green

### Parity (optional but recommended)

- [ ] Compare Path 1 components to [07-verification.md](07-verification.md) gold table
- [ ] Regenerate claims locally if engine changed

---

## Part 10 — Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Vercel page loads, Run fails / network error | `BACKEND_URL` missing or wrong | Vercel → Settings → Env → set exact Render URL, **no trailing slash**, redeploy |
| First Run hangs 30–90s then succeeds | Render free tier cold start | Normal — wait and Run again |
| First Run hangs then **502/504** | Render still waking or build failed | Check Render logs; hit `/api/health` directly |
| `Unknown job` / expired result | API recycled; in-memory job gone | Run again (use Mongo for persistence hints) |
| Render build: `ModuleNotFoundError` | Root Directory not `backend` | Set Root Directory = `backend` |
| Render build: wrong Python deps | Stale requirements | Clear build cache & redeploy |
| Vercel build: can't find pages | Root Directory not `frontend` | Set Root Directory = `frontend` |
| Vercel build: TypeScript errors | Node version / lockfile drift | Match local Node 18+; `npm ci` locally first |
| Mongo auth failed | Bad password / unencoded `@` | Use `%40` in URI; verify Atlas user + network `0.0.0.0/0` |
| `/api/sync` 404 | Old API build | Redeploy Render with latest `main` |
| Path totals look stale vs desk Excel | Market not extended | Hit `/api/sync`; check Intel last Nifty date |
| Daily run timeout on free tier | Too many paths + cold CPU | Retry; or set `BACKTEST_CONSTRAINED=1` / lower workers |
| CORS errors in browser console | Direct Render URL from browser | Use Vercel proxy only — UI should call `/api/*` on same origin |
| Computation empty after Run | Job still running or failed | Check network tab for job status; Render logs for traceback |
| Wrong Path 1 total (~7% book) | Legacy product uploaded | Re-download Sample Input; verify six legs @ 6.6%/7.6% |

### Debug sequence (production)

1. `curl https://YOUR-RENDER.onrender.com/api/health`
2. `curl https://YOUR-RENDER.onrender.com/api/sync`
3. `curl https://YOUR-VERCEL-APP.vercel.app/api/health` (proxy test)
4. Render dashboard → Logs during a Run
5. Vercel → Deployments → Build logs if frontend issue

---

## Part 11 — Mental Model

```
User browser
 │
 ▼
Vercel (Next.js UI) ──/api/* rewrite──► Render (FastAPI + engine + CSVs)
 │
 └── optional MongoDB Atlas
```

The browser almost never talks to Render directly; it talks to Vercel, and Vercel proxies `/api` to Render.

**State:**

| Data | Where |
|------|-------|
| Market CSVs | Git + runtime extend on Render disk |
| Product Input sample | Git (`Product_Input_File.xlsx`) |
| Uploaded products | Mongo (optional) + ephemeral upload dir |
| Forward-test job results | In-memory + optional Mongo summary; full ledger on demand |
| WF1 bible xlsm | Local only (gitignored) — not required in production |

---

## Part 12 — Updating After Code Changes

1. Push to `main` on GitHub.
2. Render auto-deploys the backend (if auto-deploy is on).
3. Vercel auto-deploys the frontend.
4. If only `next.config.ts` changed, Vercel redeploy is enough.
5. If market CSVs or engine changed, wait for Render finish before trusting Run results.
6. Run production smoke from [07-verification.md](07-verification.md) § Manual Desk Checks.

**Breaking change checklist:**

| Area changed | Re-verify |
|--------------|-----------|
| `nav.py` / `hedge.py` | Path 1 + Path 10 totals |
| `paths.py` / calendars | Monthly pin count, Path 236+ |
| `product.py` | Six-leg book |
| `frontend` API routes | Proxy + Run flow |
| `data/*.csv` seeds | `/api/sync` dates, first roll cost |

---

## Part 13 — After First Deploy

After each `main` push

1. Confirm Render deploy finished (health + `/api/sync` 200).
2. Confirm Vercel deploy finished (site loads; `/api/health` via proxy 200).
3. Smoke: Sample/current product → **Monthly** Run → Computation + Daily Ledger charts.
4. Intel → Futures rolls last row should match latest Nifty month (dynamic sync).

Local bible files (`Gift AIF Working File 1.xlsm`, `AIF - Notes.xlsx`) stay gitignored; production uses `Product_Input_File.xlsx` + synced `data/*.csv`.

---

## Related Docs

| Doc | Purpose |
|-----|---------|
| [07-verification.md](07-verification.md) | Smoke tests, parity anchors |
| [05-architecture.md](05-architecture.md) | API surface, job model |
| [docs/README.md](README.md) | Full documentation index |
