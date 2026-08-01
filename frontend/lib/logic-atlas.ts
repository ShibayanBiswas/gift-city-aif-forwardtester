/**
 * Gift City AIF Logic Atlas — desk-facing stage map of the **codebase working procedure**.
 * Insights describe what `backend/app/engine/` does at each stage (not Excel audit / parity chatter).
 * Equation reference for developers: docs/09, docs/11. Verification tallies stay in docs only.
 */

import { addCalendarDaysIso, formatDeskDate } from "@/lib/api";
export type LogicNodeKind = "input" | "process" | "engine" | "lookup" | "output";

export type LogicNoteCard = {
  title: string;
  body: string;
  bullets?: string[];
  code?: string; // optional one-liner formula/code
};

export type LogicNode = {
  id: string;
  label: string;
  kind: LogicNodeKind;
  /** One-line summary shown under the title. */
  description: string;
  /** Extra desk-facing detail so Active Pipeline cards are not shallow. */
  detail?: string;
  /** Short bullets rendered on the card. */
  bullets?: string[];
  /** Numbered working steps shown in the detail panel */
  steps?: string[];
  /** Key field/value pairs (e.g. options book columns) */
  fields?: Array<{ label: string; value: string }>;
};

export type LogicModule = {
  id: string;
  title: string;
  subtitle: string;
  excelSheet: string;
  engineFile: string;
  accent: "maroon" | "gold" | "ink" | "teal" | "amber" | "rose";
  purpose: string;
  stageCount: number;
  metrics: Array<{ label: string; value: string }>;
  nodes: LogicNode[];
  defaults: Array<{ label: string; value: string }>;
  insights: string[]; // short one-liners OK as fallback
  noteCards: LogicNoteCard[]; // rich procedure cards per module
  outputs: string[];
};

export type ComputationPrimitive = {
  name: string;
  category: string;
  role: string;
};

