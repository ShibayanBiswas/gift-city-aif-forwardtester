# 06 — UI / UX

The Gift City AIF Forward Tester desk UI follows **Anand Rathi Wealth Primary SP Dashboard** visual language: glass panels, maroon/gold accents, full-width sections, Cormorant Garamond display headings, Source Sans 3 body. Dark mode uses a warm night palette (champagne titles, gold-lit mesh, wine surfaces).

**Motion:** Framer Motion + CSS — drifting mesh, gold shimmer rules, sliding main-nav pill, staggered KPI/meta cards, floating Run CTA, progress-bar sheen, home hero ambient glow. Shared springs live in `frontend/lib/motion.ts`. `prefers-reduced-motion` disables looping CSS animations.

**Architecture:** [05-architecture.md](05-architecture.md) · **Product tables:** [03-product-input-spec.md](03-product-input-spec.md) · **Formulas (reference):** [09-formulas-and-product-books.md](09-formulas-and-product-books.md).

---

## Navigation Model

| Main | Subtabs | Route |
|------|---------|-------|
| Home | — | `/` |
| Analytics | Path Charts · Path Summary | `/analytics`, `/analytics/summary` |
| Desk | Product · Paths · Hedging Sheet · Computation · Daily Ledger | `/product`, `/paths`, `/hedging`, `/computation`, `/computation/ledger` |
| Intel | Market Calendar · Monte Carlo Matrix · Logic Atlas | `/intel`, `/intel/matrix`, `/intel/logic` |

### Header controls (global)

| Control | Behaviour |
|---------|-----------|
| **Monte Carlo Paths** | Default **1000**; single control: presets **100 / 500 / 1000 / 5000 / 10000** or **Custom…** for any whole number **1…10000**. Confirm dialog at **≥ 5000**, centered like the progress modal. Free hosts may clamp near **2000**. |
| **Sample Input** | `GET /api/product/sample` — branded `Product_Input_File.xlsx` |
| **Upload** | `POST /api/product/upload` — becomes current product for next Run |
| **Run** | Starts forward test; cancels prior job if running |
| Theme toggle | Light / dark desk palette |
| Market strip | **As Of Today** · **Product End** · **Tenure Days** · **Monte Carlo Paths** · **Trading Days** · **Monthly Expiries** — full-width equal cards; wraps on tablet/phone. Trading Days / Monthly Expiries count **as-of → Product End** only. |

**Naming:** Excel “As per HS” → UI **Hedging Sheet** (URL `/hedging` unchanged). Headings, tabs, and short button labels use **Title Case**. Always say **Monte Carlo** (never “MC”) in desk copy.

Options book Trade Side: **Sold Put Option** / **Bought Put Option** (default book is six puts: −91.5@137 … +1@70).

There is **no Path Frequency** control and **no Since Calendar Year** filter — every path shares As Of Today, so yearly-by-start-year views are gone.

---

## Desk card rails

Metric chips (product meta, KPI band, GBM params, path meta, header market meta) use a **full-width rail** with horizontal scroll when the viewport is narrower than the cards.

**Product meta order:** Principal Amount · Product Start · Product End · Product Tenure · Observation Count · Active Option Legs · Monte Carlo Paths.

**Tables:** cell text is never ellipsized — wide sheets scroll horizontally.

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

Every path starts on **as-of** (latest Nifty session) and ends on **Product End** (`path_end_calendar`). Independent GBM seeds only — no staggered start grid.

---

## Page Behaviours

### Home (`/`)

| Section | Content |
|---------|---------|
| Product strip | Principal · Product Start · Product End · Tenure · Obs · Legs · Monte Carlo Paths — horizontal card rail |
| KPI band | After Run: **Monte Carlo Paths** first, then mean/median terminal & IRR, above/below mean & median terminal & IRR counts, hit rate — **no “Paths Since YEAR”** |
| Nifty Path Parameters | Date range + cards for spot · daily return · stdev · drift; desk **Download Excel** (Parameters + Simulated Nifty sheets) |

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

Path 1 Result Total should read ≈ **180.7724** Cr for sample product after a historical-parity spot-check (Forwardtester Run uses GBM).

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
| **Path Charts** | Cohort KPI band + single-path **Net Required Futures Delta** chart (NAV on Computation). No yearly-by-start-year bars — all paths share As Of Today |
| **Path Summary** | KPI band; sortable table with Start/End Nifty; click row to select path |

Path picker on both subtabs.

### Intel

| Subtab | Content |
|--------|---------|
| **Market Calendar** | Shared forward **dates only** (As Of Today → Product End): futures shift dates · monthly option expiries. No Nifty levels or roll cost points (those vary by path). |
| **Monte Carlo Matrix** / Simulated Nifty Paths | On-screen preview samples **early + late** trading dates so Product End is visible; Excel download is the **full** As Of → Product End grid (rows = path number, columns = trading dates) — identical to Home |
| **Logic Atlas** | Module rail + Active Pipeline step cards |

**Run:** set **Monte Carlo Paths** (default **1000**), then **Run**. The engine stays serial / path-by-path on constrained hosts, and Excel export queues in the background. Download may take several minutes on large N; wait for the button status. After a server restart, if the previous run was lost — click **Run** again.

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
Product Input → product.py (+ tenure · Monte Carlo Paths)
Market CSVs → market.py / market_sync.py (shifts = monthly expiries)
Forward pad → forward_calendar.py (Mon–Fri · monthly expiry = futures shift)
Path windows → paths.py + gbm.py (as-of → Product End; N seeds; no 235 CSV pins)
Hedging Sheet → hedge.py + black_scholes.py
Computation → nav.py
Job / API → forwardtest.py + main.py
```

Authority note shown in Atlas copy: **WF1 > Notes** for BS rates (6.6%/7.6%/Near–Far vs Notes 7%/8%/13.3%).

---

## Chart Rules

| Rule | Detail |
|------|--------|
| Path Charts | Single-path delta (and related series) — **not** mean/median by start year |
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
| **Simulated Nifty Paths** | Home single button + Intel Monte Carlo Matrix — params block + `Path \\ Date` × ISO dates (full grid) |

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
2. **Run** (Monte Carlo Paths default 1000) → Home GBM band shows estimation **2001-01-01 → As Of Today**; μ / σ / drift populated.
3. **Download Excel** on Nifty Path Parameters → branded Parameters + Simulated Nifty sheets.
4. Hedging Sheet / Computation for selected path; Monte Carlo Matrix for full path×date Nifty; Market Calendar for shared dates.
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
