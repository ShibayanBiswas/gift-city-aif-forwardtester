# Gift City AIF Forwardtester

Monte Carlo **forward tester** for Anand Rathi Wealth GIFT City Category III AIF structured units.

Same hedging sheet, computation NAV, roll cost, delta, and product desk as the [Gift AIF Backtester](https://github.com/ShibayanBiswas) — path generation uses **Geometric Brownian Motion** from today’s Nifty instead of historical rolling windows.

**Repo:** https://github.com/ShibayanBiswas/gift-city-aif-forwardtester

## How it works

1. Load Nifty closes from **2001-01-01 → latest session** (Yahoo sync keeps this current).
2. Compute daily returns → **μ** (mean), **σ** (stdev), **drift = μ − ½σ²**.
3. Resolve **Simulation End** = as-of + **Simulation End Days** (default **3650**, must exceed product tenure). That date is the **final path’s end**.
4. Build staggered tenure windows by path frequency:
   - Path 1: as-of → tenure end
   - Intermediate starts by frequency through the last start
   - Final path: ends on Simulation End
5. Simulate each window with GBM: `S_t = S_{t-1} · exp(drift + σ · Z)`.
6. Run the **same** hedge → NAV engine as the Backtester (`nav.py` / `black_scholes.py` byte-identical; roll calendar uses `pin_current_month_roll_to_latest`).
7. Intel sheets show rolls, expiries, and closes from **as-of through Simulation End** (no Source column).

## Run locally (Windows)

```powershell
cd "C:\Users\shiba\OneDrive\Desktop\Gift AIF Forwardtester"
.\start.ps1
# or: start.bat / ./start.sh
```

| Surface | URL |
|---------|-----|
| UI | http://127.0.0.1:3000 (fallback 3001) |
| API docs | http://127.0.0.1:8000/docs |

## Desk controls

- **Header strip**: As Of Today · Simulation End · Simulation End Days · Trading Days · Monthly Expiries (as-of → Simulation End; compact horizontal scroll)
- **Path frequency**: Daily / Weekly / Monthly / Quarterly / Semi-annually
- **Path count**: computed from frequency and Simulation End Days — no fixed dropdown
- **Simulation End Days**: Product Input field (default **3650**)
- Product upload (same `Product_Input_File.xlsx` format as the product desk)
- **GBM band** (after Run): Estimation from 2001-01-01 through today’s as-of; S₀ / μ / σ / drift cards
- **Intel**: Futures rolls · Option expiries · Nifty closes — columns match Backtester (no Source)

## Backtester parity (locked)

| Piece | Rule |
|-------|------|
| `nav.py`, `black_scholes.py` | Identical to Backtester |
| Product rate defaults | Identical (Forwardtester adds Simulation End Days only) |
| Roll cost | First month = **19** trading days → ≈ **4.7713** pts; later = calendar Δt/365 |
| Open-month roll | `pin_current_month_roll_to_latest` — terminal month = latest Nifty session |
| Hedge / NAV | Same engines; spots from path GBM (observation Nifty floored from path closes) |

## Stack

- Frontend: Next.js 15 + React 19 + Tailwind
- Backend: FastAPI + numpy + openpyxl
- Optional MongoDB for product / job / market snapshot meta

## Documentation

Full set under [`docs/`](docs/README.md). Deploy guide: [`docs/08-deploy-vercel-render.md`](docs/08-deploy-vercel-render.md).

## Deploy (Vercel + Render)

Full guide with **every environment variable**: [`docs/08-deploy-vercel-render.md`](docs/08-deploy-vercel-render.md).

| Piece | Host | Root / key env |
|-------|------|----------------|
| API | [Render](https://render.com) Web Service | Root `backend` · `MONGODB_URI`, `MONGODB_DB` · optional `FORWARDTEST_*` |
| UI | [Vercel](https://vercel.com) | Root `frontend` · **`BACKEND_URL`** = `https://YOUR-SERVICE.onrender.com` (no trailing slash) |
| Optional | Vercel | `NEXT_PUBLIC_BACKEND_URL` = same Render URL (faster cold wakes) |

**Never put Mongo credentials on Vercel.** Never commit real `.env` secrets.
