# Gift City AIF Forwardtester

Monte Carlo **forward tester** for Anand Rathi Wealth GIFT City Category III AIF structured units.

Same hedging sheet, computation NAV, roll cost, delta, and product desk as the [Gift AIF Backtester](https://github.com/ShibayanBiswas) — path generation uses **Geometric Brownian Motion** from today’s Nifty instead of historical rolling windows.

**Repo:** https://github.com/ShibayanBiswas/gift-city-aif-forwardtester

## How it works

1. Load Nifty closes from **2001-01-01 → latest session** via Yahoo sync.
2. Compute daily returns → **μ** mean, **σ** stdev, **drift = μ − ½σ²**.
3. Resolve **Product End** = `path_end_calendar(as-of, tenure)` — same Backtester anniversary rule.
4. Build **N Monte Carlo paths** over one window, default **N = 1000**:
   - Every path: Start = as-of, End = Product End
   - Independent GBM seed per `path_id`
5. Simulate each path: `S_t = S_{t-1} · exp(drift + σ · Z)`.
6. Run the same hedge → NAV engine as the Backtester — `black_scholes.py` byte-identical; `nav.py` / `hedge.py` share the same math with path-spot and path-roll inputs; roll calendar uses `pin_current_month_roll_to_latest`.
7. Intel sheets show rolls, expiries, and closes from as-of through Product End — no Source column.

## Run locally (Windows)

```powershell
cd "C:\Users\shiba\OneDrive\Desktop\Gift AIF Forwardtester"
.\start.ps1
# or: start.bat / ./start.sh
```

| Surface | URL |
|---------|-----|
| UI | http://127.0.0.1:3000 · fallback 3001 |
| API docs | http://127.0.0.1:8000/docs |

## Desk controls

- **Header strip**: As Of Today · Product End · Tenure Days · Monte Carlo Paths · Trading Days · Monthly Expiries — full-width equal cards; wraps on smaller screens
- **Monte Carlo Paths**: default **1000**; presets 100 / 500 / 1000 / 5000 / 10000; Custom… for any whole number 1…10000; confirm dialog at **5000+**, centered like the progress modal
- **Product End**: tenure calendar end from as-of
- Free cloud hosts clamp runs near **2000** paths and skip auto Excel after Run; download Excel on demand still works
- Product upload — same `Product_Input_File.xlsx` format as the product desk
- **Nifty Path Parameters** after Run: S₀ / daily return / standard deviation / drift from **2001-01-01 → as-of**, plus desk **Download Excel**
- **Intel**: Path Market · Simulated Nifty Paths · Logic Atlas

## Simulated Nifty Excel

| Sheet | Content |
|-------|---------|
| Parameters | S₀, μ, σ, drift, estimation window, path/date counts |
| Simulated Nifty | Rows = path numbers; columns = trading dates as-of → Product End; Path/Start/End identical across rows |

Home and Intel both use `GET /api/forwardtest/{job_id}/mc-matrix.xlsx`.

## Backtester parity — locked

| Area | Status |
|------|--------|
| `black_scholes.py` | Byte-identical |
| Product rate defaults | Identical — Forwardtester adds Monte Carlo Paths |
| Observation schedule | Identical month×30.5 → monthly expiry |
| Hedge / NAV | Same engines; spots from path GBM — observation Nifty floored from path closes |
| Roll costs | Identical formulas; Forwardtester uses `pin_current_month_roll_to_latest` |

## Docs

Full set under [`docs/`](docs/README.md). Deploy guide: [`docs/08-deploy-vercel-render.md`](docs/08-deploy-vercel-render.md).

## Deploy — Vercel + Render

Step-by-step with every environment variable: [`docs/08-deploy-vercel-render.md`](docs/08-deploy-vercel-render.md).

| Piece | Host | Root | Env |
|-------|------|------|-----|
| API | [Render](https://render.com) Web Service | `backend` | **`MONGODB_URI`**, **`MONGODB_DB`** recommended · optional `FORWARDTEST_WORKERS` / `FORWARDTEST_MODE` / `FORWARDTEST_CONSTRAINED` |
| UI | [Vercel](https://vercel.com) | `frontend` | **`BACKEND_URL`** = `https://YOUR-SERVICE.onrender.com` required, no trailing slash · optional `NEXT_PUBLIC_BACKEND_URL` same URL |

**Do not put Mongo credentials on Vercel.** Never commit real `.env` secrets. Template: [`.env.example`](.env.example).

Cold start: first API call after idle can take 30–60s on free Render — the UI wakes the API before Run.
