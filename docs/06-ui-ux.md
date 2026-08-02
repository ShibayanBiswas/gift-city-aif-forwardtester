# 06 — UI / UX

The Gift City AIF Forward Tester desk UI follows **Anand Rathi Wealth Primary SP Dashboard** visual language: glass panels, maroon/gold accents, full-width sections, Cormorant Garamond display headings, Source Sans 3 body. Dark mode uses a warm night palette (champagne titles, gold-lit mesh, wine surfaces).

**Architecture:** [05-architecture.md](05-architecture.md) · **Product tables:** [03-product-input-spec.md](03-product-input-spec.md) · **Formulas (reference):** [09-formulas-and-product-books.md](09-formulas-and-product-books.md).

---

## Navigation Model

| Main | Subtabs | Route |
|------|---------|-------|
| Home | — | `/` |
| Analytics | Yearly Lab · Path Summary | `/analytics`, `/analytics/summary` |
| Desk | Product · Paths · Hedging Sheet · Computation · Daily Ledger | `/product`, `/paths`, `/hedging`, `/computation`, `/computation/ledger` |
| Intel | Market Calendar · Monte Carlo Matrix · Logic Atlas | `/intel`, `/intel/matrix`, `/intel/logic` |

### Header controls (global)

| Control | Behaviour |
|---------|-----------|
| **Since Calendar Year** | Analytics filter; default **2001** |
| **Path Frequency** | Default **Monthly**; also Daily (heavy) · Weekly · Quarterly · Semi-annually |
| **Sample Input** | `GET /api/product/sample` — branded `Product_Input_File.xlsx` |
| **Upload** | `POST /api/product/upload` — becomes current product for next Run |
| **Run** | Starts forward test; cancels prior job if running |
| Theme toggle | Light / dark desk palette |
| Market strip | **As Of Today** · **Simulation End** · **Simulation End Days** · **Trading Days** · **Monthly Expiries** — responsive **grid**. Trading Days / Monthly Expiries count **as-of → Simulation End** only. Default Simulation End Days = **7300**. |

**Naming:** Excel “As per HS” → UI **Hedging Sheet** (URL `/hedging` unchanged). Headings, tabs, and short button labels use **Title Case**.

Options book Trade Side: **Sold Put Option** / **Bought Put Option** (default book is six puts: −91.5@137 … +1@70).

---

## Desk card rails

Metric chips (product meta, KPI band, GBM params, path meta) use a **horizontal scroll rail** only when needed for overflow. Header market meta uses a **static responsive grid** — no sheen / slide animations.

**Sizing (desk lock):** cards are **compact** — ~10–10.5 rem min-width, moderate padding, value text ~1.05–1.28 rem (KPI means use `text-lg` / `text-xl`, not oversized `text-2xl`).

CSS: `.market-meta-*` and `.desk-card-rail*` in `frontend/app/globals.css`.

---

## Path Picker (shared component)

Used on Product, Paths, Hedging Sheet, Computation, Analytics.

| Element | Spec |
|---------|------|
| Label row | **Select Simulation Path** |
| Active path | Title + date range |
| Meta chips | Path · Start · End · Trading Days · Calendar Days · Start Nifty · End Nifty — horizontal scroll rail |
| Dropdown | Fixed **496px** list height — exactly **4** options visible on every tab |
| Menu rows | Partition Start / End / Days / Nifty |

Path 1 starts on **as-of** (latest Nifty session). The final path ends on **Simulation End**. Intermediate paths use Backtester tenure windows under GBM spots.

---

## Page Behaviours

### Home (`/`)

| Section | Content |
|---------|---------|
| Product strip | Principal · Tenure · Obs · Legs · Simulation End Days · Simulation End — horizontal card rail |
| KPI band | After Run: **Total Paths · frequency**, Paths Since year, mean/median terminal, hit rate, IRR — horizontal card rail |
| Nifty Path Parameters | Date range + cards for spot · daily return · stdev · drift; desk **Download Excel** (Parameters + Simulated Nifty sheets) |
| Yearly chart | Mean / median terminal by start year (filtered by Since year) |

Empty state: **Desk Ready** hint — upload / sample + Run.

### Product (`/product`)

Full-width desk sections powered by **`ProductSpecTables`** (`frontend/components/ProductSpecTables.tsx`). The live book is what **Run** uses; formulas stay in [09-formulas-and-product-books.md](09-formulas-and-product-books.md).

| Section | Displays |
|---------|----------|
| **Product meta strip** | Principal · Tenure · Obs Window · Book→HS · Fwd/Disc · NAV Seeds (5·95·6%) |
| **Observation Months** | Month offsets and calendar days (×30.5) from Product Input |
| **Options Book** | Trade Side, qty, strike %, return, Fwd/Disc/Vol — **Excel row order, never resorted** |