export const logicModules: LogicModule[] = [
  {
    id: "product-input",
    title: "Product Input",
    subtitle: "Principal · Tenure · Observation Months · Options Book",
    excelSheet: "Product_Input_File.xlsx",
    engineFile: "engine/product.py",
    accent: "amber",
    purpose:
      "parse_product_workbook reads the product workbook top to bottom — principal, tenure, observation months, and option legs — and emits ProductSpec for every downstream engine stage.",
    stageCount: 5,
    metrics: [
      { label: "Principal", value: "100 Cr" },
      { label: "Tenure", value: "1930 Days" },
      { label: "Observations", value: "7" },
    ],
    nodes: [
      {
        id: "upload",
        label: "Workbook Ingest",
        kind: "input",
        description: "Sample Input or an uploaded .xlsx becomes the live product definition for the desk.",
        detail:
          "POST /api/product/upload copies the file to data/uploads/current_product.xlsx; GET /api/product/sample serves the repo sample. The next Run always parses whatever file is current — there is no second product source mid-job.",
        bullets: [
          "Sample Input or Upload → current_product.xlsx",
          "openpyxl load with data_only=True",
          "First sheet matching product / input / as per",
        ],
        steps: [
          "Desk selects Sample Input or uploads Product_Input_File.xlsx.",
          "API persists the workbook under data/uploads/current_product.xlsx.",
          "parse_product_workbook(path) is invoked on Run and on GET /api/product/current.",
          "Parsed ProductSpec is serialized to the job payload and hedge_path input.",
        ],
      },
      {
        id: "principal",
        label: "Principal And Tenure",
        kind: "lookup",
        description: "Label rows for Principal and Tenure Days supply notional and calendar tenure.",
        detail:
          "Principal is stored in INR (sample 1,000,000,000 = ₹100 Cr). Tenure Days drives path_end_calendar, IRR denominator, and fee accrual calendar in nav.py.",
        bullets: [
          "Principal row → product.principal (INR)",
          "Tenure row → product.tenure_days (integer)",
          "principal_cr = principal / 1e7 for desk display",
        ],
        steps: [
          "Scan grid rows; match label containing 'principal' in column A.",
          "Read numeric value from column B via _to_float → product.principal.",
          "Match label containing 'tenure' → int tenure_days.",
          "Raise ValueError if either field is missing after the scan.",
        ],
      },
      {
        id: "obs",
        label: "Observation Months",
        kind: "process",
        description: "Month offsets under the Observation header, deduplicated in file order.",
        detail:
          "Observation months are floats in [1, 120] read from the column whose header contains 'observation'. Sample book: 38, 41, 44, 47, 50, 53, 56. hedge.build_observations converts each to target = start + m × 30.5.",
        bullets: [
          "Seven offsets in the sample book",
          "Dedup preserves first-seen order",
          "n_obs = len(observation_months)",
        ],
        steps: [
          "Locate Observation header in the first ~30 rows; record obs_col index.",
          "Walk every grid row; append float values in [1, 120] from obs_col.",
          "Deduplicate with a seen-set while preserving Excel order.",
          "Expose as ProductSpec.observation_months for hedge_path on every path.",
        ],
      },
      {
        id: "legs",
        label: "Options Book Rows",
        kind: "engine",
        description:
          "Each options-book row becomes an OptionLegSpec; active_legs (Include ≠ No) feed build_legs, which expands every strike × n_obs observation expiries.",
        detail:
          "parse_product_workbook detects the header row containing Qty/Quantity, maps columns (Return Level, Strike %, Option, Forward, Discount, Vol Near, Vol Far, Qty, Include), and walks rows top to bottom. The sample book holds six put legs (−91.5 / 90.5 / 1.0 / −25.6 / 24.0 / 1.0 at strikes 137%–70%); hedge.build_legs later multiplies each active leg by seven observation expiries with contract qty = raw × principal / Spot₀ / n_obs.",
        bullets: [
          "Header-driven column map via col_map",
          "Six sample puts — sold/bought pairs at five return levels",
          "active_legs skips Include=No and qty 0.6 legacy display rows",
          "Legacy fallback: return in col A, qty in col E",
          "Rates default Forward 6.6%, Discount 7.6% when cells blank",
          "Vol Near applies obs index 0; Vol Far on obs 1…N−1",
        ],
        steps: [
          "Find header row (first ~40 rows) where labels include 'qty' or 'quantity'; build col_map from lowercase headers.",
          "Resolve column indices: Return Level (ret_c), Strike % (strike_c), Option (opt_c), Forward (fwd_c), Discount (disc_c), Vol Near (vol_near_c), Vol Far (vol_c), Qty (qty_c), Include (include_c).",
          "For each data row below the header: parse Qty via _to_float; parse Return Level via _to_rate_fraction (accepts 0.37, 37%, or 37 percent points).",
          "Parse Strike % via _to_strike_pct — accepts Excel percent (1.37), points (137), or '137%'; if blank, derive (1 + return) × 100.",
          "Parse Option via _option_code → 'P' unless cell starts with C or contains CALL.",
          "Parse Forward and Discount via _to_rate_fraction; fall back to DEFAULT_FORWARD (0.066) and DEFAULT_DISCOUNT (0.076).",
          "Parse Vol Far and Vol Near; blank vols default to 0.15 until build_legs applies vol_for_strike_pct moneyness fallback.",
          "Parse Include: 'no', 'n', '0', 'false', 'exclude' → include=False; legacy qty 0.6 without Include column is display-only.",
          "Append OptionLegSpec to product.legs; require at least one active leg before returning ProductSpec.",
          "Downstream: build_legs(product, spot0, observations) crosses each active_legs entry with every observation expiry.",
        ],
        fields: [
          {
            label: "Return Level",
            value: "_to_rate_fraction on ret_c — paired with Strike %; filters rows outside [−1.5, 3]",
          },
          {
            label: "Strike %",
            value: "_to_strike_pct — percent of Spot₀ (137 = 137%); else (1 + return) × 100",
          },
          {
            label: "Option",
            value: "_option_code — default Put (P); Call when cell starts with C",
          },
          {
            label: "Forward",
            value: "_to_rate_fraction on fwd_c — default 6.6% (0.066) when blank",
          },
          {
            label: "Discount",
            value: "_to_rate_fraction on disc_c — default 7.6% (0.076) when blank",
          },
          {
            label: "Vol Near",
            value: "First observation vol — vol_for_observation(0) in build_legs",
          },
          {
            label: "Vol Far",
            value: "Observations 1…N−1 — spec.vol on OptionLegSpec",
          },
          {
            label: "Qty",
            value: "Signed raw quantity (_to_float); negative = sold put; scales in build_legs",
          },
          {
            label: "Include",
            value: "Yes/No gate — active_legs = include ∧ qty ≠ 0",
          },
        ],
      },
      {
        id: "spec",
        label: "Product Spec",
        kind: "output",
        description: "ProductSpec dataclass feeds paths, hedge_path, nav, and desk exports.",
        detail:
          "ProductSpec exposes name, principal, tenure_days, observation_months, legs, source_file, plus computed principal_cr, n_obs, and active_legs. Serialized via to_dict / from_dict for API and job cache.",
        bullets: [
          "Single desk source of truth per Run",
          "to_dict / from_dict for API round-trip",
          "Shared by build_paths, hedge_path, run_nav",
        ],
        steps: [
          "Assemble ProductSpec after principal, tenure, observations, and legs validate.",
          "Return to /api/product/current for Product tab rendering.",
          "Inject into forward-test worker as _WORKER_PRODUCT for every path evaluation.",
        ],
      },
    ],
    defaults: [
      { label: "Sample Principal", value: "₹100 Crore" },
      { label: "Sample Tenure", value: "1930 Calendar Days" },
      { label: "Sample Observations", value: "38, 41, 44, 47, 50, 53, 56" },
    ],
    insights: [
      "parse_product_workbook opens the first product/input sheet, scans up to 120 rows × 14 columns, and returns ProductSpec.",
      "Principal and Tenure are label-driven; observation months come from the Observation column in strict file order.",
      "Options book parsing is header-driven: Qty + Return Level required; Strike %, rates, vols, and Include are optional with engine defaults.",
      "active_legs filters Include=No and zero-qty rows — only those legs enter hedge.build_legs and compute_req_delta.",
      "Sample book: six puts at return levels 37%, 36%, 25%, −15%, −16%, −30% with signed quantities −91.5 through +1.0.",
      "Vol Near applies on observation index 0; Vol Far on indices 1…6 — build_legs calls spec.vol_for_observation(obs_i).",
      "Upload replaces data/uploads/current_product.xlsx; the next Run and every path detail load this same ProductSpec.",
    ],
    noteCards: [
      {
        title: "Entry points and file flow",
        body: "The Product tab and Run button both depend on parse_product_workbook in engine/product.py. Upload lands in data/uploads/; Sample Input uses the repo Product_Input_File.xlsx.",
        bullets: [
          "GET /api/product/sample — download branded sample",
          "POST /api/product/upload — persist + parse",
          "GET /api/product/current — desk preview of parsed spec",
        ],
      },
      {
        title: "Grid scan and sheet selection",
        body: "openpyxl loads the workbook read-only with data_only=True so Excel formulas appear as computed values. The parser picks the first sheet whose name contains product, input, or as per.",
        bullets: [
          "Max scan: 120 rows × 14 columns",
          "Label rows in column A drive principal/tenure",
          "Observation column detected from header text",
        ],
      },
      {
        title: "Rate and strike parsing helpers",
        body: "_to_rate_fraction accepts Excel percent cells (0.066), percent points (6.6), or strings like '6.6%'. _to_strike_pct normalises strike as percent-of-spot points (137 for 137%).",
        code: "strike_pct = _to_strike_pct(cell)  // default (1 + return) × 100",
      },
      {
        title: "Options book column map",
        body: "Once the Qty header row is found, lowercase labels map to column indices. Missing optional columns fall back to defaults without aborting the parse.",
        bullets: [
          "Return Level + Qty required on each leg row",
          "Forward / Discount default 6.6% / 7.6%",
          "Include column gates active_legs membership",
        ],
      },
      {
        title: "Sample six-put book shape",
        body: "The shipped sample stores each strike once (not repeated per observation). Six puts: sold −91.5 @ 137%, bought 90.5 @ 136%, bought 1.0 @ 125%, sold −25.6 @ 85%, bought 24.0 @ 84%, bought 1.0 @ 70%.",
        bullets: [
          "All legs option_type P (Put Option)",
          "Per-leg Vol Near and Vol Far from the book",
          "Seven observation months expand each leg in build_legs",
        ],
      },
      {
        title: "active_legs and Include gate",
        body: "ProductSpec.active_legs returns legs where include is True and quantity ≠ 0. Legacy sheets with qty 0.6 and no Include column treat that row as display-only.",
        code: "active_legs = [lg for lg in legs if lg.include and lg.quantity != 0]",
      },
      {
        title: "ProductSpec dataclass outputs",
        body: "Downstream engines read principal, tenure_days, observation_months, and legs. Computed properties principal_cr and n_obs avoid duplicate desk math.",
        bullets: [
          "build_paths(..., observation_months=product.observation_months)",
          "hedge_path(market, product, path_dates)",
          "run_nav(..., principal_cr=product.principal_cr)",
        ],
      },
      {
        title: "Validation and error surfaces",
        body: "Parser raises ValueError when Principal, Tenure, observation months, or any active leg is missing. The Product tab surfaces these before Run.",
        bullets: [
          "No observation months → hard stop",
          "No active_legs → hard stop",
          "Return outside [−1.5, 3] skipped as noise row",
        ],
      },
    ],
    outputs: ["Product Spec", "Observation Month Offsets", "Options Book"],
  },
  {
    id: "macro-paths",
    title: "Forward Path Atlas",
    subtitle: "As-Of Through Simulation End · Trading Days Only",
    excelSheet: "Macro Paths",
    engineFile: "engine/paths.py · engine/gbm.py · engine/forward_calendar.py",
    accent: "maroon",
    purpose:
      "build_paths staggers tenure windows from live as-of so Path 1 starts today and the final path ends on Simulation End (as-of + Simulation End Days). Spots are GBM on Mon–Fri sessions only — weekends never receive a Nifty close.",
    stageCount: 5,
    metrics: [
      { label: "Path 1 Start", value: "As-Of Close" },
      { label: "Final Path End", value: "Simulation End" },
      { label: "Sessions", value: "Mon–Fri Only" },
    ],
    nodes: [
      {
        id: "starts",
        label: "Frequency Starts",
        kind: "input",
        description: "Start grid from as-of through last start, by desk frequency.",
        detail:
          "generate_path_starts builds the grid on the forward trading calendar: every Mon–Fri (daily), first TD of ISO week / month / quarter / half-year. Path 1 is forced to as-of = market.last_date after Yahoo sync.",
        bullets: [
          "As-of updates after deploy via /api/sync",
          "Staggered GBM starts from today through Simulation End",
          "Last start chosen so tenure can reach Simulation End",
        ],
        steps: [
          "forward_asof(market) → latest Nifty session.",
          "Simulation End = asof + Simulation End Days (product, default 3650).",
          "Pool trading days [asof, s_last]; emit starts by frequency.",
        ],
      },
      {
        id: "calendar",
        label: "Forward Calendar",
        kind: "engine",
        description: "Mon–Fri pad with last-Tuesday expiries and month-end futures shifts.",
        detail:
          "extend_market_forward appends weekday sessions through the horizon pad. month_ends respects 28/29/30/31-day months (leap Februaries). Rolls = last Mon–Fri of each complete month; monthly expiries = last Tuesday. Incomplete pad months are skipped.",
        bullets: [
          "Saturday / Sunday always closed",
          "Futures shift ≠ option expiry in forward months (by design)",
          "7% roll points recomputed per path from that path's GBM spots",
        ],
        steps: [
          "_weekday_sessions(asof+1, horizon_end).",
          "_forward_month_rolls_and_expiries for complete months after as-of.",
          "path_roll_vector(path.dates, path.spots, roll_shifts) for NAV.",
        ],
      },
      {
        id: "end-rule",
        label: "Tenure End",
        kind: "process",
        description: "Same Backtester path_end_calendar; final path snaps to Simulation End.",
        detail:
          "Intermediate paths use path_end_calendar (≈5Y anniversary → prior month-end when tenure ∈ [1700,2000]). The final path's trading-day list is extended so end = last Mon–Fri on/before Simulation End.",
        bullets: [
          "Tenure rule matches Gift AIF Backtester",
          "Final path end = Simulation End TD",
          "max_end clamp prevents overshoot past horizon",
        ],
        steps: [
          "_build_one(start, tenure, max_end=horizon).",
          "After atlas build, snap paths[-1] dates through horizon.",
          "Attach GBM spots along path.dates only.",
        ],
      },
      {
        id: "spots",
        label: "GBM Spots",
        kind: "lookup",
        description: "One GBM step per path trading day from live S₀.",
        detail:
          "S_t = S_{t-1} · exp(drift + σ · Z). simulate_path_spots → gbm_spots(..., path_id). Matrix = rows path 1..n (like Nifty Simulations.xlsx); same day index ⇒ different prices. Seed deterministic per path_id.",
        bullets: [
          "S₀ = as-of Nifty close; drift = μ − ½σ²",
          "Vertical path ids; independent Z per path",
          "No weekend steps in the spot vector",
        ],
        steps: [
          "estimate_gbm_params(historical market).",
          "For each PathSpec, gbm_spots(len(dates), path_id).",
          "hedge_path / run_nav consume path.spots.",
        ],
      },
      {
        id: "atlas",
        label: "Path Atlas",
        kind: "output",
        description: "List of PathSpec objects for hedge and NAV workers.",
        detail:
          "Each PathSpec carries path_id, start, end, dates[], and optional spots[]. Observation feasibility (last obs month × 30.5 ≤ last known expiry) still gates the frontier.",
        bullets: [
          "Path count = f(frequency, horizon, tenure, obs months)",
          "path_from_window rebuilds one path for detail views",
          "Hedge/NAV engines identical to Backtester",
        ],
        steps: [
          "Return (paths, forward_market, gbm_params, simulation_end).",
          "forwardtest.run_forwardtest evaluates each path.",
          "Intel · Path Market reads that path's nifty / rolls / expiries.",
        ],
      },
    ],
    defaults: [
      { label: "Simulation End Days", value: "3650" },
      { label: "Path 1", value: "As-Of → Tenure End" },
      { label: "Sessions", value: "Mon–Fri · No Weekends" },
    ],
    insights: [
      "build_paths is the single forward path factory — no CSV Macro Path pins.",
      "As-of is always market.last_date (dynamic present after sync).",
      "Simulation End Days from Product Input drives the horizon and final path end.",
      "Forward calendars: last Tuesday expiry, month-end futures shift, leap/30/31 aware.",
      "GBM spots attach on trading days only; hedge.py and nav.py stay Backtester-parity.",
      "path_from_window rebuilds one path from cached summary start/end for path-detail views.",
    ],
    noteCards: [
      {
        title: "build_paths orchestration",
        body: "engine/paths.py::build_paths builds the forward market pad, chooses starts by frequency between as-of and s_last, evaluates tenure windows, then snaps the final path onto Simulation End.",
        bullets: [
          "Frequency: monthly | weekly | daily | quarterly | semi_annual",
          "tenure_days + simulation_end_days from ProductSpec",
          "observation_months gates the dynamic frontier",
        ],
      },
      {
        title: "Forward calendar module",
        body: "engine/forward_calendar.py owns Mon–Fri sessions, last-Tuesday expiries, and month-end rolls after as-of. Historical CSV calendars are unchanged through as-of.",
        code: "extend_market_forward(market, horizon_end, gbm_params=...)",
      },
      {
        title: "Tenure vs Simulation End",
        body: "Intermediate paths use the Backtester anniversary tenure end. The final path is forced to the last trading day on/before asof + Simulation End Days.",
        bullets: [
          "Default Simulation End Days = 3650",
          "Must be greater than tenure_days",
        ],
      },
      {
        title: "Weekends closed",
        body: "Forward Nifty prices, path spines, and Intel sheets never include Saturday or Sunday. Month lengths use real calendar arithmetic (Feb 28/29, 30/31-day months).",
      },
      {
        title: "PathSpec contract",
        body: "Every downstream stage receives PathSpec with a contiguous Mon–Fri date list and GBM spots aligned by index.",
        code: "PathSpec(path_id, start, end, dates, spots)",
      },
    ],
    outputs: ["Forward Path Atlas", "GBM Spot Paths", "Simulation End Horizon"],
  },
  {
    id: "roll-market",
    title: "Roll Cost And Market",
    subtitle: "Nifty Series · Futures Shifts · Seven Percent Roll",
    excelSheet: "Roll Cost + Paths",
    engineFile: "engine/market.py",
    accent: "teal",
    purpose:
      "MarketDB loads historical Nifty through as-of for μ/σ estimation and calendar seeds. Forward calendars (Mon–Fri, month-end rolls, last-Tuesday expiries) are shared date rules only. Each GBM path owns its simulated Nifty and its roll points — there is no shared forward price workbook.",
    stageCount: 5,
    metrics: [
      { label: "Roll Rate", value: "7%" },
      { label: "Forward Shift", value: "Month-End TD" },
      { label: "Forward Expiry", value: "Last Tuesday" },
    ],
    nodes: [
      {
        id: "nifty",
        label: "Daily Nifty Close",
        kind: "input",
        description: "Historical CSV through as-of for GBM estimation; each path then carries its own lognormal simulated closes.",
        detail:
          "load_market builds historical dates/closes through present (as-of). estimate_gbm_params reads μ and σ from that history. Path evaluation uses gbm_spots(S0, μ, σ, path_id) on Mon–Fri sessions — Intel · Path Market shows that path's series, not a Path-1 shared DB.",
        bullets: [
          "As-of = latest Nifty session after /api/sync",
          "Forward sessions: Mon–Fri only (calendar pad)",
          "Simulated prices = per-path GBM lognormals",
        ],
        steps: [
          "Read nifty_daily.csv into MarketDB through present.",
          "estimate_gbm_params → S0, μ, σ, drift = μ − ½σ².",
          "Each path: S_t = S_{t-1} · exp(drift + σ·Z); same day ⇒ different prices by path (Excel matrix rows).",
        ],
      },
      {
        id: "shifts",
        label: "Futures Shift Dates",
        kind: "lookup",
        description: "Historical shifts from CSV; forward shifts = last trading day of each complete month.",
        detail:
          "Through as-of, roll_shifts follow the historical builder / CSV. After as-of, forward_calendar emits the last Mon–Fri on/before each real month-end (only complete months). Roll *points* are not stored as a shared workbook — path_roll_vector recomputes them from each path's spots.",
        bullets: [
          "Forward: last trading day of month (not last Tuesday)",
          "Incomplete pad months never invent a fake shift",
          "Shared calendar dates; path-local roll points",
        ],
        steps: [
          "Preserve historical roll_shifts ≤ as-of.",
          "_forward_month_rolls_and_expiries for months after as-of.",
          "path_roll_vector on path dates/spots before run_nav.",
        ],
      },
      {
        id: "avg",
        label: "Average Spot Span",
        kind: "process",
        description: "Average Nifty on trading days only — Sat/Sun never enter the average.",
        detail:
          "Spot average always uses the trading-day series (weekends and other non-sessions absent). First shift: mean of closes with date ≤ first shift (19 TDs in Jan-2001). Later shifts: mean of closes in (prev, shift].",
        bullets: [
          "Trading calendar only — no Saturday / Sunday closes",
          "First gap = 19 trading days → ≈ 4.7713 pts at 7%",
          "Forward pad uses the same rule on each path's Mon–Fri GBM closes",
        ],
        steps: [
          "Mask trading dates in the shift interval on this path.",
          "Mean simulated Nifty closes over that mask.",
          "Pass average spot into the 7% carry formula.",
        ],
      },
      {
        id: "roll",
        label: "Roll Cost Points",
        kind: "engine",
        description: "First month: 7% × avg × trading_days/365. Later: 7% × avg × calendar_Δt/365.",
        detail:
          "path_roll_vector → _recompute_roll_costs on this path's dates/spots. First shift day-count = trading days. Later day-count = calendar days between shifts. NAV scales by product roll_rate and zeros rolls after last observation.",
        bullets: [
          "First: avg × 7% × N_td / 365",
          "Later: avg × 7% × (shift − prev).days / 365",
          "Different paths ⇒ different roll points",
        ],
        steps: [
          "Seed month → trading-day count on/before first shift on path.",
          "Later months → calendar Δt between consecutive shifts.",
          "nav: −roll_pts × fut_cum / 1e7 while date ≤ last_observation.",
        ],
      },
      {
        id: "bus",
        label: "Market Database",
        kind: "output",
        description: "Shared MarketDB: spots, rolls, expiries, expiry_by_month — consumed by hedge and NAV.",
        detail:
          "Single MarketDB for calendars + hist estimation. expiry_by_month enables O(1) resolve_observation_expiry. Forward prices and roll points are per-path — not a shared Intel workbook.",
        bullets: [
          "Shared across all paths in a job",
          "expiry_by_month for hedging map",
          "Intel shows Nifty on each expiry",
        ],
        steps: [
          "load_market() at worker init.",
          "Pass market handle to build_paths, hedge_path, run_nav.",
          "/api/sync extends CSVs through latest session.",
        ],
      },
    ],
    defaults: [
      { label: "Assumed Rate", value: "7%" },
      { label: "Tax Benefit Factor", value: "42.744% Of Roll (nav.py)" },
      { label: "First Roll Gap", value: "19 Trading Days From 2001-01-01" },
    ],
    insights: [
      "load_market reads nifty_daily.csv, roll_costs.csv, and builds expiries via calendar_build.",
      "/api/sync and scripts/sync_market_data.py extend market data through the latest Nifty session.",
      "Roll points = 7% × average Nifty between shifts × calendar Δt/365; first interval uses 19 TD seed.",
      "rolls_for_dates(path_dates) returns a vector aligned to the path — zero on non-shift days.",
      "nav.run_nav zeros roll lookup when path date exceeds last_observation from hedge_path.",
      "expiry_by_month and first_expiry_on_or_after power hedge.resolve_observation_expiry.",
      "MarketDB is instantiated once per worker and shared across parallel path evaluations.",
    ],
    noteCards: [
      {
        title: "MarketDB load path",
        body: "engine/market.py::load_market assembles dates, closes, expiries, roll calendars, and lookup dicts from data/*.csv.",
        bullets: [
          "nifty_daily.csv — spot series",
          "roll_costs.csv — shift-date roll points",
          "calendar_build — monthly and all expiries",
        ],
      },
      {
        title: "Spot lookup helpers",
        body: "nifty_on floors to prior close; spots_for_dates uses contiguous slice optimisation when path dates align with market.dates indices.",
      },
      {
        title: "Roll cost construction",
        body: "Seven percent carry on index futures: average spot over the shift interval times calendar day fraction. Stored once at load, indexed by date.",
        code: "roll = 0.07 × avg_spot × Δt_calendar / 365",
      },
      {
        title: "Futures shift calendar",
        body: "Monthly-last option expiries double as futures shift dates. roll_shifts and roll_by_expiry stay in sync for Computation rollover rows.",
      },
      {
        title: "NAV roll application",
        body: "run_nav multiplies roll_on_day by cumulative futures position and scales to crores. Rolls stop after the last observation expiry.",
        bullets: [
          "roll_on_day from rolls_for_dates",
          "Masked when date > last_observation",
          "tax_ben = roll_cost × 0.42744",
        ],
      },
    ],
    outputs: ["Roll Cost Series", "Nifty Spot Series", "Market Meta"],
  },
  {
    id: "expiry",
    title: "Expiry Calendar",
    subtitle: "Monthly Nifty Option Expiries From 2001",
    excelSheet: "Expiry",
    engineFile: "engine/calendar_build.py",
    accent: "ink",
    purpose:
      "calendar_build produces monthly and full weekly expiries from 2001; hedge.resolve_observation_expiry maps observation targets onto monthly-last dates.",
    stageCount: 4,
    metrics: [
      { label: "Calendar Start", value: "2001" },
      { label: "Source", value: "Overrides And Shifts" },
      { label: "UI Extra", value: "Nifty On Expiry" },
    ],
    nodes: [
      {
        id: "overrides",
        label: "Expiry Overrides",
        kind: "input",
        description: "Optional data/expiry_overrides.csv supplies authoritative dates where present.",
        detail:
          "When expiry_overrides.csv lists a month, that date wins in build_monthly_expiries. Otherwise the resolver falls through to futures shift or weekday rule.",
        bullets: [
          "data/expiry_overrides.csv optional",
          "Month-level authoritative dates",
          "Loaded at market init",
        ],
        steps: [
          "Read expiry_overrides.csv if present.",
          "Merge override dates into monthly build.",
          "Write expiries.csv for Hedging Sheet consumption.",
        ],
      },
      {
        id: "priority",
        label: "Month Resolver",
        kind: "engine",
        description: "Override → futures shift → last Thursday (to Aug-2025) or last Tuesday (from Sep-2025).",
        detail:
          "last_monthly_expiry_on_or_before applies NSE schedule: pre-2019 monthly-only Thursdays; 2019–Aug-2025 weekly+monthly Thursdays; from Sep-2025 Tuesdays. Holiday dates floor to previous trading day.",
        bullets: [
          "TUESDAY_EXPIRY_ERA_START = 2025-09-01",
          "Holiday → previous trading day",
          "Weekly series from Feb-2019 for Intel",
        ],
        steps: [
          "Check override for (year, month).",
          "Else use futures shift date if in roll calendar.",
          "Else compute last weekday in month per era rule.",
          "Floor to trading_day_on_or_before.",
        ],
      },
      {
        id: "csv",
        label: "Expiry List",
        kind: "output",
        description: "Single-column monthly expiry list consumed by Hedging Sheet mapping.",
        detail:
          "build_monthly_expiries writes the monthly-last series from 2001. MarketDB.expiries and expiry_by_month dict power observation mapping in hedge.py.",
        bullets: [
          "Monthly-last for observation map",
          "Synced via scripts/sync_market_data.py",
          "From 2001 through latest Nifty date",
        ],
        steps: [
          "build_monthly_expiries(trading_set) → list[date].",
          "Populate expiry_by_month{(y,m): last_expiry}.",
          "Expose via load_market to hedge_path.",
        ],
      },
      {
        id: "intel",
        label: "Intel · Path Market",
        kind: "lookup",
        description: "Per-path simulated Nifty, monthly expiries, and roll points for the selected GBM path.",
        detail:
          "There is no shared forward price workbook. Intel · Path Market binds to PathSelect: Simulated Nifty = path.spots; Monthly Expiries = last-Tuesday calendar dates in the path window with path Nifty; Futures Rolls = path_roll_vector points on month-end shifts.",
        bullets: [
          "Requires a completed Run + selected path",
          "Calendar dates shared; prices/points path-local",
          "Observation expiries also appear on Hedging Sheet",
        ],
        steps: [
          "Load path detail (dates, nifty, rolls, monthly_expiries).",
          "Monthly expiries feed hedge.resolve_observation_expiry dates.",
          "Roll points already applied in Computation for that path.",
        ],
      },
    ],
    defaults: [
      { label: "Rebuild Script", value: "scripts/sync_market_data.py" },
      { label: "Observation Month Length", value: "30.5 Days" },
      { label: "Tuesday Era Start", value: "2025-09-01" },
    ],
    insights: [
      "calendar_build implements NSE expiry weekday rules with era breaks at Feb-2019 (weeklies) and Sep-2025 (Tuesday).",
      "build_monthly_expiries produces the monthly-last list used for observation mapping.",
      "hedge.resolve_observation_expiry: target month → expiry_by_month hit, else first_expiry_on_or_after.",
      "Observation targets use m × 30.5 calendar days from path start before expiry mapping.",
      "Forward futures shifts are month-end trading days; monthly option expiries are last Tuesdays — dates may differ.",
      "expiry_overrides.csv optional layer sits first in the resolver priority stack.",
      "Intel · Path Market shows one path's simulated market sheet — not a shared Path-1 database.",
    ],
    noteCards: [
      {
        title: "Resolver priority stack",
        body: "Monthly expiry for a calendar month resolves in order: CSV override, futures shift date, then computed last weekday per NSE era.",
        bullets: [
          "Override wins when present",
          "Shift date from roll calendar",
          "Thu era → Tue era at Sep-2025",
        ],
      },
      {
        title: "NSE era breakpoints",
        body: "Pre-2019: monthly-only last Thursday. Feb-2019+: weeklies on Thursday. Sep-2025+: weekly and monthly on Tuesday.",
      },
      {
        title: "Hedging Sheet mapping",
        body: "resolve_observation_expiry takes target = start + m×30.5 and returns the monthly expiry for that calendar month, or the first expiry on/after target.",
        code: "exp = market.expiry_by_month[(target.year, target.month)] ?? first_expiry_on_or_after(target)",
      },
      {
        title: "Two expiry lists",
        body: "MarketDB.expiries is monthly-last for hedge. Forward weeklies are not a shared price DB — Intel · Path Market shows monthly expiries with that path's simulated Nifty.",
      },
      {
        title: "Rebuild and sync",
        body: "scripts/sync_market_data.py rebuilds calendars when Nifty history extends. /api/sync triggers the same extension path for live desk sessions.",
      },
    ],
    outputs: ["Monthly Expiry List", "Nifty On Expiry", "Observation Targets"],
  },
  {
    id: "hedging",
    title: "Hedging Sheet",
    subtitle: "Observations · Options Book · Required Futures Delta",
    excelSheet: "As per HS",
    engineFile: "engine/hedge.py",
    accent: "gold",
    purpose:
      "hedge_path maps observation months to expiries, build_legs expands the product book, compute_req_delta sums Black–Scholes central deltas — output feeds nav.py futures inventory.",
    stageCount: 7,
    metrics: [
      { label: "Forward", value: "6.6%" },
      { label: "Discount", value: "7.6%" },
      { label: "Delta Bump", value: "±0.5" },
    ],
    nodes: [
      {
        id: "path",
        label: "Path Context",
        kind: "input",
        description: "Path start date and Spot₀ — first Nifty close on the path — anchor all strikes and observations.",
        detail:
          "hedge_path(market, product, path_dates) sets start = path_dates[0], spot0 = spots[0], and passes both to build_legs. Path context is per-path; rates and vols come from ProductSpec legs (path-invariant).",
        bullets: [
          "Spot₀ = float(spots[0])",
          "Same ProductSpec on every path",
          "PathHedge bundles full hedge state",
        ],
        steps: [
          "Load spots via market.spots_for_dates(path_dates).",
          "Record spot0 = spots[0] for strike scaling.",
          "Initialize PathHedge container for downstream nav.",
        ],
      },
      {
        id: "targets",
        label: "Observation Targets",
        kind: "process",
        description: "Each observation month m becomes target = start + m × 30.5 calendar days.",
        detail:
          "build_observation_details iterates product.observation_months, computing offset_days = m × 30.5, target_date, and Nifty on target via market.nifty_on.",
        bullets: [
          "Seven targets in sample (months 38…56)",
          "30.5-day month convention",
          "obs_builds carries month, target, expiry, nifty",
        ],
        steps: [
          "For each m in observation_months: offset = m × 30.5.",
          "target = start + timedelta(days=offset).",
          "Store ObservationBuild with target_date and offset_days.",
        ],
      },
      {
        id: "map-exp",
        label: "Map To Monthly Expiry",
        kind: "lookup",
        description: "resolve_observation_expiry snaps each target onto the monthly Nifty option expiry.",
        detail:
          "Lookup expiry_by_month[(target.year, target.month)]; if missing, market.first_expiry_on_or_after(target). Observations list = mapped expiries in file order.",
        bullets: [
          "Monthly-last expiry per target month",
          "VLOOKUP+1 style fallback",
          "observations[] feeds build_legs",
        ],
        steps: [
          "Call resolve_observation_expiry(market, target) per month.",
          "Append expiry to observations list.",
          "Record obs_spots = nifty on each expiry date.",
        ],
      },
      {
        id: "book",
        label: "Build Option Legs",
        kind: "engine",
        description: "build_legs crosses product.active_legs with each observation expiry — full options book.",
        detail:
          "For each active OptionLegSpec: strike = spot0 × strike_pct / 100; contract qty = raw_qty × principal / spot0 / n_obs; nested loop over observation expiries creates one BuiltLeg per (spec, expiry) pair.",
        bullets: [
          "active_legs only — skips Include=No",
          "Six sample puts × 7 obs = 42 built legs",
          "Put/call from spec.option_type",
          "Forward and Discount per leg from ProductSpec",
        ],
        steps: [
          "n_obs = max(len(observations), 1).",
          "For spec in product.active_legs:",
          "  strike = spot0 * spec.strike_pct / 100",
          "  qty = spec.quantity * product.principal / spot0 / n_obs  (contract sizing)",
          "  For obs_i, exp in enumerate(observations):",
          "    vol = spec.vol_for_observation(obs_i) or vol_for_strike_pct",
          "    append BuiltLeg(..., expiry=exp, quantity=qty, vol=vol)",
        ],
      },
      {
        id: "vol",
        label: "Moneyness Volatility",
        kind: "lookup",
        description: "Vol Near on obs index 0; Vol Far on later indices; moneyness fallback when vol ≤ 0.",
        detail:
          "OptionLegSpec.vol_for_observation(0) returns vol_near when set; otherwise spec.vol. build_legs calls vol_for_strike_pct(strike_pct) from black_scholes when parsed vol is non-positive.",
        bullets: [
          "Per-leg Near/Far from Product Input",
          "vol_for_strike_pct moneyness table",
          "Same vols on every path (path-invariant)",
        ],
        steps: [
          "obs_i == 0 → vol_near if present else vol.",
          "obs_i > 0 → vol (far).",
          "If vol <= 0: vol = vol_for_strike_pct(strike_pct).",
        ],
      },
      {
        id: "delta",
        label: "Option Delta",
        kind: "engine",
        description: "central_delta_book: Black–Scholes bump ±0.5 × contract qty, summed by expiry group.",
        detail:
          "compute_req_delta groups BuiltLegs by expiry, builds tau = (expiry − asof) / 365, and calls central_delta_book(spots, tau, strikes, vols, qtys, forward_rate, discount_rate, is_put). Bump is ±0.5 index points — no divide by 2×bump.",
        bullets: [
          "Group legs by expiry for vectorised tau",
          "±0.5 central difference on spot",
          "Forward/discount per leg group",
          "Puts: is_put=True in BS pricer",
        ],
        steps: [
          "Group legs into by_exp dict.",
          "For each expiry group, compute tau array over path_dates.",
          "Stack strikes, vols, qtys as numpy arrays.",
          "total += central_delta_book(S±0.5, τ, K, σ, qty); return total as req_delta.",
        ],
      },
      {
        id: "req",
        label: "Net Required Delta",
        kind: "output",
        description: "Daily req_delta array — Computation col D futures inventory opening balance.",
        detail:
          "PathHedge.req_delta is a float ndarray aligned to path_dates. nav.run_nav reads it as required delta; change[0]=delta[0], change[1:]=diff(delta). last_observation = max(observation expiries).",
        bullets: [
          "One value per path trading day",
          "Feeds nav.py fut_qty = change in delta",
          "last_observation gates roll in nav",
        ],
        steps: [
          "compute_req_delta returns np.ndarray length = len(path_dates).",
          "Store on PathHedge with legs and obs_builds.",
          "Pass to run_nav(..., req_delta, last_observation=...).",
        ],
      },
    ],
    defaults: [
      { label: "Option Type", value: "Put Option" },
      { label: "Forward And Discount", value: "6.6% / 7.6%" },
      { label: "Contract Qty Formula", value: "raw × principal / Spot₀ / n_obs" },
    ],
    insights: [
      "hedge_path orchestrates: spot0 → build_observation_details → build_legs → compute_req_delta.",
      "Observation target = path_start + m × 30.5 days; then resolve_observation_expiry maps to monthly expiry.",
      "build_legs: strike = Spot₀ × Strike% / 100; contract qty = raw × principal / Spot₀ / n_obs; expand × n_obs expiries.",
      "Only product.active_legs enter the book — Include=No and display-only rows are excluded.",
      "Vol Near applies on observation index 0; Vol Far on indices 1…N−1 via vol_for_observation.",
      "compute_req_delta sums central_delta_book across expiry groups; bump ±0.5 with no /(2×bump) divisor.",
      "PathHedge.last_observation caps roll charges in nav.run_nav after the final observation expiry.",
    ],
    noteCards: [
      {
        title: "hedge_path entry point",
        body: "Single call per path in forward-test worker: hedge_path(market, product, path_dates) → PathHedge with req_delta ndarray.",
        bullets: [
          "Called from compute_single_path_detail",
          "Same product, different spot0 per path",
          "Returns legs for path-detail UI",
        ],
      },
      {
        title: "Observation schedule",
        body: "build_observations and build_observation_details convert Product Input month offsets into calendar targets and monthly expiries.",
        code: "target = start + timedelta(days=m * 30.5)",
      },
      {
        title: "Options book expansion",
        body: "Product Input stores each strike once. build_legs emits one BuiltLeg per (active_leg, observation_expiry) — sample six puts become 42 rows.",
        bullets: [
          "strike = Spot₀ × Strike% / 100",
          "qty = raw × principal / Spot₀ / n_obs",
          "Forward/Discount from each leg spec",
        ],
      },
      {
        title: "Vol assignment",
        body: "vol_for_observation selects Near vs Far by obs index. Non-positive parsed vols fall back to vol_for_strike_pct moneyness defaults in black_scholes.py.",
      },
      {
        title: "Central delta bump",
        body: "central_delta_book prices puts/calls with forward/discount rates from the leg group, applies ±0.5 spot bump, multiplies by contract quantities.",
        code: "req_delta[t] = Σ Δ_BS(S[t]±0.5, K, τ, σ) × qty",
      },
      {
        title: "Expiry grouping optimisation",
        body: "compute_req_delta groups BuiltLegs by expiry so tau = (exp − asof)/365 is computed once per group across all path dates.",
      },
      {
        title: "PathHedge outputs",
        body: "Downstream nav.py consumes req_delta, last_observation, and obs_builds. Hedging Sheet UI renders legs and observation map from the same structure.",
        bullets: [
          "req_delta → futures inventory",
          "last_observation → roll cutoff",
          "obs_builds → observation table",
        ],
      },
    ],
    outputs: ["Observation Schedule", "Options Book", "Daily Required Delta"],
  },
  {
    id: "computation",
    title: "Computation",
    subtitle: "Futures MTM · Cash · G-Sec · Fees · NAV · IRR",
    excelSheet: "Computation",
    engineFile: "engine/nav.py",
    accent: "rose",
    purpose:
      "run_nav executes the daily ledger: seed Cash = principal × cash_pct and Gsec = principal × gsec_pct from Product Input, mark futures from req_delta, apply rolls/fees/tx, and compute terminal Total and IRR.",
    stageCount: 8,
    metrics: [
      { label: "Cash Buffer", value: "principal × cash_pct" },
      { label: "G-Sec Day Zero", value: "principal × gsec_pct" },
      { label: "Fee Rate", value: "Product Input fee_rate" },
    ],
    nodes: [
      {
        id: "delta-inv",
        label: "Futures Inventory",
        kind: "input",
        description: "Required delta from hedge_path drives change, traded quantity, and cumulative futures position.",
        detail:
          "delta = req_delta array; change[0]=delta[0]; change[1:]=delta[1:]-delta[:-1]; fut_qty=change; fut_cum=cumsum(fut_qty). This is Computation column D/E logic.",
        bullets: [
          "Opens the daily ledger",
          "Traded qty = day-over-day delta change",
          "Cumulative position marks MTM",
        ],
        steps: [
          "Accept req_delta ndarray aligned to path_dates.",
          "Compute change as first difference of delta.",
          "fut_cum = np.cumsum(change) for MTM and roll.",
        ],
      },
      {
        id: "mtm",
        label: "Futures Mark To Market",
        kind: "engine",
        description: "Daily MTM on prior cumulative futures position times Nifty move, scaled to crores.",
        detail:
          "mtm[1:] = fut_cum[:-1] × (spots[1:] − spots[:-1]) / 1e7. Day 0 MTM is zero. MTM accumulates into cash buffer via cumsum in the cash series.",
        bullets: [
          "Prior cum position × ΔNifty / 1e7",
          "Includes roll days",
          "Sum feeds Result MTM block",
        ],
        steps: [
          "Shift fut_cum by one day for marking.",
          "mtm[t] = fut_cum[t−1] × (S[t] − S[t−1]) / 1e7.",
          "Add to cash cumulative path.",
        ],
      },
      {
        id: "roll-nav",
        label: "Rollover Cost",
        kind: "process",
        description: "Roll cost on futures shift dates while date ≤ last_observation; tax benefit tracked separately.",
        detail:
          "roll_cost = −roll_on_day × fut_cum / 1e7. When last_observation set, roll_on_day zeroed for dates after. tax_ben = roll_cost × 0.42744 — stored in result, excluded from Total.",
        bullets: [
          "7% roll convention from market.py",
          "Stops after last observation expiry",
          "Tax benefit 42.744% · not in Total",
        ],
        steps: [
          "rolls_for_dates(path_dates) → roll_on_day vector.",
          "Mask rolls where date > last_observation.",
          "Apply −roll × fut_cum / 1e7 to cash path.",
        ],
      },
      {
        id: "cash",
        label: "Cash And Interest",
        kind: "engine",
        description: "Cash buffer = principal × cash_pct at day zero absorbs MTM and roll; earns cash_rate on prior balance.",
        detail:
          "cash_buffer_cr = principal_cr × cash_pct from Product Input. cash[0]=cash_buffer_cr; cash[1:]=buffer + cumsum(mtm[1:]+roll_cost[1:]). int_cash[1:]=cash[:-1]×cash_rate×day_gaps/365. cash_plus_int = buffer + sum(int_cash).",
        bullets: [
          "cash_rate from Product Input (sample 6%)",
          "Absorbs MTM and rollover hits",
          "Day gaps from path date diffs",
        ],
        steps: [
          "Seed cash[0] = principal_cr × cash_pct.",
          "Accumulate MTM and roll into cash series.",
          "Accrue interest on lagged cash balance.",
        ],
      },
      {
        id: "gsec",
        label: "G-Sec Compounding",
        kind: "engine",
        description: "Bond sleeve = principal × gsec_pct at day zero compounds at Product Input G-Sec rate.",
        detail:
          "Opening Gsec = principal_cr − cash_buffer_cr (gsec_pct of principal). growth[1:]=1 + gsec_rate×day_gaps/365; gsec = opening × cumprod(growth). int_gsec from day-over-day increase.",
        bullets: [
          "gsec_rate from Product Input (sample 6%)",
          "Day-zero sleeve = principal × gsec_pct",
          "Compound on calendar day gaps",
        ],
        steps: [
          "Set opening gsec = principal − cash buffer.",
          "Apply daily growth factor from gsec_rate.",
          "Track int_gsec for Result block.",
        ],
      },
      {
        id: "tx",
        label: "Transaction Costs",
        kind: "process",
        description: "Buy and sell brokerage on futures turnover every trading day.",
        detail:
          "notional = |fut_qty| × spot / 1e7. Product Input Buy Brokerage / Sell Brokerage apply on positive/negative fut_qty days (including day 0). NAV subtracts today's tx and prior day's tx each step (Computation convention).",
        bullets: [
          "buy_brokerage / sell_brokerage from Product Input",
          "Same brokerage card every day — no rate switch",
          "Turnover on |fut_qty| × Nifty",
        ],
        steps: [
          "Compute notional from traded qty and spot.",
          "Apply buy/sell masks to fut_qty sign.",
          "tx_prev lag: subtract prior day costs in NAV step.",
        ],
      },
      {
        id: "fees",
        label: "Management Fees",
        kind: "process",
        description: "Accrues Product Input fee_rate management fee on principal across path tenure.",
        detail:
          "fees[1:] = principal_cr × fee_rate × day_gaps[1:] / 365. Fees subtract from daily NAV increment and sum into terminal Result.",
        bullets: [
          "fee_rate from Product Input (sample 1.5%)",
          "Calendar day_gap accrual",
          "Subtracted in nav_incr",
        ],
        steps: [
          "fee_rate from ProductSpec / Product Input.",
          "Multiply principal_cr by rate and day fraction.",
          "Accumulate sum_fees for Result.",
        ],
      },
      {
        id: "result",
        label: "Result And IRR",
        kind: "output",
        description: "Terminal components and annualised IRR from Total vs principal over tenure.",
        detail:
          "Total = principal_cr + sum_mtm + cash_plus_int + gsec_interest − sum_tx − sum_fees. IRR = (total/principal_cr)^(365/tenure_used) − 1. store_series=True emits computation_rows for path detail UI.",
        bullets: [
          "Invt + MTM + CashInt + Gsec + Tx + Fees",
          "Tax benefit stored, not added to Total",
          "computation_rows for path detail export",
        ],
        steps: [
          "Aggregate component sums across path.",
          "Compute tenure_used = end − start days.",
          "IRR = (Total/principal_cr)^(365/tenure_used) − 1; return NavResult with optional daily series.",
        ],
      },
    ],
    defaults: [
      { label: "Cash Buffer At Day Zero", value: "principal × cash_pct" },
      { label: "Government Securities At Day Zero", value: "principal × gsec_pct" },
      { label: "Cash Interest Rate", value: "6%" },
      { label: "G-Sec Interest Rate", value: "6%" },
      { label: "Management Fee Rate", value: "1.5% Of Principal" },
      { label: "Tax Benefit On Roll", value: "42.744% · Not In Total" },
    ],
    insights: [
      "run_nav opens Cash = principal × cash_pct and Gsec = principal × gsec_pct on day 0.",
      "Futures inventory: change = diff(req_delta); fut_cum drives MTM and roll scaling.",
      "MTM = prior cum futures × ΔNifty / 1e7; rolls apply on shift dates while date ≤ last_observation.",
      "Cash absorbs MTM + roll and earns cash_rate; Gsec compounds at gsec_rate on the gsec_pct opening sleeve.",
      "Transaction costs use Product Input buy_brokerage/sell_brokerage on |fut_qty|×spot every day; NAV subtracts tx and lagged tx_prev.",
      "Total = Invt + MTM + CashInt + Gsec + Tx + Fees; tax benefit on roll is stored, not added to Total.",
      "IRR annualises terminal Total against principal over calendar tenure days.",
    ],
    noteCards: [
      {
        title: "run_nav entry point",
        body: "Called per path after hedge_path with req_delta, principal_cr, rate assumptions, and last_observation cutoff.",
        bullets: [
          "store_series=True for path detail tables",
          "Returns NavResult dataclass",
          "Feeds PathSummary row in forward test",
        ],
      },
      {
        title: "Day-zero seeds",
        body: "Cash = principal × cash_pct and Gsec = principal × gsec_pct initialise the ledger before the first MTM tick.",
        code: "cash[0]=principal_cr*cash_pct; gsec[0]=principal_cr*gsec_pct",
      },
      {
        title: "Futures MTM loop",
        body: "Mark-to-market uses yesterday's cumulative futures position against today's Nifty move, converted to crores.",
        code: "mtm[t] = fut_cum[t-1] × (S[t]-S[t-1]) / 1e7",
      },
      {
        title: "Roll and tax benefit",
        body: "Roll cost charges on futures shift dates proportional to cum position. Tax benefit = 42.744% × roll — displayed but excluded from Total composition.",
      },
      {
        title: "Cash and Gsec carry",
        body: "Cash earns 6% on the lagged balance after MTM/roll hits. Gsec compounds daily via growth factors on calendar gaps between path dates.",
      },
      {
        title: "Transaction costs",
        body: "Buy and sell legs use Product Input brokerage on traded futures notional every day. Computation subtracts same-day and prior-day tx in the NAV step.",
      },
      {
        title: "Terminal Result block",
        body: "Total sums investment, MTM+roll, cash interest plus buffer, Gsec interest, minus transaction costs and fees. IRR exponent uses 365/tenure_used.",
        code: "Total = Invt + ΣMTM+roll + CashInt + Gsec + Tx + Fees",
      },
    ],
    outputs: ["Result Block", "Daily NAV Ledger", "Cost Splits", "IRR"],
  },
  {
    id: "summary",
    title: "Summary And Analytics",
    subtitle: "Path Results · Yearly Labs · Since Filter",
    excelSheet: "Summary",
    engineFile: "engine/forwardtest.py",
    accent: "maroon",
    purpose:
      "forwardtest.py evaluates paths in parallel — hedge_path + run_nav per path — stores job summary, yearly KPIs, and powers the Since-year filter without re-running the engine.",
    stageCount: 5,
    metrics: [
      { label: "Paths", value: "≥235" },
      { label: "KPIs", value: "Mean · Median · IRR" },
      { label: "Filter", value: "Since Year" },
    ],
    nodes: [
      {
        id: "run",
        label: "Parallel Path Run",
        kind: "engine",
        description: "ProcessPoolExecutor workers evaluate paths; each runs hedge_path then run_nav.",
        detail:
          "compute_single_path_detail loads _WORKER_PRODUCT and _WORKER_MARKET, calls hedge_path → run_nav, writes PathSummary. New Run cancels prior job via ForwardTestCancelled.",
        bullets: [
          "Parallelism from forwardtest_parallelism()",
          "Cancel-safe on new runs",
          "Progress callback to UI",
        ],
        steps: [
          "build_paths → list[PathSpec].",
          "Spawn workers with product + market init.",
          "For each path: hedge_path → run_nav → PathSummary.",
          "Aggregate summaries into job JSON.",
        ],
      },
      {
        id: "row",
        label: "Path Summary Row",
        kind: "process",
        description: "One result block per path: Invt, MTM, Cash, Gsec, Tx, Fees, Total, IRR, Nifty levels.",
        detail:
          "PathSummary dataclass captures terminal components, irr, start/end Nifty, avg_obs_nifty, abs_nifty_ret, year (= start year), n_trading_days, and cost splits.",
        bullets: [
          "Powers Analytics Lab tables",
          "One row per path_id",
          "Buy/sell cost splits optional fields",
        ],
        steps: [
          "Map NavResult fields to PathSummary.",
          "Attach path start/end ISO strings.",
          "Append to job summary list.",
        ],
      },
      {
        id: "year",
        label: "Yearly Rollup",
        kind: "engine",
        description: "Groups path summaries by start year for mean, median, hit-rate, and extremes.",
        detail:
          "Yearly Lab aggregates PathSummary rows by year field. Computes mean/median IRR, hit rates, and tail stats for Analytics charts — filtered by Since-year before aggregation.",
        bullets: [
          "Bucket by path start year",
          "Mean vs median IRR charts",
          "Hit-rate and extremes",
        ],
        steps: [
          "Filter summaries where year >= since_year.",
          "Group by PathSummary.year.",
          "Compute KPI aggregates per year bucket.",
        ],
      },
      {
        id: "since",
        label: "Since Year Filter",
        kind: "process",
        description: "Trims which path rows feed Home KPIs and Analytics — no engine re-run.",
        detail:
          "Default since_year=2001. Frontend filter applies client-side or via API query on cached job summary. Path picker and yearly charts respect the same cutoff.",
        bullets: [
          "Default · 2001",
          "Client-side on cached job",
          "Does not trigger new forward test",
        ],
        steps: [
          "User selects Since year in Analytics.",
          "Filter PathSummary list by start year.",
          "Recompute displayed KPIs from subset.",
        ],
      },
      {
        id: "lab",
        label: "Analytics Surfaces",
        kind: "output",
        description: "Home summary, Yearly Lab, Path Summary table, single-path detail, and delta charts.",
        detail:
          "Path detail loads cached computation_rows, req_delta series, and legs from job folder on demand. Home KPIs read latest completed job summary.",
        bullets: [
          "Yearly Lab · Path Summary · Charts",
          "Path detail cache per job folder",
          "Desk · Analytics navigation",
        ],
        steps: [
          "Job completes → summary JSON persisted.",
          "Analytics pages read job store.",
          "Path picker fetches single-path detail endpoint.",
        ],
      },
    ],
    defaults: [
      { label: "Default Since", value: "2001" },
      { label: "Path Detail Cache", value: "Per Path Under The Job Folder" },
      { label: "Worker Init", value: "_WORKER_PRODUCT + _WORKER_MARKET" },
    ],
    insights: [
      "run_forwardtest orchestrates build_paths → parallel compute_single_path_detail for each PathSpec.",
      "Each worker path: hedge_path(market, product, dates) → run_nav(..., req_delta, last_observation).",
      "PathSummary row stores Invt, MTM, Cash+Int, Gsec, Tx, Fees, Total, IRR, and Nifty start/end.",
      "Yearly rollup groups by path start year for mean, median, hit-rate, and extreme charts.",
      "Since-year filter trims which rows feed Home KPIs and Analytics without re-running the engine.",
      "Path detail cache stores computation_rows, daily delta, and legs under the job folder.",
      "Progress callbacks and cancel checks allow superseding a stale Run when product or params change.",
    ],
    noteCards: [
      {
        title: "Forward-test orchestration",
        body: "engine/forwardtest.py::run_forwardtest wires product, market, path atlas, parallel workers, and job persistence.",
        bullets: [
          "build_paths with product tenure + obs months",
          "ProcessPoolExecutor or ThreadPoolExecutor",
          "Job folder stores summary + path details",
        ],
      },
      {
        title: "Single path pipeline",
        body: "compute_single_path_detail executes hedge_path then run_nav for one PathSpec and returns PathSummary plus optional detail payload.",
      },
      {
        title: "PathSummary schema",
        body: "Terminal components mirror nav NavResult: invt, mtm_futures, cash_plus_int, gsec, transaction_cost, fees, total, irr, plus Nifty context fields.",
      },
      {
        title: "Yearly Lab aggregation",
        body: "Charts bucket PathSummary rows by start year. Mean and median IRR, hit rates, and tails computed on the filtered set.",
      },
      {
        title: "Since-year filter",
        body: "Frontend trims cached summary rows where path start year ≥ selected Since — instant KPI refresh without recomputing paths.",
      },
      {
        title: "Path detail on demand",
        body: "Single-path views load cached computation_rows, cost_rows, and delta series from the job folder rather than re-running hedge_path + run_nav.",
      },
    ],
    outputs: ["Job Summary", "Yearly Charts", "Path Summary Table"],
  },
];

