# Gift City AIF Forwardtester

Monte Carlo **forward tester** for Anand Rathi Wealth GIFT City Category III AIF structured units.

Same hedging sheet, computation NAV, roll cost, delta, and product desk as the Gift AIF Backtester — path generation uses **Geometric Brownian Motion** from today’s Nifty instead of historical rolling windows.

## How it works

1. Load Nifty closes from **2001-01-01 → latest session** (Yahoo sync keeps this current).
2. Compute daily returns → **μ** (mean), **σ** (stdev), **drift = μ − ½σ²**.
3. Resolve **Simulation End** = as-of + **Simulation End Days** (default **3650**, must exceed product tenure). That date is the **final path’s end**.
4. Build staggered tenure windows by path frequency:
   - Path 1: as-of → tenure end
   - Intermediate starts by frequency through the last start
   - Final path: ends on Simulation End
5. Simulate each window with GBM: `S_t = S_{t-1} · exp(drift + σ · Z)`.
6. Run the same hedge → NAV engine as the Backtester (delta, rolls, cash, Gsec, fees, IRR).
7. Intel sheets show rolls, expiries, and closes from **as-of through Simulation End**.

## Run locally (Windows)

```powershell
cd "C:\Users\shiba\OneDrive\Desktop\Gift AIF Forwardtester"
.\start.ps1
# or: start.bat
```

| Surface | URL |
|---------|-----|
| UI | http://127.0.0.1:3000 (fallback 3001) |
| API docs | http://127.0.0.1:8000/docs |

## Desk controls

- **Header strip**: As Of Today · Simulation End · Simulation End Days · Trading Days · Monthly Expiries (as-of → Simulation End; horizontal scroll)
- **Path frequency**: Daily / Weekly / Monthly / Quarterly / Semi-annually
- **Path count**: computed from frequency and Simulation End Days — no fixed dropdown
- **Simulation End Days**: Product Input field (default 3650)
- Product upload (same `Product_Input_File.xlsx` format as the product desk)
- **GBM band** (after Run): Estimation from 2001-01-01 through today’s as-of; S₀ / μ / σ / drift cards

## Stack

- Frontend: Next.js 15 + React 19 + Tailwind
- Backend: FastAPI + numpy + openpyxl
- Optional MongoDB for product / job / market snapshot meta

## Deploy (Vercel + Render)

Full step-by-step with every environment variable: **[docs/08-deploy-vercel-render.md](docs/08-deploy-vercel-render.md)**.

| Piece | Host | Root / key env |
|-------|------|----------------|
| API | [Render](https://render.com) Web Service | Root `backend` · `MONGODB_URI`, `MONGODB_DB` |
| UI | [Vercel](https://vercel.com) | Root `frontend` · `BACKEND_URL` = Render URL (no trailing slash) |

Repo: https://github.com/ShibayanBiswas/gift-city-aif-forwardtester
