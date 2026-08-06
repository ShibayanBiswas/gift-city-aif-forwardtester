/**
 * Gift City AIF Logic Atlas — desk-facing stage map of the **codebase working procedure**.
 * Insights describe what `backend/app/engine/` does at each stage (not Excel audit / parity chatter).
 * Equation reference for developers: docs/09, docs/11. Verification tallies stay in docs only.
 */

import { formatDeskDate } from "@/lib/api";
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
      "The product workbook is read top to bottom for principal, tenure, observation months, and option legs. That book becomes the single input every later stage of the Run uses.",
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
        description:
          "Sample Input or an uploaded workbook becomes the live product for the desk. Both paths save as the current product file. Every Run reads that file again before paths are built. There is no second product source mid-job.",
        detail:
          "Upload stores the workbook for the desk. Sample Input loads the shipped workbook. The Run always uses whichever file is current.",
        bullets: [
          "Sample Input or Upload sets the live book",
          "One product file per desk session",
          "Run always re-reads the current workbook",
        ],
        steps: [
          "Desk selects Sample Input or uploads a product workbook.",
          "The app saves it as the current product file.",
          "On Run, the engine reads that file into the live product book.",
          "The same book feeds paths, hedging, and computation.",
        ],
      },
      {
        id: "principal",
        label: "Principal And Tenure",
        kind: "lookup",
        description:
          "Principal and Tenure Days rows set the fund size and how long each path lasts. Sample principal is one hundred crore rupees. Tenure drives path end dates, IRR, and fee accrual. Both rows are required before a Run can start.",
        detail:
          "The reader finds the Principal and Tenure labels in the sheet and takes the values beside them. Desk chips show principal in crores for easy reading.",
        bullets: [
          "Principal sets the fund notional",
          "Tenure sets path length in days",
          "Both rows are required",
        ],
        steps: [
          "Find the Principal label and read its value.",
          "Find the Tenure Days label and read its value.",
          "Convert principal to crores for desk display.",
          "Stop with a clear error if either row is missing.",
        ],
      },
      {
        id: "obs",
        label: "Observation Months",
        kind: "process",
        description:
          "Observation month offsets sit under the Observation header, in file order, with duplicates removed. The sample uses seven months: 38, 41, 44, 47, 50, 53, and 56. Each offset maps from path start onto a monthly Nifty option expiry. Products may use one to seven observations.",
        detail:
          "The count of observation months sizes the options book and limits how far monthly paths can extend while the last observation still lands on a known expiry.",
        bullets: [
          "Seven offsets in the sample book",
          "Order follows the workbook",
          "One to seven observations allowed",
        ],
        steps: [
          "Find the Observation header column.",
          "Collect month offsets from that column in sheet order.",
          "Drop duplicates while keeping the first of each value.",
          "Pass the list to hedging for every path.",
        ],
      },
      {
        id: "legs",
        label: "Options Book Rows",
        kind: "engine",
        description:
          "Each options-book row is one strike and quantity. Rows marked Include Yes enter the live book. The sample holds six put legs across the return levels in the sheet. On each path the engine expands every active strike across all observation expiries and scales contract size from principal and spot.",
        detail:
          "Column headers drive the map: Return Level, Strike percent, Option, Forward, Discount, Vol Near, Vol Far, Qty, and Include. Blank rate cells use the desk defaults of 6.6 percent forward and 7.6 percent discount.",
        bullets: [
          "Headers map the options columns",
          "Six sample puts in the shipped book",
          "Include No rows stay out of the live book",
        ],
        steps: [
          "Find the options header row with Qty.",
          "Map each column from its header name.",
          "Read every data row for strike, qty, vols, and include flag.",
          "Keep only included legs with non-zero quantity.",
          "Expand active legs across observation expiries on each path.",
        ],
        fields: [
          { label: "Return Level", value: "Return associated with the strike row" },
          { label: "Strike %", value: "Strike as percent of path-start spot" },
          { label: "Option", value: "Put by default; Call when the cell says Call" },
          { label: "Forward", value: "Forward rate for delta; default 6.6 percent if blank" },
          { label: "Discount", value: "Discount rate for delta; default 7.6 percent if blank" },
          { label: "Vol Near", value: "Volatility on the first observation" },
          { label: "Vol Far", value: "Volatility on later observations" },
          { label: "Qty", value: "Signed size; negative means sold" },
          { label: "Include", value: "Yes keeps the row in the live book" },
        ],
      },
      {
        id: "spec",
        label: "Product Spec",
        kind: "output",
        description:
          "The finished product book holds principal, tenure, observation months, active option legs, and fund economics. It is the single source of truth for a Run. Paths, hedging, computation, and desk exports all read the same book.",
        detail:
          "The Product tab shows this live book. After upload or Sample Input, every worker on the next Run uses the same snapshot.",
        bullets: [
          "Single desk source of truth per Run",
          "Shared by paths, hedging, and computation",
          "Shown live on the Product tab",
        ],
        steps: [
          "Assemble the product after principal, tenure, observations, and legs validate.",
          "Show it on the Product tab.",
          "Hand the same book to every path on Run.",
        ],
      },
    ],
    defaults: [
      { label: "Sample Principal", value: "₹100 Crore" },
      { label: "Sample Tenure", value: "1930 Calendar Days" },
      { label: "Sample Observations", value: "38, 41, 44, 47, 50, 53, 56" },
    ],
    insights: [
      "The product workbook is the only Run input for principal, tenure, observations, and option legs.",
      "Principal and Tenure come from labelled rows; observation months follow the Observation column in sheet order.",
      "Options rows are header-driven; blank forward and discount cells use 6.6 percent and 7.6 percent.",
      "Only Include Yes rows with non-zero quantity enter the live hedge book.",
      "The sample book has six puts across the shipped return levels.",
      "Vol Near applies on the first observation; Vol Far on later ones.",
      "Upload or Sample Input replaces the current product file for the next Run.",
    ],
    noteCards: [
      {
        title: "Entry points and file flow",
        body: "The Product tab and Run button both read the current product workbook. Upload saves a new file; Sample Input loads the shipped workbook.",
        bullets: [
          "Sample Input loads the shipped book",
          "Upload replaces the current product file",
          "Product tab shows the live parsed book",
        ],
      },
      {
        title: "Grid scan and sheet selection",
        body: "The reader opens the workbook and uses the first sheet that looks like a product input sheet. Label rows drive principal and tenure. The Observation column is found from its header text.",
        bullets: [
          "Principal and Tenure come from labelled rows",
          "Observation months follow sheet order",
          "One live book per desk session",
        ],
      },
      {
        title: "Rate and strike reading",
        body: "Strike is read as percent of path-start spot. Forward and discount rates accept common Excel percent styles. Blank rate cells use desk defaults.",
      },
      {
        title: "Options book column map",
        body: "Once the Qty header row is found, column names map the options book. Missing optional columns fall back to defaults without stopping the read.",
        bullets: [
          "Return Level and Qty are required on each leg row",
          "Forward and Discount default to 6.6 percent and 7.6 percent",
          "Include Yes keeps a row in the live book",
        ],
      },
      {
        title: "Sample six-put book shape",
        body: "The shipped sample stores each strike once. Six puts cover the return levels in the sheet. On each path those strikes expand across all observation expiries.",
        bullets: [
          "All sample legs are puts",
          "Vol Near on the first observation",
          "Vol Far on later observations",
        ],
      },
      {
        title: "Include gate",
        body: "Only rows marked Include Yes with non-zero quantity enter hedging and computation. Display-only rows stay out of the live book.",
      },
      {
        title: "Product book outputs",
        body: "Downstream stages read principal, tenure, observation months, and active legs from the same product book shown on the Product tab.",
        bullets: [
          "Paths use observation months and tenure",
          "Hedging uses the active options book",
          "Computation uses principal and fund economics",
        ],
      },
      {
        title: "Validation",
        body: "The reader stops with a clear error when Principal, Tenure, observation months, or any active leg is missing. The Product tab surfaces these before Run.",
        bullets: [
          "No observation months stops the Run",
          "No active legs stops the Run",
          "Noise rows outside the return band are skipped",
        ],
      },
    ],
    outputs: ["Product Spec", "Observation Month Offsets", "Options Book"],
  },
  {
    id: "macro-paths",
    title: "Forward Path Atlas",
    subtitle: "As Of Through Product End · N Monte Carlo Seeds",
    excelSheet: "Macro Paths",
    engineFile: "engine/paths.py · engine/gbm.py · engine/forward_calendar.py",
    accent: "maroon",
    purpose:
      "Every Monte Carlo path shares the same window: Start is As Of Today and End is Product End. Each path is a different random seed over that shared calendar. Spots land on Monday through Friday only.",
    stageCount: 5,
    metrics: [
      { label: "All Paths Start", value: "As Of Today" },
      { label: "All Paths End", value: "Product End" },
      { label: "Sessions", value: "Mon–Fri Only" },
    ],
    nodes: [
      {
        id: "starts",
        label: "Single Window",
        kind: "input",
        description:
          "All paths open on the latest Nifty session after market sync and close on Product End from tenure. There are no staggered start months. Path count defaults to one thousand; only the random seed changes from path to path.",
        detail:
          "As Of advances when the desk syncs market data. Cached Run results clear when that as-of date drifts. The same Start and End apply to every seed.",
        bullets: [
          "Start = As Of Today for every path",
          "End = Product End from tenure",
          "Default one thousand Monte Carlo paths",
          "Only the random seed differs per path",
        ],
        steps: [
          "Take the latest Nifty session as As Of.",
          "Compute Product End from As Of and tenure days.",
          "Clone that window once for each Monte Carlo seed.",
        ],
      },
      {
        id: "calendar",
        label: "Forward Calendar",
        kind: "engine",
        description:
          "Weekday sessions pad forward through the horizon. Futures shift dates match monthly option expiries. Holidays floor to the previous session. Incomplete pad months are skipped.",
        detail:
          "Holiday projection keeps only stable month–days from lookback plus fixed national dates — movable festivals are not copied by calendar day. Month lengths respect 28, 29, 30, and 31-day months. Market Calendar lists dates from as-of forward; a prior month may anchor day-count for the first roll but is not listed if it falls before as-of.",
        bullets: [
          "Saturday and Sunday always closed",
          "Futures shift = monthly option expiry",
          "Roll points recomputed per path from that path's spots",
          "Calendar shows dates from as-of forward",
        ],
        steps: [
          "Add weekday sessions from the day after as-of through Product End.",
          "Place monthly option expiries (and matching futures shifts) still ahead of as-of.",
          "Build each path's roll points from its own simulated spots on those shift dates.",
        ],
      },
      {
        id: "end-rule",
        label: "Tenure End",
        kind: "process",
        description:
          "Product End uses the same tenure anniversary rule as the Backtester. Every path ends on that shared date. Rolls and expiries clip to Product End.",
        detail:
          "For typical five-year tenures the end is roughly the last day of the month before the five-year anniversary. Custom tenure outside that band uses start plus tenure days. There is no separate simulation-end control.",
        bullets: [
          "Tenure rule matches Gift AIF Backtester",
          "Every path end = Product End",
          "Rolls and expiries clip to Product End",
        ],
        steps: [
          "Build one shared tenure template from as-of and tenure.",
          "Clone the template for each Monte Carlo seed.",
          "Attach simulated spots along the path trading days only.",
        ],
      },
      {
        id: "spots",
        label: "Simulated Spots",
        kind: "lookup",
        description:
          "Each path steps one simulated Nifty close per trading day from today's as-of spot. Drift and volatility come from historical market history. The same calendar day can show different prices across paths.",
        detail:
          "Starting level is the as-of Nifty close. Each step multiplies by a random shock with estimated drift and volatility. Weekend days never appear in the spot series. Seeds are fixed per path id so a re-run is reproducible.",
        bullets: [
          "Start spot = as-of Nifty close",
          "One step per Monday–Friday session",
          "Independent random seed per path",
        ],
        steps: [
          "Estimate drift and volatility from historical Nifty.",
          "For each path, simulate closes along the shared date list.",
          "Hand those spots to hedging and computation for that path.",
        ],
      },
      {
        id: "atlas",
        label: "Path Atlas",
        kind: "output",
        description:
          "The finished atlas is the list of paths for hedge and NAV workers. Every window is identical; only seeds and simulated prices differ.",
        detail:
          "Each path carries an id, start, end, trading dates, and optional simulated spots. Market Calendar shows the shared shift and expiry dates. Path Nifty and roll points appear on Hedging, Computation, and Simulated Nifty Paths.",
        bullets: [
          "Path count = Monte Carlo Paths (default 1000)",
          "Shared dates; path-local prices and rolls",
          "Detail views can rebuild one path from start and end",
        ],
        steps: [
          "Return the path list, forward market pad, GBM params, and Product End.",
          "The forward-test Run evaluates each path.",
          "Desk sheets read shared calendars and path-local levels.",
        ],
      },
    ],
    defaults: [
      { label: "Monte Carlo Paths", value: "1000" },
      { label: "Window", value: "As Of → Product End" },
      { label: "Sessions", value: "Mon–Fri · No Weekends" },
      { label: "Free Host Cap", value: "~2000 Paths" },
    ],
    insights: [
      "All paths share one window: As Of Today through Product End — no historical CSV path pins.",
      "As Of is always the latest Nifty session after market sync.",
      "Product End comes from tenure; there is no separate simulation-end control.",
      "Forward calendars use monthly option expiry as the futures shift date.",
      "Simulated spots attach on trading days only; hedging and NAV stay Backtester-parity.",
      "A single path can be rebuilt from cached start and end for detail views.",
    ],
    noteCards: [
      {
        title: "How paths are built",
        body: "The engine pads the market calendar through Product End, then clones one tenure window for each Monte Carlo seed. Date lists are shared. Frequency is ignored.",
        bullets: [
          "Default N = 1000 paths (clamp 1…10000; free hosts near 2000)",
          "Tenure days from the product book set Product End",
          "Observation months still gate hedge feasibility",
        ],
      },
      {
        title: "Forward calendar",
        body: "Monday–Friday sessions and monthly-last option expiries after as-of. Futures shifts use the same dates. Historical calendars through as-of stay unchanged.",
      },
      {
        title: "Single tenure window",
        body: "Every path uses the Backtester anniversary tenure end. There is no staggered start grid and no separate long simulation-end control.",
        bullets: [
          "Default one thousand Monte Carlo paths",
          "Start = as-of for all paths",
        ],
      },
      {
        title: "Weekends closed",
        body: "Forward Nifty prices, path spines, and Intel sheets never include Saturday or Sunday. Month lengths use real calendar arithmetic (Feb 28/29, 30/31-day months).",
      },
      {
        title: "What each path carries",
        body: "Every downstream stage receives a path with a contiguous Mon–Fri date list and simulated spots aligned by day index.",
      },
      {
        title: "Market Calendar display",
        body: "Intel · Market Calendar lists futures shift and monthly expiry dates from as-of forward. A prior month may anchor the first roll day-count but is omitted from the list when it falls before as-of.",
      },
    ],
    outputs: ["Forward Path Atlas", "Simulated Spot Paths", "Product End Horizon"],
  },
  {
    id: "roll-market",
    title: "Roll Cost And Market",
    subtitle: "Nifty Series · Futures Shifts · Seven Percent Roll",
    excelSheet: "Roll Cost + Paths",
    engineFile: "engine/market.py",
    accent: "teal",
    purpose:
      "Historical Nifty through as-of feeds drift and volatility. Forward calendars share Monday–Friday sessions and monthly option-expiry shift dates. Each path owns its simulated Nifty and its roll points — there is no shared forward price workbook.",
    stageCount: 5,
    metrics: [
      { label: "Roll Rate", value: "7%" },
      { label: "Forward Shift", value: "Monthly Option Expiry" },
      { label: "Forward Expiry", value: "Monthly Option Expiry" },
    ],
    nodes: [
      {
        id: "nifty",
        label: "Daily Nifty Close",
        kind: "input",
        description:
          "Historical closes through as-of size the Monte Carlo model. After that, each path carries its own simulated Monday–Friday closes. Desk sheets show those path prices on Hedging, Computation, and Simulated Nifty Paths.",
        detail:
          "Market sync pulls Nifty through the latest session. Drift and volatility come from that history. The same calendar day can print different simulated levels across paths.",
        bullets: [
          "As Of = latest Nifty session after sync",
          "Forward sessions: Monday–Friday only",
          "Simulated prices are per-path",
        ],
        steps: [
          "Load historical Nifty through present.",
          "Estimate starting spot, drift, and volatility.",
          "On each path, step simulated closes day by day.",
        ],
      },
      {
        id: "shifts",
        label: "Futures Shift Dates",
        kind: "lookup",
        description:
          "Historical and forward shift dates equal the monthly-last Nifty option expiry. Roll points are not a shared workbook — each path recomputes them from its own spots.",
        detail:
          "Through as-of, shifts follow the monthly expiry calendar. After as-of, the forward pad emits the same monthly-last option dates, floored to the previous session on holidays. Incomplete pad months never invent a fake shift.",
        bullets: [
          "Shift date = monthly option expiry",
          "Incomplete pad months skipped",
          "Shared calendar dates; path-local roll points",
        ],
        steps: [
          "Keep historical shifts on or before as-of.",
          "Add monthly option-expiry shifts still ahead of as-of.",
          "Recompute roll points on each path before NAV.",
        ],
      },
      {
        id: "avg",
        label: "Average Spot Span",
        kind: "process",
        description:
          "Average Nifty on trading days only sizes the roll. Saturday and Sunday never enter the average.",
        detail:
          "First shift: mean of closes with date on or before the first shift. Later shifts: mean of closes in the open interval after the prior shift through the current shift. Forward pad uses the same rule on each path's simulated closes.",
        bullets: [
          "Trading calendar only — no weekend closes",
          "First gap uses trading-day count",
          "Later gaps use calendar days between shifts",
        ],
        steps: [
          "Mask trading dates in the shift interval on this path.",
          "Average simulated Nifty closes over that mask.",
          "Pass average spot into the seven-percent carry formula.",
        ],
      },
      {
        id: "roll",
        label: "Roll Cost Points",
        kind: "engine",
        description:
          "First month: seven percent times average spot times trading days over 365. Later months: seven percent times average spot times calendar days between shifts over 365. Different paths produce different roll points.",
        detail:
          "NAV scales by the product roll rate and zeros rolls after the last observation. Tax benefit is tracked separately and is not added to Total.",
        bullets: [
          "Default roll rate 7%",
          "Stops after last observation expiry",
          "Different paths ⇒ different roll points",
        ],
        steps: [
          "Seed month → trading-day count on or before first shift.",
          "Later months → calendar days between consecutive shifts.",
          "Apply roll against cumulative futures while date ≤ last observation.",
        ],
      },
      {
        id: "bus",
        label: "Market Database",
        kind: "output",
        description:
          "One shared market handle holds spots, rolls, expiries, and the month-to-expiry map for hedge and NAV. Forward prices and roll points stay per-path.",
        detail:
          "The month-to-expiry map lets observation mapping look up the monthly expiry in constant time. Intel · Market Calendar shows dates only — not a shared forward price book.",
        bullets: [
          "Shared across all paths in a job",
          "Month map for hedging observation lookup",
          "Intel shows calendars; prices are path-local",
        ],
        steps: [
          "Load market at worker start.",
          "Pass the same handle to paths, hedging, and NAV.",
          "Sync extends history through the latest session.",
        ],
      },
    ],
    defaults: [
      { label: "Assumed Rate", value: "7%" },
      { label: "Tax Benefit Factor", value: "42.744% Of Roll" },
      { label: "First Roll Gap", value: "19 Trading Days From 2001-01-01" },
    ],
    insights: [
      "Historical Nifty, roll calendars, and expiries load from market data files at worker start.",
      "Market sync extends history through the latest Nifty session.",
      "Roll points = 7% × average Nifty between shifts × day fraction; first interval uses a trading-day seed.",
      "Each path gets a roll vector aligned to its dates — zero on non-shift days.",
      "NAV zeros roll when the path date exceeds the last observation from hedging.",
      "The month-to-expiry map powers observation expiry lookup.",
      "One market handle is shared across parallel path evaluations.",
    ],
    noteCards: [
      {
        title: "What the market load brings in",
        body: "Spot series, shift-date roll points, and monthly plus full expiry calendars assemble from the data files at load.",
        bullets: [
          "Daily Nifty — historical spot series",
          "Roll costs — shift-date roll points",
          "Calendar build — monthly and all expiries",
        ],
      },
      {
        title: "Spot lookup",
        body: "Historical lookup floors to the prior close. Forward paths pass their own simulated spots into hedge and NAV; observation Nifty uses the level on or before the target on that path.",
      },
      {
        title: "Roll cost construction",
        body: "Seven percent carry on index futures: average spot over the shift interval times day fraction. Historical series stored at load; each simulated path recomputes from its own spots.",
        code: "roll = 0.07 × avg_spot × Δt / 365",
      },
      {
        title: "Futures shift calendar",
        body: "Monthly-last option expiries double as futures shift dates. As-of month is included when its expiry is still ahead. Shift dates and expiries stay in sync.",
      },
      {
        title: "How NAV applies roll",
        body: "NAV multiplies the day's roll by cumulative futures and scales to crores. Rolls stop after the last observation expiry. Tax benefit equals 42.744% of roll and is shown but excluded from Total.",
        bullets: [
          "Roll on shift days from the path roll vector",
          "Masked when date is after last observation",
          "Tax benefit stored, not in Total",
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
      "The expiry calendar builds monthly and full weekly Nifty option expiries from 2001. Hedging maps each observation target onto the monthly-last expiry for that month.",
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
        description:
          "An optional overrides file can pin authoritative expiry dates for specific months. When a month is listed there, that date wins.",
        detail:
          "Otherwise the resolver falls through to the futures shift date or the weekday rule for that NSE era. Overrides load when the market initialises.",
        bullets: [
          "Optional month-level override file",
          "Override wins when present",
          "Loaded at market init",
        ],
        steps: [
          "Read the override file if present.",
          "Merge override dates into the monthly build.",
          "Expose the monthly list for Hedging Sheet mapping.",
        ],
      },
      {
        id: "priority",
        label: "Month Resolver",
        kind: "engine",
        description:
          "For each month: override first, then futures shift, then the NSE weekday rule — last Thursday through August 2025, last Tuesday from September 2025. Holidays floor to the previous trading day.",
        detail:
          "Pre-2019 used monthly-only Thursdays. From February 2019 weeklies joined on Thursday. From September 2025 weekly and monthly move to Tuesday.",
        bullets: [
          "Tuesday era from September 2025",
          "Holiday → previous trading day",
          "Weekly series from February 2019 for Intel",
        ],
        steps: [
          "Check override for year and month.",
          "Else use futures shift date if in the roll calendar.",
          "Else compute last weekday in month per era rule.",
          "Floor to the prior trading day when needed.",
        ],
      },
      {
        id: "csv",
        label: "Expiry List",
        kind: "output",
        description:
          "The monthly-last expiry list from 2001 feeds Hedging Sheet observation mapping.",
        detail:
          "A month-to-expiry dictionary lets each observation target resolve quickly. Sync rebuilds the list when Nifty history extends.",
        bullets: [
          "Monthly-last for observation map",
          "From 2001 through latest Nifty date",
          "Rebuilt when market history extends",
        ],
        steps: [
          "Build the monthly-last series from the trading calendar.",
          "Fill the month-to-expiry map.",
          "Hand both to hedging on every path.",
        ],
      },
      {
        id: "intel",
        label: "Intel · Market Calendar",
        kind: "lookup",
        description:
          "Market Calendar lists futures shift dates and monthly option expiries from as-of forward. Simulated Nifty and roll points differ by path — see Simulated Nifty Paths, Hedging, and Computation.",
        detail:
          "There is no shared forward price workbook. Calendar dates are shared; prices and roll points are path-local. Observation expiries also appear on the Hedging Sheet.",
        bullets: [
          "Requires a completed Run and selected path for path levels",
          "Calendar dates shared; prices path-local",
          "Observation expiries also on Hedging Sheet",
        ],
        steps: [
          "Load path detail (dates, Nifty, rolls, monthly expiries).",
          "Monthly expiries feed observation mapping.",
          "Roll points already applied in Computation for that path.",
        ],
      },
    ],
    defaults: [
      { label: "Observation Month Length", value: "30.5 Days" },
      { label: "Tuesday Era Start", value: "2025-09-01" },
      { label: "Rebuild", value: "On market sync" },
    ],
    insights: [
      "NSE expiry weekday rules break at February 2019 (weeklies) and September 2025 (Tuesday).",
      "The monthly-last list is what observation mapping uses.",
      "Each observation target maps to that month's monthly expiry, or the first expiry on or after the target.",
      "Observation targets use month offset × 30.5 calendar days from path start before expiry mapping.",
      "Forward futures shifts equal monthly option expiries; holidays floor backward.",
      "Optional overrides sit first in the resolver stack.",
      "Market Calendar is shared dates only; simulated levels live per path.",
    ],
    noteCards: [
      {
        title: "Resolver priority",
        body: "Monthly expiry for a calendar month resolves in order: override, futures shift date, then computed last weekday per NSE era.",
        bullets: [
          "Override wins when present",
          "Shift date from roll calendar",
          "Thursday era → Tuesday era at September 2025",
        ],
      },
      {
        title: "NSE era breakpoints",
        body: "Pre-2019: monthly-only last Thursday. February 2019+: weeklies on Thursday. September 2025+: weekly and monthly on Tuesday.",
      },
      {
        title: "Hedging Sheet mapping",
        body: "Each observation month becomes a calendar target of start plus month × 30.5 days. That target snaps to the monthly expiry for the target month, or the first expiry on or after the target.",
        code: "target = start + m × 30.5 days → monthly expiry",
      },
      {
        title: "Two expiry lists",
        body: "Monthly-last expiries feed hedge and roll. Market Calendar shows those expiry dates from as-of forward; simulated Nifty on expiry is path-specific.",
      },
      {
        title: "Rebuild and sync",
        body: "Market sync rebuilds calendars when Nifty history extends so live desk sessions stay current.",
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
      "Each path maps observation months to monthly expiries, expands the options book across those dates, and sums Black–Scholes deltas into the daily futures inventory Computation needs.",
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
        description:
          "Path start and the first Nifty level on the path anchor all strikes and observation targets. The same product book applies on every path; only the starting spot changes.",
        detail:
          "Start is the first trading day on the path. Spot zero is the first close (simulated for forward paths). Rates and vols come from the product legs and do not change by path.",
        bullets: [
          "Spot zero = first close on the path",
          "Same product book on every path",
          "Full hedge state handed to NAV",
        ],
        steps: [
          "Load the path's spot series.",
          "Record the first close for strike scaling.",
          "Open the hedge container for downstream NAV.",
        ],
      },
      {
        id: "targets",
        label: "Observation Targets",
        kind: "process",
        description:
          "Each observation month becomes a calendar target of path start plus month times 30.5 days. The sample uses seven months from 38 through 56.",
        detail:
          "Observation Nifty comes from the path's own spots on or before the target. That equals historical market lookup only when the path is historical.",
        bullets: [
          "Seven targets in the sample book",
          "30.5-day month convention",
          "Each row carries month, target, expiry, and Nifty",
        ],
        steps: [
          "For each observation month, offset = month × 30.5.",
          "Target date = start plus that many calendar days.",
          "Store the build row for the Hedging Sheet.",
        ],
      },
      {
        id: "map-exp",
        label: "Map To Monthly Expiry",
        kind: "lookup",
        description:
          "Each target snaps onto the monthly Nifty option expiry for that calendar month. If the month is missing, the first expiry on or after the target is used.",
        detail:
          "Mapped expiries stay in product file order. Observation Nifty on each expiry date is recorded for the sheet.",
        bullets: [
          "Monthly-last expiry per target month",
          "Fallback to first expiry on or after target",
          "Mapped list feeds the options book",
        ],
        steps: [
          "Resolve monthly expiry for each target.",
          "Append expiry to the observations list.",
          "Record Nifty on each expiry date.",
        ],
      },
      {
        id: "book",
        label: "Build Option Legs",
        kind: "engine",
        description:
          "Active product legs cross every observation expiry. Strike is spot zero times strike percent. Contract size is raw quantity times principal over spot zero over observation count.",
        detail:
          "Only Include Yes legs enter. The sample six puts across seven observations become forty-two built legs. Forward and discount rates come from each product row.",
        bullets: [
          "Include Yes rows only",
          "Six sample puts × seven obs = 42 legs",
          "Qty = raw × principal / spot / n_obs",
        ],
        steps: [
          "Count observations (at least one).",
          "For each active leg, set strike from spot zero and strike percent.",
          "Size quantity from raw qty, principal, spot, and observation count.",
          "Emit one built leg per observation expiry with the right vol.",
        ],
      },
      {
        id: "vol",
        label: "Moneyness Volatility",
        kind: "lookup",
        description:
          "Vol Near applies on the first observation; Vol Far on later ones. If a parsed vol is missing or non-positive, a moneyness default by strike percent is used.",
        detail:
          "Near and Far come from Product Input per leg. The same vols apply on every path.",
        bullets: [
          "Near on first observation; Far later",
          "Moneyness fallback when vol is blank",
          "Same vols on every path",
        ],
        steps: [
          "First observation → Vol Near when set.",
          "Later observations → Vol Far.",
          "If vol is missing or non-positive, use the strike-percent default.",
        ],
      },
      {
        id: "delta",
        label: "Option Delta",
        kind: "engine",
        description:
          "Legs group by expiry. Black–Scholes prices with a half-point spot bump up and down; the difference times contract quantity sums into required delta.",
        detail:
          "Time to expiry is calendar days from as-of over 365. Forward and discount rates come from the leg group. Puts and calls use the flag from the product row. There is no divide by twice the bump.",
        bullets: [
          "Group legs by expiry",
          "±0.5 central difference on spot",
          "Forward and discount per leg group",
        ],
        steps: [
          "Group built legs by expiry.",
          "For each group, compute time to expiry across path dates.",
          "Sum bumped Black–Scholes deltas times quantity into required delta.",
        ],
      },
      {
        id: "req",
        label: "Net Required Delta",
        kind: "output",
        description:
          "One required-delta value per path trading day opens the Computation futures inventory. The last observation expiry gates when rolls stop.",
        detail:
          "NAV reads day-over-day change in required delta as traded futures quantity. Cumulative position marks MTM and scales roll.",
        bullets: [
          "One value per path trading day",
          "Feeds futures inventory in Computation",
          "Last observation gates roll",
        ],
        steps: [
          "Return the daily required-delta series.",
          "Store legs and observation builds with it.",
          "Pass required delta and last observation into NAV.",
        ],
      },
    ],
    defaults: [
      { label: "Option Type", value: "Put Option" },
      { label: "Forward And Discount", value: "6.6% / 7.6%" },
      { label: "Contract Qty Formula", value: "raw × principal / Spot₀ / n_obs" },
    ],
    insights: [
      "Per path: fix spot zero, build observation targets, expand legs, then sum deltas.",
      "Observation target = path start + month × 30.5 days; then map to monthly expiry.",
      "Strike = spot zero × strike percent; contract qty = raw × principal / spot zero / observation count; expand across all observation expiries.",
      "Only Include Yes legs enter the book.",
      "Vol Near on the first observation; Vol Far on later ones.",
      "Required delta sums central Black–Scholes bumps of ±0.5 with no extra divisor.",
      "Last observation caps roll charges in NAV after the final observation expiry.",
    ],
    noteCards: [
      {
        title: "Per-path hedge pass",
        body: "One hedge pass per path returns daily required delta, built legs, and the observation table for the desk.",
        bullets: [
          "Same product, different spot zero per path",
          "Returns legs for path-detail UI",
          "Feeds Computation futures inventory",
        ],
      },
      {
        title: "Observation schedule",
        body: "Product Input month offsets become calendar targets and monthly expiries.",
        code: "target = start + m × 30.5 days",
      },
      {
        title: "Options book expansion",
        body: "Product Input stores each strike once. The book emits one row per active leg and observation expiry — sample six puts become forty-two rows.",
        bullets: [
          "Strike = Spot₀ × Strike% / 100",
          "Qty = raw × principal / Spot₀ / n_obs",
          "Forward and Discount from each leg",
        ],
      },
      {
        title: "Vol assignment",
        body: "Near vs Far by observation index. Blank or non-positive vols fall back to moneyness defaults by strike percent.",
      },
      {
        title: "Central delta bump",
        body: "Price puts and calls with forward and discount from the leg group, bump spot by half a point either way, multiply by contract quantities.",
        code: "req_delta = Σ Δ_BS(S±0.5, K, τ, σ) × qty",
      },
      {
        title: "Expiry grouping",
        body: "Legs group by expiry so time to expiry is computed once per group across all path dates.",
      },
      {
        title: "What NAV consumes",
        body: "NAV takes required delta and last observation (plus path-local roll on shift days). Observation builds feed the Hedging Sheet only — not the NAV ledger.",
        bullets: [
          "Required delta → futures inventory",
          "Last observation → roll cutoff",
          "Observation table → Hedging Sheet UI",
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
      "The daily ledger seeds cash and G-Sec from Product Input, marks futures from required delta, applies rolls, fees, and brokerage, then reports terminal Total and IRR.",
    stageCount: 8,
    metrics: [
      { label: "Cash Buffer", value: "principal × cash_pct" },
      { label: "G-Sec Day Zero", value: "principal × gsec_pct" },
      { label: "Fee Rate", value: "Product Input fee rate" },
    ],
    nodes: [
      {
        id: "delta-inv",
        label: "Futures Inventory",
        kind: "input",
        description:
          "Required delta from hedging drives day-over-day traded quantity and the cumulative futures position that marks MTM.",
        detail:
          "Opening change equals the first day's required delta. Later days use the difference versus the prior day. Cumulative position marks MTM and scales roll.",
        bullets: [
          "Opens the daily ledger",
          "Traded qty = day-over-day delta change",
          "Cumulative position marks MTM",
        ],
        steps: [
          "Accept the daily required-delta series.",
          "Compute change as the first difference.",
          "Cumulate traded quantity for MTM and roll.",
        ],
      },
      {
        id: "mtm",
        label: "Futures Mark To Market",
        kind: "engine",
        description:
          "Daily MTM is prior cumulative futures times the Nifty move, scaled to crores. Day zero MTM is zero.",
        detail:
          "MTM accumulates into the cash buffer. The sum feeds the Result MTM block, including roll days.",
        bullets: [
          "Prior cum position × ΔNifty / 1e7",
          "Includes roll days",
          "Sum feeds Result MTM block",
        ],
        steps: [
          "Use yesterday's cumulative futures for today's mark.",
          "Multiply by today's Nifty change and scale to crores.",
          "Add to the cash cumulative path.",
        ],
      },
      {
        id: "roll-nav",
        label: "Rollover Cost",
        kind: "process",
        description:
          "Roll cost hits on futures shift dates while the date is on or before the last observation. Tax benefit is tracked separately and is not in Total.",
        detail:
          "Roll equals minus roll points times cumulative futures, scaled to crores. After the last observation, roll is zeroed.",
        bullets: [
          "Seven percent roll convention",
          "Stops after last observation expiry",
          "Tax benefit 42.744% · not in Total",
        ],
        steps: [
          "Align roll points to path dates.",
          "Zero rolls after last observation.",
          "Apply roll against cumulative futures into cash.",
        ],
      },
      {
        id: "cash",
        label: "Cash And Interest",
        kind: "engine",
        description:
          "Cash buffer is principal times the cash percent at day zero. It absorbs MTM and roll and earns the Product Input cash rate on the prior balance.",
        detail:
          "Interest uses calendar day gaps between path dates. Cash plus interest for the Result block is the buffer plus sum of cash interest.",
        bullets: [
          "Cash rate from Product Input (sample 6%)",
          "Absorbs MTM and rollover hits",
          "Day gaps from path date diffs",
        ],
        steps: [
          "Seed day-zero cash from principal × cash percent.",
          "Accumulate MTM and roll into the cash series.",
          "Accrue interest on the lagged cash balance.",
        ],
      },
      {
        id: "gsec",
        label: "G-Sec Compounding",
        kind: "engine",
        description:
          "The bond sleeve is principal times the G-Sec percent at day zero and compounds at the Product Input G-Sec rate.",
        detail:
          "Opening G-Sec is the remainder of principal after the cash buffer. Growth uses calendar day gaps. Interest is the day-over-day increase.",
        bullets: [
          "G-Sec rate from Product Input (sample 6%)",
          "Day-zero sleeve = principal × G-Sec percent",
          "Compound on calendar day gaps",
        ],
        steps: [
          "Set opening G-Sec = principal minus cash buffer.",
          "Apply daily growth from the G-Sec rate.",
          "Track G-Sec interest for the Result block.",
        ],
      },
      {
        id: "tx",
        label: "Transaction Costs",
        kind: "process",
        description:
          "Buy and sell brokerage apply on futures turnover every trading day from Product Input rates.",
        detail:
          "Notional is absolute traded quantity times spot, scaled to crores. The same brokerage card applies every day. NAV subtracts today's and the prior day's costs each step.",
        bullets: [
          "Buy and sell brokerage from Product Input",
          "Same brokerage card every day",
          "Turnover on traded quantity × Nifty",
        ],
        steps: [
          "Compute notional from traded quantity and spot.",
          "Apply buy or sell rate from the sign of the trade.",
          "Subtract same-day and prior-day costs in the NAV step.",
        ],
      },
      {
        id: "fees",
        label: "Management Fees",
        kind: "process",
        description:
          "Management fee accrues at the Product Input fee rate on principal across path tenure.",
        detail:
          "Fees use calendar day gaps, subtract from the daily NAV increment, and sum into the terminal Result.",
        bullets: [
          "Fee rate from Product Input (sample 1.5%)",
          "Calendar day-gap accrual",
          "Subtracted in the daily NAV step",
        ],
        steps: [
          "Read fee rate from the product book.",
          "Multiply principal by rate and day fraction.",
          "Accumulate fees for the Result block.",
        ],
      },
      {
        id: "result",
        label: "Result And IRR",
        kind: "output",
        description:
          "Terminal components and annualised IRR from Total versus principal over tenure.",
        detail:
          "Total = principal + MTM + cash interest (with buffer) + G-Sec interest − transaction costs − fees. Tax benefit on roll is stored but not added. IRR annualises Total over calendar tenure days.",
        bullets: [
          "Invt + MTM + CashInt + Gsec + Tx + Fees",
          "Tax benefit stored, not added to Total",
          "Daily series available for path detail",
        ],
        steps: [
          "Aggregate component sums across the path.",
          "Tenure used = end minus start in calendar days.",
          "IRR = (Total / principal) raised to 365 / tenure, minus one.",
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
      "Day zero opens Cash = principal × cash percent and G-Sec = principal × G-Sec percent.",
      "Futures inventory: traded quantity is the change in required delta; cumulative position drives MTM and roll.",
      "MTM = prior cum futures × Nifty move / 1e7; rolls apply on shift dates while date ≤ last observation.",
      "Cash absorbs MTM and roll and earns the cash rate; G-Sec compounds on its opening sleeve.",
      "Brokerage uses Product Input buy and sell rates on turnover every day; NAV subtracts today and yesterday.",
      "Total = Invt + MTM + CashInt + Gsec − Tx − Fees; tax benefit on roll is stored, not added.",
      "IRR annualises terminal Total against principal over calendar tenure days.",
    ],
    noteCards: [
      {
        title: "NAV entry per path",
        body: "After hedging, NAV runs with required delta, principal, rate assumptions, and the last-observation cutoff.",
        bullets: [
          "Daily series kept for path detail tables",
          "Result row feeds the job summary",
          "One pass per Monte Carlo path",
        ],
      },
      {
        title: "Day-zero seeds",
        body: "Cash = principal × cash percent and G-Sec = principal × G-Sec percent initialise the ledger before the first MTM tick.",
        code: "cash₀ = principal × cash%; gsec₀ = principal × gsec%",
      },
      {
        title: "Futures MTM loop",
        body: "Mark-to-market uses yesterday's cumulative futures against today's Nifty move, converted to crores.",
        code: "mtm = prior fut × (S_today − S_yesterday) / 1e7",
      },
      {
        title: "Roll and tax benefit",
        body: "Roll cost charges on futures shift dates proportional to cum position. Tax benefit = 42.744% × roll — displayed but excluded from Total.",
      },
      {
        title: "Cash and G-Sec carry",
        body: "Cash earns the Product Input cash rate on the lagged balance after MTM and roll. G-Sec compounds on calendar gaps between path dates.",
      },
      {
        title: "Transaction costs",
        body: "Buy and sell legs use Product Input brokerage on traded futures notional every day. Computation subtracts same-day and prior-day costs in the NAV step.",
      },
      {
        title: "Terminal Result block",
        body: "Total sums investment, MTM and roll, cash interest plus buffer, G-Sec interest, minus transaction costs and fees. IRR uses 365 over tenure days.",
        code: "Total = Invt + ΣMTM+roll + CashInt + Gsec − Tx − Fees",
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
      "The forward Run evaluates paths in parallel — hedge then NAV on each seed — stores the job summary and yearly KPIs, and powers the Since-year filter without re-running the engine.",
    stageCount: 5,
    metrics: [
      { label: "Paths", value: "1000" },
      { label: "KPIs", value: "Mean · Median · IRR" },
      { label: "Filter", value: "Since Year" },
    ],
    nodes: [
      {
        id: "run",
        label: "Parallel Path Run",
        kind: "engine",
        description:
          "Workers evaluate paths in parallel. Each path runs hedging then NAV. A new Run cancels the prior job safely and reports progress to the desk.",
        detail:
          "Workers share the same product book and market handle. Path count follows Monte Carlo Paths from the product (default one thousand).",
        bullets: [
          "Parallel workers per path",
          "Cancel-safe on new runs",
          "Progress callback to UI",
        ],
        steps: [
          "Build the forward path atlas.",
          "Spawn workers with product and market.",
          "For each path: hedge → NAV → summary row.",
          "Aggregate rows into the job summary.",
        ],
      },
      {
        id: "row",
        label: "Path Summary Row",
        kind: "process",
        description:
          "One result block per path: investment, MTM, cash, G-Sec, transaction costs, fees, Total, IRR, and Nifty levels.",
        detail:
          "Each row also carries start and end, average observation Nifty, absolute Nifty return, start year, trading-day count, and optional buy/sell cost splits.",
        bullets: [
          "Powers Analytics Lab tables",
          "One row per path",
          "Buy/sell cost splits when available",
        ],
        steps: [
          "Map NAV result fields into the summary row.",
          "Attach path start and end dates.",
          "Append to the job summary list.",
        ],
      },
      {
        id: "year",
        label: "Yearly Rollup",
        kind: "engine",
        description:
          "Groups path summaries by start year for mean, median, hit-rate, and extremes.",
        detail:
          "Yearly Lab aggregates after the Since-year filter. Charts show mean versus median IRR, hit rates, and tails.",
        bullets: [
          "Bucket by path start year",
          "Mean vs median IRR charts",
          "Hit-rate and extremes",
        ],
        steps: [
          "Filter summaries where start year ≥ Since year.",
          "Group by start year.",
          "Compute KPI aggregates per year bucket.",
        ],
      },
      {
        id: "since",
        label: "Since Year Filter",
        kind: "process",
        description:
          "Trims which path rows feed Home KPIs and Analytics — no engine re-run.",
        detail:
          "Default Since year is 2001. The filter applies on the cached job summary. Path picker and yearly charts respect the same cutoff.",
        bullets: [
          "Default · 2001",
          "Client-side on cached job",
          "Does not trigger a new forward Run",
        ],
        steps: [
          "User selects Since year in Analytics.",
          "Filter summary rows by start year.",
          "Recompute displayed KPIs from the subset.",
        ],
      },
      {
        id: "lab",
        label: "Analytics Surfaces",
        kind: "output",
        description:
          "Home summary, Yearly Lab, Path Summary table, single-path detail, and delta charts.",
        detail:
          "Path detail loads cached daily ledger, required delta, and legs from the job folder on demand. Home KPIs read the latest completed job summary.",
        bullets: [
          "Yearly Lab · Path Summary · Charts",
          "Path detail cache per job folder",
          "Desk · Analytics navigation",
        ],
        steps: [
          "Job completes → summary persisted.",
          "Analytics pages read the job store.",
          "Path picker fetches single-path detail on demand.",
        ],
      },
    ],
    defaults: [
      { label: "Default Since", value: "2001" },
      { label: "Path Detail Cache", value: "Per Path Under The Job Folder" },
      { label: "Monte Carlo Paths", value: "1000" },
    ],
    insights: [
      "A Run builds the forward path atlas, then evaluates hedge and NAV on each Monte Carlo seed in parallel.",
      "Each path: hedge → NAV with required delta and last observation.",
      "Summary rows store Invt, MTM, Cash+Int, Gsec, Tx, Fees, Total, IRR, and Nifty start/end.",
      "Yearly rollup groups by path start year for mean, median, hit-rate, and extreme charts.",
      "Since-year filter trims which rows feed Home KPIs and Analytics without re-running the engine.",
      "Path detail cache stores the daily ledger, delta, and legs under the job folder.",
      "Progress and cancel checks let a new Run supersede a stale one when product or params change.",
    ],
    noteCards: [
      {
        title: "Forward-test orchestration",
        body: "The Run wires product, market, path atlas, parallel workers, and job persistence.",
        bullets: [
          "Paths use product tenure and observation months",
          "Workers run in parallel across seeds",
          "Job folder stores summary and path details",
        ],
      },
      {
        title: "Single path pipeline",
        body: "Each worker hedges then runs NAV for one path and returns the summary row plus optional detail payload.",
      },
      {
        title: "Summary row contents",
        body: "Terminal components mirror the NAV Result: investment, futures MTM, cash plus interest, G-Sec, transaction cost, fees, Total, IRR, plus Nifty context.",
      },
      {
        title: "Yearly Lab aggregation",
        body: "Charts bucket summary rows by start year. Mean and median IRR, hit rates, and tails compute on the filtered set.",
      },
      {
        title: "Since-year filter",
        body: "The desk trims cached summary rows where path start year is on or after selected Since — instant KPI refresh without recomputing paths.",
      },
      {
        title: "Path detail on demand",
        body: "Single-path views load cached daily ledger, cost rows, and delta from the job folder rather than re-running hedge and NAV.",
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
  n_paths?: number | null;
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
 * Overlay live product / market meta onto Logic Atlas chips.
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
      if (product.n_paths != null) {
        defaults = [
          ...defaults.filter((d) => d.label !== "Monte Carlo Paths"),
          { label: "Monte Carlo Paths", value: String(product.n_paths) },
        ];
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

    if (mod.id === "macro-paths") {
      const asof = market?.asof ?? market?.last_date;
      if (asof) {
        metrics = replaceMetric(metrics, "All Paths Start", formatDeskDate(asof));
      }
      if (market?.simulation_end) {
        metrics = replaceMetric(metrics, "All Paths End", formatDeskDate(market.simulation_end));
      }
      const nPaths = product?.n_paths ?? market?.n_paths_monthly;
      if (nPaths != null) {
        defaults = replaceDefault(defaults, "Monte Carlo Paths", String(nPaths));
        metrics = [
          ...metrics.filter((m) => m.label !== "Monte Carlo Paths"),
          { label: "Monte Carlo Paths", value: String(nPaths) },
        ];
      }
      if (market?.trading_days != null) {
        defaults = [
          ...defaults.filter((d) => d.label !== "Horizon Trading Days"),
          { label: "Horizon Trading Days", value: String(market.trading_days) },
        ];
      } else if (market?.n_trading_days != null) {
        defaults = [
          ...defaults.filter((d) => d.label !== "Horizon Trading Days"),
          { label: "Horizon Trading Days", value: String(market.n_trading_days) },
        ];
      }
    }

    if (mod.id === "summary") {
      const nPaths = product?.n_paths ?? market?.n_paths_monthly;
      if (nPaths != null) {
        metrics = replaceMetric(metrics, "Paths", String(nPaths));
        defaults = replaceDefault(defaults, "Monte Carlo Paths", String(nPaths));
      }
    }

    if (metrics === mod.metrics && defaults === mod.defaults) return mod;
    return { ...mod, metrics, defaults };
  });
}