export const computationPrimitives: ComputationPrimitive[] = [
  { name: "Thirty Point Five Day Month", category: "Calendar", role: "Observation target from path start" },
  { name: "Contract Quantity", category: "Sizing", role: "Scale raw put quantity to notional and spot" },
  { name: "Central Delta", category: "Greeks", role: "Black–Scholes bump delta for required futures" },
  { name: "Futures Mark To Market", category: "PnL", role: "Daily mark on cumulative futures" },
  { name: "Futures Roll (roll_rate)", category: "Carry", role: "Index points on shift dates" },
  { name: "Cash Carry (cash_rate)", category: "Carry", role: "Interest on cash buffer" },
  { name: "G-Sec Carry (gsec_rate)", category: "Carry", role: "Compound bond sleeve" },
  { name: "Fee Accrual", category: "Costs", role: "Management fee on principal" },
  { name: "Buy And Sell Brokerage", category: "Costs", role: "Futures transaction costs" },
  { name: "Terminal IRR", category: "Performance", role: "Annualise total over path tenure" },
];

export function getModule(id: string): LogicModule {
  return logicModules.find((m) => m.id === id) ?? logicModules[0];
}

type LiveProduct = {
  principal_cr: number;
  tenure_days: number;
  n_obs: number;
  observation_months: number[];
  simulation_end_days?: number | null;
  cash_pct?: number;
  gsec_pct?: number;
  cash_buffer_cr?: number;
  gsec_opening_cr?: number;
  cash_rate?: number;
  gsec_rate?: number;
  fee_rate?: number;
  buy_rate?: number;
  sell_rate?: number;
  buy_brokerage?: number;
  sell_brokerage?: number;
  roll_rate?: number;
  tax_benefit_rate?: number;
  cash_gst_rate?: number;
  rate_switch_date?: string;
  legs?: Array<{ forward_rate?: number; discount_rate?: number }>;
};

