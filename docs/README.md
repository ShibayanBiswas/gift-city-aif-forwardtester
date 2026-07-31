# Gift City AIF Forwardtester — Documentation Index

Gift City AIF Forwardtester projects structured-unit outcomes from **As Of Today** (latest Nifty close) through **Simulation End** under Geometric Brownian Motion. Hedge and Computation follow **`Gift AIF Working File 1.xlsm`**. When Notes narrative and WF1 formulas disagree, the engine follows WF1.

| Doc | Topic |
|-----|--------|
| [01-overview.md](01-overview.md) | Purpose, desk capabilities, sample product, header horizon strip |
| [02-excel-sheet-logic.md](02-excel-sheet-logic.md) | WF1 sheet mirror + forward calendar |
| [03-product-input-spec.md](03-product-input-spec.md) | Product Input + Simulation End Days |
| [04-forwardtest-engine.md](04-forwardtest-engine.md) | Path atlas, GBM, Mon–Fri pad, hedge, NAV |
| [05-architecture.md](05-architecture.md) | Next.js + FastAPI |
| [06-ui-ux.md](06-ui-ux.md) | Desk UI, horizontal card rails, header chips |
| [07-verification.md](07-verification.md) | Checks |
| [08-deploy-vercel-render.md](08-deploy-vercel-render.md) | Deploy |
| [09-formulas-and-product-books.md](09-formulas-and-product-books.md) | Formulas + forward calendars |

**Dynamic Product Input:** Upload or change any field (Simulation End Days, tenure, observations, legs, rates). The desk refreshes market meta immediately; prior Run results clear when the product fingerprint no longer matches. Header · Intel · Logic Atlas · path atlas all key off the live `ProductSpec` — nothing is frozen to sample 1930/3650 except as the engine default when the Excel field is blank.