Path picker after a run. **Download Product Excel** exports Observation Months + Options Book.

Trade Side renders from signed qty. Rates show as percentages; missing rates show `—` (engine uses WF1 defaults when parsing blank cells).

### Paths (`/paths`)

| Element | Content |
|---------|---------|
| Path picker | Same shared component |
| Trading calendar | Path trading days; observation expiry days highlighted |

Shows path window vs product tenure (1930 calendar days for sample).

### Hedging Sheet (`/hedging`)

Excel As per HS equivalent

| Table | Columns |
|-------|---------|
| **Observation Schedule** | Month offset · Target date · Expiry · **Nifty On Expiry** |
| **Options Book** | Flat leg×obs table: Strike, Expiry, Qty, Fwd, Disc, Vol, **Nifty On Expiry** |

Path-dependent: Spot₀, observation dates, obs Nifties, strikes, contract qtys, daily Req. Delta feed.
Path-invariant: Fwd **6.6%**, Disc **7.6%**, Near/Far vols per strike.

Download Excel on each table.

### Computation (`/computation`)

| Sub-view | Content |
|----------|---------|
| **Result** | Invt, MTM Futures, Cash+Int, Gsec, Tx, Fees, **Total**, IRR — mirrors Computation AC block |
| **Daily Ledger** | Link to full-width chart page |
| **Buy And Sell Costs** | WF1 rate card + path totals in ₹ Cr, including brokerage/GST inside all-in |
| **Daily Rows** | Full Computation column strip |
| **Trade Cost Ledger** | Days with futures quantity change (tx ≠ 0) |

Path 1 Result Total should read ≈ **180.7724** Cr for sample product after monthly Run spot-check.

### Daily Ledger (`/computation/ledger`)

Route matches `frontend/lib/navigation.ts` (**Daily Ledger** subtab under Computation).

Full-width stacked charts

| Series | Label |
|--------|-------|
| NAV | **Net Asset Value In ₹ Crores** |
| Delta | **Net Required Futures Delta** |

Gradient areas; axis labels; ≤ 3 decimal places in tooltips.

### Analytics

| Subtab | Content |
|--------|---------|
| **Yearly Lab** | Bar chart — **Mean Terminal In Crores** · **Median Terminal In Crores** by start year; single-path delta chart |
| **Path Summary** | KPI band (mean + median); sortable table with Start/End Nifty; click row to select path |

Path picker on both subtabs.

### Intel

| Subtab | Content |
|--------|---------|
| **Market Calendar** | Shared forward **dates only** (As Of Today → Simulation End): futures shift dates · monthly option expiries. No Nifty levels or roll cost points (those vary by path). |
| **Simulated Nifty Paths** | Full As Of → Simulation End grid — rows = path number, columns = **trading dates** — plus Excel download (identical to Home button; streaming writer on the API) |
| **Logic Atlas** | Module rail + Active Pipeline step cards |

**Run frequency:** default **Monthly**. The frequency dropdown shows live path counts. On free Render, **Daily** is rejected by the API (memory). After a server restart, Download may say the previous run was lost — click **Run** again.

**Market Calendar tabs:**

| Tab | Columns | Source |
|-----|---------|--------|
| Futures Shift Dates | Row · Futures Shift Date · Weekday | `GET /api/market/rolls` (dates; `roll_cost` always null) |
| Nifty Option Expiries | Row · Expiry · Weekday · Contract | `GET /api/market/expiries` (dates; `nifty_close` always null) |

Available without a Run. Path-specific simulated Nifty and roll points: **Monte Carlo Matrix**, **Hedging Sheet**, **Computation**.

**GBM reminder:** path rows are independent. For the same trading date, Path 2’s simulated Nifty is generally not Path 1’s. μ / σ are recomputed from **2001-01-01 → as-of** on every Run.

## Logic Atlas vs Product Spec

| Surface | Location | Depth | Best for |
|---------|----------|-------|----------|
| **Product** | Desk → Product | Live book tables (obs + options) | Building/uploading products; inspecting Run inputs |
| **Logic Atlas** | Intel → Logic Atlas | Module rail + Active Pipeline step cards | Onboarding; explaining engine stages |

Both cite **WF1 > Notes** for BS rates (6.6%/7.6%/Near–Far). Logic Atlas copy is aligned to [04-forwardtest-engine.md](04-forwardtest-engine.md); formulas live in docs 09/11.

---

## Logic Atlas (Intel)