type LiveMarket = {
  first_date?: string;
  last_date?: string;
  asof?: string;
  simulation_end?: string;
  simulation_end_days?: number;
  n_paths_monthly?: number;
  n_trading_days?: number;
  trading_days?: number;
  expiries?: number;
};

function pct(v: number | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function cr(v: number | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)} Cr`;
}

function replaceMetric(
  metrics: Array<{ label: string; value: string }>,
  label: string,
  value: string,
): Array<{ label: string; value: string }> {
  return metrics.map((m) => (m.label === label ? { ...m, value } : m));
}

function replaceDefault(
  defaults: Array<{ label: string; value: string }>,
  label: string,
  value: string,
): Array<{ label: string; value: string }> {
  return defaults.map((d) => (d.label === label ? { ...d, value } : d));
}

/**
 * Overlay live ProductSpec / market meta onto Logic Atlas chips.
 * Procedure prose stays static; numeric metrics and defaults track the desk product.
 */
export function withLiveAtlasData(
  modules: LogicModule[],
  product: LiveProduct | null | undefined,
  market?: LiveMarket | null,
): LogicModule[] {
  if (!product && !market) return modules;

  const cashPct = product?.cash_pct ?? 0.05;
  const gsecPct = product?.gsec_pct ?? 1 - cashPct;
  const fwd =
    product?.legs?.find((lg) => lg.forward_rate != null)?.forward_rate ?? 0.066;
  const disc =
    product?.legs?.find((lg) => lg.discount_rate != null)?.discount_rate ?? 0.076;

  return modules.map((mod) => {
    let metrics = mod.metrics;
    let defaults = mod.defaults;

    if (product && mod.id === "product-input") {
      metrics = replaceMetric(metrics, "Principal", cr(product.principal_cr));
      metrics = replaceMetric(metrics, "Tenure", `${product.tenure_days} Days`);
      metrics = replaceMetric(metrics, "Observations", String(product.n_obs));
      defaults = replaceDefault(defaults, "Sample Principal", `₹${cr(product.principal_cr)}`);
      defaults = replaceDefault(defaults, "Sample Tenure", `${product.tenure_days} Calendar Days`);
      defaults = replaceDefault(
        defaults,
        "Sample Observations",
        product.observation_months.map((m) => String(m)).join(", "),
      );
      if (product.simulation_end_days != null) {
        defaults = replaceDefault(
          defaults,
          "Simulation End Days",
          String(product.simulation_end_days),
        );
      }
      defaults = [
        ...defaults.filter(
          (d) =>
            ![
              "Cash Buffer %",
              "G-Sec Sleeve %",
              "Day-Zero Cash",
              "Day-Zero G-Sec",
              "Buy Rate",
              "Sell Rate",
              "Buy Brokerage",
              "Sell Brokerage",
              "Rate Switch Date",
            ].includes(d.label),
        ),
        { label: "Cash Buffer %", value: pct(cashPct) },
        { label: "G-Sec Sleeve %", value: pct(gsecPct) },
        { label: "Buy Brokerage", value: pct(product.buy_brokerage, 6) },
        { label: "Sell Brokerage", value: pct(product.sell_brokerage, 6) },
      ];
    }

    if (product && mod.id === "computation") {
      metrics = replaceMetric(metrics, "Cash Buffer", `${pct(cashPct)} of principal`);
      metrics = replaceMetric(metrics, "G-Sec Day Zero", `${pct(gsecPct)} of principal`);
      metrics = replaceMetric(metrics, "Fee Rate", pct(product.fee_rate ?? 0.015));
      defaults = replaceDefault(defaults, "Cash Buffer At Day Zero", `principal × ${pct(cashPct)}`);
      defaults = replaceDefault(
        defaults,
        "Government Securities At Day Zero",
        `principal × ${pct(gsecPct)}`,
      );
      defaults = replaceDefault(defaults, "Cash Interest Rate", pct(product.cash_rate ?? 0.06));
      defaults = replaceDefault(defaults, "G-Sec Interest Rate", pct(product.gsec_rate ?? 0.06));
      defaults = replaceDefault(
        defaults,
        "Management Fee Rate",
        `${pct(product.fee_rate ?? 0.015)} Of Principal`,
      );
      defaults = replaceDefault(
        defaults,
        "Tax Benefit On Roll",
        `${pct(product.tax_benefit_rate ?? 0.42744)} · Not In Total`,
      );
    }

    if (product && mod.id === "hedging") {
      metrics = replaceMetric(metrics, "Forward", pct(fwd));
      metrics = replaceMetric(metrics, "Discount", pct(disc));
      defaults = replaceDefault(defaults, "Forward And Discount", `${pct(fwd)} / ${pct(disc)}`);
    }

    if (product && mod.id === "roll-market") {
      metrics = replaceMetric(metrics, "Roll Rate", pct(product.roll_rate ?? 0.07));
    }

    if (market && mod.id === "macro-paths") {
      if (market.last_date) {
        metrics = replaceMetric(metrics, "Path 1 Start", formatDeskDate(market.last_date));
      }
      if (market.simulation_end) {
        metrics = replaceMetric(metrics, "Final Path End", formatDeskDate(market.simulation_end));
      } else if (market.simulation_end_days != null && market.last_date) {
        const end = addCalendarDaysIso(market.last_date, market.simulation_end_days);
        if (end) metrics = replaceMetric(metrics, "Final Path End", formatDeskDate(end));
      }
      const simDays = product?.simulation_end_days ?? market.simulation_end_days;
      if (simDays != null) {
        metrics = replaceMetric(metrics, "Simulation End Days", String(simDays));
        defaults = replaceDefault(defaults, "Simulation End Days", String(simDays));
      }
      if (market.trading_days != null) {
        defaults = replaceDefault(defaults, "Horizon Trading Days", String(market.trading_days));
      }
    }

    if (market && mod.id === "summary") {
      if (market.n_paths_monthly != null) {
        metrics = replaceMetric(metrics, "Paths", String(market.n_paths_monthly));
      }
    }

    if (metrics === mod.metrics && defaults === mod.defaults) return mod;
    return { ...mod, metrics, defaults };
  });
}

