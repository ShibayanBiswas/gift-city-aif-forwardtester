export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const MAX_DECIMALS = 3;

function clampDigits(digits: number) {
  return Math.min(Math.max(0, Math.floor(digits)), MAX_DECIMALS);
}

/** Terminal value in crores — at most 3 decimal places. */
export function formatCr(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  const d = clampDigits(digits);
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

/** Fraction → percent string: 0.1332 → 13.32% · max 3 decimals. */
export function formatPct(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(clampDigits(digits))}%`;
}

/** General numeric with Indian grouping · max 3 decimals. */
export function formatNum(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  const d = clampDigits(digits);
  return n.toLocaleString("en-IN", {
    maximumFractionDigits: d,
    minimumFractionDigits: d,
  });
}

const DESK_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** True for ISO calendar dates in the Nifty trading era (rejects Excel epoch junk). */
export function isPlausibleTradingDate(raw: unknown): boolean {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getUTCFullYear();
    return y >= 2001 && y <= 2100;
  }
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return false;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return false;
  if (y < 2001 || y > 2100) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  return true;
}

/** Desk date label: 2026-07-24 → 24-Jul-2026 (never 30-Dec-99 Excel epoch). */
export function formatDeskDate(raw: unknown): string {
  if (!isPlausibleTradingDate(raw)) return "—";
  if (raw instanceof Date) {
    const y = raw.getUTCFullYear();
    const m = raw.getUTCMonth();
    const d = raw.getUTCDate();
    return `${String(d).padStart(2, "0")}-${DESK_MONTHS[m]}-${y}`;
  }
  const s = String(raw).trim().slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  return `${String(d).padStart(2, "0")}-${DESK_MONTHS[m - 1]}-${y}`;
}

/** Add calendar days to an ISO date (YYYY-MM-DD) → ISO date. */
export function addCalendarDaysIso(raw: unknown, days: number): string | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(raw.trim())) return null;
  if (!Number.isFinite(days)) return null;
  const [y, m, d] = raw.trim().slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Math.trunc(days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** True when /api/market/meta carries as-of → Product End horizon counts. */
export function isDeskHorizonMeta(m: {
  simulation_end?: string | null;
  product_end?: string | null;
  simulation_end_days?: number | null;
  tenure_days?: number | null;
  n_paths?: number | null;
} | null | undefined): boolean {
  return (
    m != null &&
    (m.simulation_end_days != null || m.tenure_days != null) &&
    Boolean(m.simulation_end || m.product_end)
  );
}

/** Default / clamp for Monte Carlo path count (matches backend). */
export const DEFAULT_N_PATHS = 1000;
export const MIN_N_PATHS = 1;
export const MAX_N_PATHS = 10000;
/** Free-host / deploy soft ceiling — warn when selecting above this. */
export const DEPLOY_PATH_SOFT_CAP = 2000;
/** Stronger warning for very large path counts (memory / timeout risk). */
export const DEPLOY_PATH_HARD_WARN_AT = 5000;
/** Preset choices for the desk dropdown (max = MAX_N_PATHS). */
export const MONTE_CARLO_PATH_PRESETS = [100, 500, 1000, 5000, 10000] as const;
/** Warn about run time / host limits at or above this path count. */
export const MONTE_CARLO_LIMITS_WARN_AT = DEPLOY_PATH_SOFT_CAP;

export function clampNPaths(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_N_PATHS;
  return Math.max(MIN_N_PATHS, Math.min(MAX_N_PATHS, Math.trunc(n)));
}

/** Validate a custom Monte Carlo path-count string from the desk control. */
export function parseMonteCarloPathInput(raw: string): {
  ok: true;
  n: number;
} | {
  ok: false;
  title: string;
  body: string;
} {
  const trimmed = String(raw ?? "").trim().replace(/,/g, "");
  if (!trimmed) {
    return {
      ok: false,
      title: "Path Count Required",
      body: `Enter a whole number between ${MIN_N_PATHS.toLocaleString("en-IN")} and ${MAX_N_PATHS.toLocaleString("en-IN")}.`,
    };
  }
  if (!/^\d+$/.test(trimmed)) {
    return {
      ok: false,
      title: "Invalid Path Count",
      body: "Path count must be a whole number. Do not use decimals, letters, or symbols.",
    };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    return {
      ok: false,
      title: "Invalid Path Count",
      body: "That value could not be read as a number. Please try again.",
    };
  }
  if (n < MIN_N_PATHS) {
    return {
      ok: false,
      title: "Path Count Too Low",
      body: `Path count must be at least ${MIN_N_PATHS.toLocaleString("en-IN")}.`,
    };
  }
  if (n > MAX_N_PATHS) {
    return {
      ok: false,
      title: "Path Count Too High",
      body: `Path count must be at most ${MAX_N_PATHS.toLocaleString("en-IN")}. Choose a preset or enter a smaller custom value.`,
    };
  }
  return { ok: true, n: clampNPaths(n) };
}

/** Map option codes to long-form labels. Default book is puts. */
export function optionTypeLabel(code?: string | null): string {
  const c = String(code ?? "P").trim().toUpperCase();
  if (c === "C" || c === "CALL" || c.includes("CALL")) return "Call Option";
  return "Put Option";
}

/** Sold / Bought Put (or Call) from signed raw quantity. Default book is puts. */
export function tradeSideLabel(rawQty: number, code?: string | null): string {
  const kind = optionTypeLabel(code);
  return rawQty < 0 ? `Sold ${kind}` : `Bought ${kind}`;
}

export type Frequency = "daily" | "weekly" | "monthly" | "quarterly" | "semi_annual";

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  semi_annual: "Semi-annually",
};

/** Ascending tenure step — used by the path-frequency dropdown. */
export const FREQUENCY_ORDER: Frequency[] = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "semi_annual",
];

export type ProductLeg = {
  return_level: number;
  strike_pct: number;
  quantity: number;
  option_type?: string;
  forward_rate?: number;
  discount_rate?: number;
  vol?: number;
  vol_near?: number | null;
  include?: boolean;
};

export type ProductSpec = {
  name: string;
  principal: number;
  principal_cr: number;
  tenure_days: number;
  observation_months: number[];
  n_obs: number;
  last_observation_month?: number;
  legs: ProductLeg[];
  source_file?: string;
  /** Cash sleeve as fraction of principal (sample 0.05 → 5%). */
  cash_pct?: number;
  /** G-Sec sleeve as fraction of principal (sample 0.95 → 95%). */
  gsec_pct?: number;
  cash_buffer_cr?: number;
  gsec_opening_cr?: number;
  cash_rate?: number;
  gsec_rate?: number;
  fee_rate?: number;
  /** Alias of buy_brokerage (engine keeps them aligned). */
  buy_rate?: number;
  buy_brokerage?: number;
  buy_gst?: number;
  /** Alias of sell_brokerage (engine keeps them aligned). */
  sell_rate?: number;
  sell_brokerage?: number;
  sell_gst?: number;
  roll_rate?: number;
  tax_benefit_rate?: number;
  /** WF1 Computation AG = AF × this rate (cash GST; sample 18%). */
  cash_gst_rate?: number;
  /** Legacy field — unused; Tx always uses brokerage. */
  rate_switch_date?: string;
  /** Calendar span of the product forward window (tenure days; API compat alias). */
  simulation_end_days?: number | null;
  /** Source of horizon — always tenure for the single-window MC model. */
  simulation_end_days_source?: "excel" | "default" | "tenure" | string;
  /** Monte Carlo path count over the single as-of → Product End window. */
  n_paths?: number | null;
};

export type PathSummary = {
  path_id: number;
  start: string;
  end: string;
  invt: number;
  mtm_futures: number;
  cash_plus_int: number;
  gsec: number;
  transaction_cost: number;
  fees: number;
  total: number;
  irr: number;
  start_nifty: number;
  end_nifty: number;
  avg_obs_nifty: number;
  abs_nifty_ret: number;
  year: number;
  n_trading_days?: number;
  buy_cost?: number;
  sell_cost?: number;
  buy_brokerage?: number;
  buy_gst?: number;
  sell_brokerage?: number;
  sell_gst?: number;
};

export type YearlyRow = {
  year: number;
  paths: number;
  mean_total: number;
  median_total: number;
  min_total: number;
  max_total: number;
  mean_irr: number;
  median_irr?: number;
  hit_rate_gt_100: number;
};

export type ForwardTestSummary = {
  product: ProductSpec;
  /** Compat — engine returns "monte_carlo"; older jobs may still use Frequency. */
  frequency: Frequency | "monte_carlo" | string;
  path_count: number;
  n_paths?: number;
  simulation_start?: string;
  simulation_end?: string;
  product_end?: string;
  simulation_end_days?: number;
  gbm?: {
    spot0: number;
    asof: string;
    mean_return: number;
    std_dev: number;
    drift: number;
    n_returns: number;
    first_date?: string;
    last_date?: string;
    mean_return_pct?: number;
    std_dev_pct?: number;
  };
  asof?: string;
  mc_matrix?: {
    n_paths: number;
    n_dates: number;
    dates?: string[];
    base_seed?: number;
    spot0?: number;
    drift?: number;
    std_dev?: number;
    mean_return?: number;
    asof?: string;
    first_date?: string | null;
    last_date?: string | null;
    layout?: {
      rows?: string;
      columns?: string;
      formula?: string;
    };
  };
  kpis: {
    mean_total: number;
    median_total: number;
    min_total: number;
    max_total: number;
    mean_irr: number;
    median_irr: number;
    hit_rate_gt_100: number;
    mean_abs_nifty_ret: number;
  };
  summary: PathSummary[];
  yearly: YearlyRow[];
};

export type PathDetail = {
  path_id: number;
  start: string;
  end: string;
  spot0?: number;
  dates: string[];
  nifty?: number[];
  rolls?: Array<{
    shift_date: string;
    roll_cost: number | null;
  }>;
  monthly_expiries?: Array<{
    expiry_date: string;
    weekday?: string;
    is_monthly_last?: boolean;
    nifty_close: number | null;
  }>;
  observations: string[];
  obs_spots: number[];
  obs_builds?: Array<{
    month: number;
    offset_days: number;
    target_date: string;
    expiry: string;
    nifty: number;
  }>;
  daily_nav: number[] | null;
  daily_delta: number[] | null;
  computation_rows?: Array<Record<string, number | string>>;
  cost_rows?: Array<Record<string, number | string>>;
  summary: PathSummary | Record<string, number>;
  legs: Array<{
    raw_qty?: number;
    strike_pct: number;
    strike: number;
    expiry: string;
    option?: string;
    forward?: number;
    discount?: number;
    vol: number;
    quantity: number;
  }>;
};

function friendlyApiError(text: string, status: number, path: string): string {
  const isPathDetail = /\/paths\/\d+/.test(path);
  if (status === 409 && isPathDetail) return "PATH_DETAIL_PENDING";
  if ((status === 504 || status === 408) && isPathDetail) return "PATH_DETAIL_TIMEOUT";
  try {
    const j = JSON.parse(text) as { detail?: string };
    if (typeof j.detail === "string" && j.detail.trim()) {
      return j.detail;
    }
  } catch {
    /* plain text */
  }
  if (status === 409) return text || "Resource is not ready yet. Retry in a moment.";
  if (status === 404) return "Requested forward-test data was not found. Try another path or run again.";
  return text || `Request failed (${status})`;
}

/** Transient path-detail states the client auto-retries without alarming the desk. */
export function isTransientPathDetailError(msg: string): boolean {
  if (/superseded by a newer run|Cancelled/i.test(msg)) return false;
  return (
    msg === "PATH_DETAIL_PENDING" ||
    msg === "PATH_DETAIL_TIMEOUT" ||
    /not ready|timed out|took too long|Job not ready/i.test(msg)
  );
}

/** Free-host / proxy blips — soft-retry status polls and summary fetches. */
export function isTransientNetworkError(msg: string): boolean {
  return (
    msg === "PATH_DETAIL_TIMEOUT" ||
    /timed out|Failed to fetch|NetworkError|network error|Load failed|fetch failed|502|503|504|ECONNRESET|asleep|cold start/i.test(
      msg,
    )
  );
}

/**
 * Optional direct Render origin (no Vercel proxy hop).
 * Set NEXT_PUBLIC_BACKEND_URL on Vercel to the Render base URL for faster cold starts.
 * Empty ⇒ same-origin `/api/*` rewrite (local + default prod).
 */
const API_ORIGIN = (process.env.NEXT_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");

function apiUrl(path: string): string {
  if (!path.startsWith("/")) return path;
  return API_ORIGIN ? `${API_ORIGIN}${path}` : path;
}

  /** Request timeout budgets (ms). Render free tier can cold-start ~30–90s. */
export const API_TIMEOUTS = {
  default: 30_000,
  /** Status polls must survive mid-run free-host wake blips. */
  status: 45_000,
  /** First wake attempt — fail fast so UI can retry / show parallel payloads. */
  wake: 25_000,
  bootstrap: 45_000,
  /** Start job POST — allow full cold wake; idempotent client_run_id prevents duplicates. */
  runStart: 120_000,
  pathDetail: 120_000,
  summary: 90_000,
  /** MC matrix on-screen preview can stream many GBM rows on constrained hosts. */
  mcMatrixPreview: 180_000,
  marketHeavy: 90_000,
  upload: 60_000,
  sample: 45_000,
  /** Wide path×date Excel can take several minutes on large horizons. */
  /** Large Daily grids can take 10–20 minutes on free Render — wait, don't abort early. */
  mcMatrixDownload: 1_200_000,
} as const;

function mergeAbortSignals(a?: AbortSignal | null, b?: AbortSignal | null): AbortSignal | undefined {
  if (!a && !b) return undefined;
  if (a && !b) return a;
  if (b && !a) return b;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  a!.addEventListener("abort", onAbort, { once: true });
  b!.addEventListener("abort", onAbort, { once: true });
  if (a!.aborted || b!.aborted) ctrl.abort();
  return ctrl.signal;
}

async function api<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? API_TIMEOUTS.default;
  const { timeoutMs: _drop, signal: userSignal, ...rest } = init ?? {};
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
  const signal = mergeAbortSignals(userSignal, timeoutCtrl.signal);
  try {
    const res = await fetch(apiUrl(path), { ...rest, signal, cache: "no-store" });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(friendlyApiError(text, res.status, path));
    }
    return (await res.json()) as T;
  } catch (e) {
    const aborted =
      (e instanceof DOMException || e instanceof Error) && e.name === "AbortError";
    if (aborted) {
      throw new Error(
        timeoutMs >= API_TIMEOUTS.pathDetail
          ? "PATH_DETAIL_TIMEOUT"
          : `Request timed out after ${Math.round(timeoutMs / 1000)}s. If the API was asleep, wait and try again.`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Soft retries for cold-start / transient network blips (does not hang forever). */
async function apiRetry<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
  attempts = 2,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await api<T>(path, init);
    } catch (e) {
      last = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** Lightweight ping used to keep Render awake while the desk tab is open. */
export function keepApiAwake(): Promise<boolean> {
  return api<{ ok?: boolean }>("/api/ping", { timeoutMs: API_TIMEOUTS.wake })
    .then((r) => Boolean(r?.ok))
    .catch(() =>
      api<{ ok?: boolean }>("/api/health", { timeoutMs: API_TIMEOUTS.wake })
        .then((r) => Boolean(r?.ok))
        .catch(() => false),
    );
}

export const client = {
  health: () => apiRetry<{ ok: boolean }>("/api/health", { timeoutMs: API_TIMEOUTS.wake }, 3),
  sync: (force = false) =>
    apiRetry<{
      ok: boolean;
      market: Record<string, unknown>;
      mongo: Record<string, unknown>;
      product_loaded: boolean;
      market_sync?: Record<string, unknown>;
    }>(`/api/sync${force ? "?force=true" : ""}`, { timeoutMs: API_TIMEOUTS.bootstrap }, 2),
  marketMeta: () =>
    apiRetry<{
      first_date: string;
      last_date: string;
      asof?: string;
      simulation_end?: string;
      product_end?: string;
      simulation_end_days?: number;
      trading_days: number;
      trading_days_history?: number;
      expiries: number;
      expiries_history?: number;
      first_expiry: string | null;
      last_expiry: string | null;
      product_name?: string;
      tenure_days?: number;
      n_paths?: number;
      path_counts?: Partial<Record<Frequency | string, number>>;
    }>("/api/market/meta", { timeoutMs: API_TIMEOUTS.bootstrap }, 2),
  nifty: () =>
    apiRetry<{
      rows: Array<{ date: string; close: number; source?: string }>;
      count: number;
      asof?: string;
      simulation_end?: string;
      simulation_end_days?: number;
    }>("/api/market/nifty", {
      timeoutMs: API_TIMEOUTS.marketHeavy,
    }, 2),
  expiries: (full = true) =>
    apiRetry<{
      rows: Array<{
        expiry_date: string;
        nifty_close: number | null;
        weekday?: string;
        is_monthly_last?: boolean;
        kind?: string;
        source?: string;
      }>;
      count: number;
      monthly_last_count?: number;
      full?: boolean;
      asof?: string;
      simulation_end?: string;
      simulation_end_days?: number;
    }>(`/api/market/expiries?full=${full ? "true" : "false"}`, { timeoutMs: API_TIMEOUTS.marketHeavy }),
  rolls: () =>
    apiRetry<{
      rows: Array<{ shift_date: string; roll_cost: number | null; source?: string }>;
      count: number;
      asof?: string;
      simulation_end?: string;
      simulation_end_days?: number;
    }>("/api/market/rolls", { timeoutMs: API_TIMEOUTS.marketHeavy }, 2),
  currentProduct: () =>
    apiRetry<ProductSpec>("/api/product/current", { timeoutMs: API_TIMEOUTS.bootstrap }, 2),
  downloadSample: async () => {
    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => timeoutCtrl.abort(), API_TIMEOUTS.sample);
    try {
      const res = await fetch(apiUrl("/api/product/sample"), {
        signal: timeoutCtrl.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Sample download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Product_Input_File.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new Error("Sample download timed out. Retry in a moment.");
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  },
  uploadProduct: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api<{
      ok: boolean;
      product: ProductSpec;
      simulation_end_days?: number;
      simulation_end?: string;
      asof?: string;
      market?: {
        first_date: string;
        last_date: string;
        asof?: string;
        simulation_end?: string;
        simulation_end_days?: number;
        trading_days: number;
        trading_days_history?: number;
        expiries: number;
        expiries_history?: number;
        first_expiry: string | null;
        last_expiry: string | null;
        product_name?: string;
      };
    }>("/api/product/upload", {
      method: "POST",
      body: fd,
      timeoutMs: API_TIMEOUTS.upload,
    });
  },
  runForwardTest: (nPaths: number, clientRunId?: string) =>
    apiRetry<{ job_id: string; reused?: boolean }>(
      "/api/forwardtest/run",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          n_paths: clampNPaths(nPaths),
          client_run_id: clientRunId ?? null,
        }),
        timeoutMs: API_TIMEOUTS.runStart,
      },
      2,
    ),
  gbmParams: () =>
    api<{
      ok: boolean;
      gbm: NonNullable<ForwardTestSummary["gbm"]>;
      simulation_start: string;
      simulation_end: string;
      simulation_end_days?: number;
    }>("/api/gbm/params", { timeoutMs: API_TIMEOUTS.status }),
  cancelForwardTest: (jobId?: string | null, reason?: string) =>
    api<{ ok: boolean; cancelled: boolean; job_id?: string }>("/api/forwardtest/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId ?? null, reason: reason ?? null }),
      timeoutMs: API_TIMEOUTS.status,
    }).catch(() => ({ ok: false, cancelled: false })),
  jobStatus: (id: string) =>
    apiRetry<{ status: string; progress: number; message: string; error?: string }>(
      `/api/forwardtest/${id}/status`,
      { timeoutMs: API_TIMEOUTS.status },
      3,
    ),
  summary: (id: string) =>
    apiRetry<ForwardTestSummary>(
      `/api/forwardtest/${id}/summary`,
      { timeoutMs: API_TIMEOUTS.summary },
      3,
    ),
  pathDetail: (jobId: string, pathId: number) =>
    apiRetry<PathDetail>(
      `/api/forwardtest/${jobId}/paths/${pathId}`,
      { timeoutMs: API_TIMEOUTS.pathDetail },
      2,
    ),
  pathHorizonMarket: (jobId: string, pathId: number) =>
    api<{
      ok: boolean;
      path_id: number;
      tenure_start: string;
      tenure_end: string;
      horizon_start: string;
      horizon_end: string;
      asof?: string;
      simulation_end: string;
      dates: string[];
      nifty: number[];
      rolls: Array<{ shift_date: string; roll_cost: number | null }>;
      monthly_expiries: Array<{
        expiry_date: string;
        weekday?: string;
        is_monthly_last?: boolean;
        nifty_close?: number | null;
      }>;
      n_trading_days: number;
      n_rolls: number;
      n_expiries: number;
      spot0: number;
    }>(`/api/forwardtest/${jobId}/paths/${pathId}/horizon-market`, {
      timeoutMs: API_TIMEOUTS.pathDetail,
    }),
  mcMatrixMeta: (jobId: string) =>
    api<{
      ok: boolean;
      n_paths: number;
      n_dates: number;
      first_date?: string | null;
      last_date?: string | null;
      spot0?: number;
      drift?: number;
      std_dev?: number;
      mean_return?: number;
      base_seed?: number;
      asof?: string;
      layout?: { rows?: string; columns?: string; formula?: string };
      dates?: string[];
    }>(`/api/forwardtest/${jobId}/mc-matrix`, { timeoutMs: API_TIMEOUTS.summary }),
  mcMatrixPreview: (jobId: string, maxPaths = 200, maxDates = 120) =>
    apiRetry<{
      ok: boolean;
      n_paths: number;
      n_dates: number;
      preview_paths: number;
      preview_dates: number;
      headers: string[];
      rows: Array<Array<number | string>>;
      truncated: boolean;
      date_sample?: "head_tail" | "full" | string;
      horizon_start?: string | null;
      horizon_end?: string | null;
      spot0?: number;
      drift?: number;
      std_dev?: number;
      mean_return?: number;
      asof?: string;
      first_date?: string | null;
      last_date?: string | null;
      layout?: { rows?: string; columns?: string; formula?: string };
    }>(
      `/api/forwardtest/${jobId}/mc-matrix/preview?max_paths=${maxPaths}&max_dates=${maxDates}`,
      { timeoutMs: API_TIMEOUTS.mcMatrixPreview },
      2,
    ),
  downloadMcMatrix: async (
    jobId: string,
    onProgress?: (message: string, progress?: number) => void,
  ) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUTS.mcMatrixDownload);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      // Queue streaming Excel build, then wait — OK if this takes minutes on Daily.
      onProgress?.("Queuing Excel export…", 0);
      await fetch(apiUrl(`/api/forwardtest/${jobId}/mc-matrix/export`), {
        method: "POST",
        signal: ctrl.signal,
        cache: "no-store",
      }).then(async (res) => {
        if (!res.ok && res.status !== 202) {
          let detail = `Export failed · ${res.status}`;
          try {
            const body = (await res.json()) as { detail?: string };
            if (body?.detail) detail = String(body.detail);
          } catch {
            /* keep */
          }
          if (/no longer on the server|Unknown job|Click Run/i.test(detail)) {
            throw new Error(
              "Previous run is no longer on the server. Click Run, wait for completion, then download again.",
            );
          }
          throw new Error(detail);
        }
      });

      const deadline = Date.now() + API_TIMEOUTS.mcMatrixDownload;
      while (Date.now() < deadline) {
        if (ctrl.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const stRes = await fetch(apiUrl(`/api/forwardtest/${jobId}/mc-matrix/export`), {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!stRes.ok) {
          let detail = `Export status failed · ${stRes.status}`;
          try {
            const body = (await stRes.json()) as { detail?: string };
            if (body?.detail) detail = String(body.detail);
          } catch {
            /* keep */
          }
          throw new Error(detail);
        }
        const st = (await stRes.json()) as {
          status?: string;
          progress?: number;
          message?: string;
          error?: string | null;
        };
        if (st.status === "ready") break;
        if (st.status === "error") {
          throw new Error(st.error || st.message || "Excel export failed");
        }
        onProgress?.(st.message || "Building Excel…", st.progress);
        await sleep(1500);
      }

      onProgress?.("Downloading Excel…", 100);
      // Prefer direct Render URL when configured — avoids Vercel proxy timeouts.
      let res = await fetch(apiUrl(`/api/forwardtest/${jobId}/mc-matrix.xlsx`), {
        signal: ctrl.signal,
        cache: "no-store",
      });
      // Rare race: file not flushed yet — wait and retry a few times.
      for (let i = 0; i < 8 && res.status === 202; i += 1) {
        onProgress?.("Excel almost ready…", 99);
        await sleep(2000);
        res = await fetch(apiUrl(`/api/forwardtest/${jobId}/mc-matrix.xlsx`), {
          signal: ctrl.signal,
          cache: "no-store",
        });
      }
      if (!res.ok) {
        let detail = `Download failed · ${res.status}`;
        try {
          const body = (await res.json()) as { detail?: string };
          if (body?.detail) detail = String(body.detail);
        } catch {
          /* keep status text */
        }
        if (/no longer on the server|Unknown job|Click Run/i.test(detail)) {
          throw new Error(
            "Previous run is no longer on the server. Click Run, wait for completion, then download again.",
          );
        }
        throw new Error(detail);
      }
      const blob = await res.blob();
      if (!blob.size) throw new Error("Download returned an empty file. Run again, then retry.");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Simulated_Nifty_Paths.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new Error("Download timed out. Please retry — large path grids can take a few minutes.");
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  },
  computation: (jobId: string, pathId: number) =>
    api<{
      path_id: number;
      start: string;
      end: string;
      summary: PathSummary;
      rows: Array<Record<string, number | string>>;
    }>(`/api/forwardtest/${jobId}/paths/${pathId}/computation`, { timeoutMs: API_TIMEOUTS.pathDetail }),
  hedging: (jobId: string, pathId: number) =>
    api<{
      path_id: number;
      start: string;
      end: string;
      spot0: number;
      obs_builds: PathDetail["obs_builds"];
      legs: PathDetail["legs"];
      summary: PathSummary;
    }>(`/api/forwardtest/${jobId}/paths/${pathId}/hedging`, { timeoutMs: API_TIMEOUTS.pathDetail }),
};