The Logic Atlas is the in-app **pipeline map** for desk education — it does not duplicate formula cards from [09-formulas-and-product-books.md](09-formulas-and-product-books.md) on every page (desk UI stays clean).

| UI element | Purpose |
|------------|---------|
| **Module rail** | Horizontal list of engine stages: Product → Market → Paths → Hedge → NAV → Analytics |
| **Active Pipeline cards** | Selected module: title, short description, detail paragraph, bullet list of inputs/outputs |
| **Scroll** | Horizontal scroll when modules exceed viewport |

Maps to engine modules in [04-forwardtest-engine.md](04-forwardtest-engine.md) and [05-architecture.md](05-architecture.md)

```
Product Input → product.py (+ Simulation End Days)
Market CSVs → market.py / market_sync.py (+ pin_current_month_roll_to_latest)
Forward pad → forward_calendar.py (Mon–Fri · last-Tue · month-end rolls)
Path windows → paths.py + gbm.py (as-of → Simulation End; no 235 CSV pins)
Hedging Sheet → hedge.py + black_scholes.py
Computation → nav.py
Job / API → forwardtest.py + main.py
```

Authority note shown in Atlas copy: **WF1 > Notes** for BS rates (6.6%/7.6%/Near–Far vs Notes 7%/8%/13.3%).

---

## Chart Rules

| Rule | Detail |
|------|--------|
| Bar legends | **Mean Terminal In Crores** · **Median Terminal In Crores** — never raw `mean_total` keys |
| Line legends | **Net Asset Value In ₹ Crores** · **Net Required Futures Delta** |
| Formatting | Axes labelled; gradient fills; numbers ≤ 3 decimals in tooltips |
| Hit rate | Display as percent; formula in [09-formulas-and-product-books.md](09-formulas-and-product-books.md) |

---

## Excel Downloads

All desk exports use `lib/download.ts` **except** the Monte Carlo matrix, which streams from the API (`client.downloadMcMatrix` → `/api/forwardtest/{id}/mc-matrix.xlsx`).

| Feature | Detail |
|---------|--------|
| Branding | Anand Rathi logo header block (most desk tables) |
| Typing | Native Excel number / date / percent cell types |
| `exportRows` / `columnTypes` | UI display formatting vs raw typed export values |
| Triggers | Per-table **Download Excel**; Computation path packs |
| **Simulated Nifty Paths** | Home single button + Intel MC Matrix — params block + `Path \\ Date` × ISO dates |

---

## Progress Modal

| Phase | UX |
|-------|-----|
| Warming | “Warming Engine” copy while `/api/sync` and job queue |
| Running | Smooth progress bar; live path messages (`start → end`) |
| Poll | ~180–280ms; faster during warm-up |
| Error | Stays open with Dismiss; no tqdm / ANSI noise |
| Cancel | Superseded job → clear copy; path detail 409 |

---

## Empty / Error States

| Condition | UI behaviour |
|-----------|--------------|
| No job yet | Desk Ready hint (upload / sample + Run) |
| Path detail loading | Spinner — not a sticky “not ready” banner |
| Cancelled / superseded job | Clear copy; path detail returns **409** |
| Unknown job after API restart | Clear local job state; prompt Run again |
| Mongo unavailable | Silent degrade — CSV + JSON jobs still work |

---

## Desk Verification Flow (UI)

1. **Sample Input** → Product tab: 6 puts, obs **38…56**, Fwd/Disc/vols match [03-product-input-spec.md](03-product-input-spec.md).
2. **Run** → Home GBM band shows estimation **2001-01-01 → As Of Today**; μ / σ / drift populated.
3. **Download Excel** on Nifty Path Parameters → branded Parameters + Simulated Nifty sheets.
4. Hedging Sheet / Computation for selected path; MC Matrix for full path×date Nifty; Market Calendar for shared dates.
5. Intel Logic Atlas: confirm pipeline order matches engine.
6. Full script checklist: [07-verification.md](07-verification.md). Deploy: [08-deploy-vercel-render.md](08-deploy-vercel-render.md).

**Excel caveat:** Do not compare UI Computation to a stale Excel Computation paste; trust the live engine vs Summary Path 1 / Path 10 anchors (Backtester historical gold).

---

## Typography and Colour Tokens

| Token | Use |
|-------|-----|
| Display | Cormorant Garamond — page titles, KPI values |
| UI | Source Sans 3 — tables, labels, buttons |
| Maroon / gold | Primary brand; glass panel borders |
| Dark mode | Wine surfaces, champagne headings, gold mesh background |

Defined in `frontend/app/globals.css`.
