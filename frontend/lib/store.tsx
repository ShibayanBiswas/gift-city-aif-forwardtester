"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ForwardTestSummary,
  PathDetail,
  PathSummary,
  ProductSpec,
  client,
  clampNPaths,
  DEFAULT_N_PATHS,
  isDeskHorizonMeta,
  isTransientNetworkError,
  isTransientPathDetailError,
  keepApiAwake,
} from "@/lib/api";

type Store = {
  dark: boolean;
  setDark: (v: boolean) => void;
  market: Awaited<ReturnType<typeof client.marketMeta>> | null;
  product: ProductSpec | null;
  nPaths: number;
  setNPaths: (n: number) => void;
  sinceYear: number;
  setSinceYear: (y: number) => void;
  jobId: string | null;
  summary: ForwardTestSummary | null;
  filteredSummary: PathSummary[];
  filteredYearly: ForwardTestSummary["yearly"];
  filteredKpis: ForwardTestSummary["kpis"] | null;
  pathId: number;
  setPathId: (id: number) => void;
  pathDetail: PathDetail | null;
  pathDetailLoading: boolean;
  pathDetailError: string | null;
  retryPathDetail: () => void;
  running: boolean;
  progress: number;
  message: string;
  error: string | null;
  setError: (e: string | null) => void;
  upload: (file: File) => Promise<void>;
  /** Optional path-count override for Run (avoids stale state after custom commit). */
  run: (overrideNPaths?: number) => Promise<void>;
  /** Clear stale Run results (e.g. after Render restart / Unknown job). */
  clearResults: () => void;
  /** False until sessionStorage hydrate finishes — gates EmptyRunHint to avoid flash. */
  sessionReady: boolean;
  /** Force Yahoo + calendar refresh and reload market meta for the desk strip. */
  refreshMarket: () => Promise<void>;
  /** Reload current ProductSpec so Intel / Product chips stay in sync after uploads. */
  refreshProduct: () => Promise<void>;
  years: number[];
};

const Ctx = createContext<Store | null>(null);
const LS_KEY = "gift-aif-forward-job";
/** Completed-run cache — survives SPA remounts within the browser tab. */
const SESSION_KEY = "gift-aif-forward-session";

type CachedSession = {
  v: 1;
  jobId: string;
  nPaths: number;
  pathId: number;
  summary: ForwardTestSummary;
};

function newClientRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readCachedSession(): CachedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSession;
    if (parsed?.v !== 1 || !parsed.summary || typeof parsed.summary !== "object") return null;
    if (!Array.isArray(parsed.summary.summary) || !parsed.summary.summary.length) return null;
    if (!Number.isFinite(parsed.nPaths) || parsed.nPaths < 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function slimSummaryForCache(summary: ForwardTestSummary): ForwardTestSummary {
  // Drop bulky date grids so sessionStorage stays under quota on large path counts.
  if (!summary.mc_matrix?.dates?.length) return summary;
  const { dates: _dates, ...mcRest } = summary.mc_matrix;
  return { ...summary, mc_matrix: { ...mcRest } };
}

function writeCachedSession(payload: CachedSession): boolean {
  if (typeof window === "undefined") return false;
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ ...payload, summary: slimSummaryForCache(payload.summary) }),
    );
    return true;
  } catch {
    /* quota / private mode — in-memory store still covers SPA tab switches */
    return false;
  }
}

function clearCachedSession() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function clearDeskResults(
  setSummary: (v: ForwardTestSummary | null) => void,
  setJobId: (v: string | null) => void,
  setPathDetail: (v: PathDetail | null) => void,
  setPathDetailError: (v: string | null) => void,
  setPathId: (v: number) => void,
  cacheQuotaWarnedRef?: { current: boolean },
) {
  setSummary(null);
  setJobId(null);
  setPathDetail(null);
  setPathDetailError(null);
  setPathId(1);
  if (cacheQuotaWarnedRef) cacheQuotaWarnedRef.current = false;
  clearCachedSession();
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

export function ForwardTestProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(false);
  const [market, setMarket] = useState<Store["market"]>(null);
  const [product, setProduct] = useState<ProductSpec | null>(null);
  const [nPaths, setNPathsState] = useState(DEFAULT_N_PATHS);
  const [sinceYear, setSinceYear] = useState(2001);
  const [jobId, setJobId] = useState<string | null>(null);
  const [summary, setSummary] = useState<ForwardTestSummary | null>(null);
  const [pathId, setPathId] = useState(1);
  const [pathDetail, setPathDetail] = useState<PathDetail | null>(null);
  const [pathDetailLoading, setPathDetailLoading] = useState(false);
  const [pathDetailError, setPathDetailError] = useState<string | null>(null);
  const [pathRetryToken, setPathRetryToken] = useState(0);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const runGenRef = useRef(0);
  /** Sync lock — React state `running` is too slow to block double-clicks. */
  const runningLockRef = useRef(false);
  const jobIdRef = useRef<string | null>(null);
  const nPathsRef = useRef(nPaths);
  const intentionalCancelRef = useRef(false);
  const restoredSessionRef = useRef(false);
  const summaryRef = useRef<ForwardTestSummary | null>(null);
  const cacheQuotaWarnedRef = useRef(false);

  useEffect(() => {
    jobIdRef.current = jobId;
  }, [jobId]);

  useEffect(() => {
    nPathsRef.current = nPaths;
  }, [nPaths]);

  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    const cached = readCachedSession();
    if (cached) {
      restoredSessionRef.current = true;
      setSummary(cached.summary);
      setJobId(cached.jobId || null);
      setNPathsState(clampNPaths(cached.nPaths));
      setPathId(Math.max(1, Math.trunc(cached.pathId) || 1));
    }
    setSessionReady(true);

    void (async () => {
      try {
        // Non-blocking wake: apply horizon meta as soon as sync returns; do not wait on it.
        void client
          .sync()
          .then((s) => {
            if (s?.market && isDeskHorizonMeta(s.market as { simulation_end?: string; simulation_end_days?: number })) {
              setMarket(s.market as NonNullable<Store["market"]>);
            }
          })
          .catch(() => keepApiAwake());
        const [m, p] = await Promise.all([client.marketMeta(), client.currentProduct()]);
        // If product tenure / MC path count moved, force a fresh meta read.
        if (
          (p?.tenure_days != null &&
            m?.tenure_days != null &&
            Number(p.tenure_days) !== Number(m.tenure_days)) ||
          (p?.n_paths != null &&
            m?.n_paths != null &&
            Number(p.n_paths) !== Number(m.n_paths))
        ) {
          const m2 = await client.marketMeta();
          setMarket(m2);
        } else {
          setMarket(m);
        }
        setProduct(p);
        // Keep restored path count when a finished run is cached in this tab.
        if (!restoredSessionRef.current) {
          if (p?.n_paths != null) setNPathsState(clampNPaths(Number(p.n_paths)));
          else if (m?.n_paths != null) setNPathsState(clampNPaths(Number(m.n_paths)));
        }
        // Dynamic as-of year from latest Nifty session (not a hardcoded 2001 default).
        if (m?.last_date) {
          const y = Number(String(m.last_date).slice(0, 4));
          if (Number.isFinite(y) && y >= 2001) setSinceYear(y);
        }
        // Drop in-progress job pointer only — completed runs live in sessionStorage.
        try {
          localStorage.removeItem(LS_KEY);
        } catch {
          /* ignore */
        }
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  // Re-pull desk horizon meta when the tab becomes visible and strip looks historical-only.
  useEffect(() => {
    const refreshIfStale = () => {
      if (document.visibilityState !== "visible") return;
      if (isDeskHorizonMeta(market)) return;
      void client
        .marketMeta()
        .then((m) => {
          if (isDeskHorizonMeta(m)) setMarket(m);
        })
        .catch(() => undefined);
    };
    document.addEventListener("visibilitychange", refreshIfStale);
    refreshIfStale();
    return () => document.removeEventListener("visibilitychange", refreshIfStale);
  }, [market]);

  // Keep Render warm while the desk tab is open (free tier sleeps after ~15 min idle).
  useEffect(() => {
    let cancelled = false;
    const ping = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      void keepApiAwake();
    };
    ping();
    const id = window.setInterval(ping, 4 * 60_000);
    const onVis = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Product uploads already clear results in `upload`. Do not auto-wipe a finished
  // run when ProductSpec is refreshed on tab changes (e.g. Logic Atlas) — fingerprint
  // drift on n_paths / legs would otherwise flash EmptyRunHint across the desk.

  // Browser refresh / tab close → stop the one active simulation cleanly (no zombie cancel race).
  useEffect(() => {
    const stopOnUnload = () => {
      if (!runningLockRef.current) return;
      const jid = jobIdRef.current;
      intentionalCancelRef.current = true;
      runGenRef.current += 1;
      runningLockRef.current = false;
      localStorage.removeItem(LS_KEY);
      const payload = JSON.stringify({
        job_id: jid,
        reason: "Cancelled — browser refreshed or closed.",
      });
      try {
        const origin = (process.env.NEXT_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");
        const url = origin ? `${origin}/api/forwardtest/cancel` : "/api/forwardtest/cancel";
        if (navigator.sendBeacon) {
          navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
        } else {
          void fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true,
          });
        }
      } catch {
        /* best-effort */
      }
    };
    window.addEventListener("pagehide", stopOnUnload);
    window.addEventListener("beforeunload", stopOnUnload);
    return () => {
      window.removeEventListener("pagehide", stopOnUnload);
      window.removeEventListener("beforeunload", stopOnUnload);
    };
  }, []);

  const setNPaths = useCallback((n: number) => {
    if (runningLockRef.current) {
      // One simulation at a time — ignore N changes mid-run.
      return;
    }
    const next = clampNPaths(n);
    // Same count — keep current results; do not flash EmptyRunHint.
    if (next === nPathsRef.current) return;
    setNPathsState(next);
    // Changing path count invalidates the on-screen book until the next Run.
    setSummary(null);
    setJobId(null);
    setPathDetail(null);
    setPathDetailError(null);
    setPathId(1);
    setError(null);
    clearCachedSession();
    cacheQuotaWarnedRef.current = false;
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const years = useMemo(() => {
    if (summary) {
      return Array.from(new Set(summary.summary.map((s) => s.year))).sort((a, b) => a - b);
    }
    if (market?.last_date) {
      const y = Number(String(market.last_date).slice(0, 4));
      if (Number.isFinite(y) && y >= 2001) return [y];
    }
    return [new Date().getFullYear()];
  }, [summary, market]);

  const filteredSummary = useMemo(() => {
    if (!summary) return [];
    return summary.summary;
  }, [summary]);

  const filteredYearly = useMemo(() => {
    if (!summary) return [];
    return summary.yearly;
  }, [summary]);

  const filteredKpis = useMemo(() => {
    if (!filteredSummary.length) return summary?.kpis ?? null;
    const totals = filteredSummary.map((s) => s.total);
    const irrs = filteredSummary.map((s) => s.irr);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const sorted = [...totals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const irrsSorted = [...irrs].sort((a, b) => a - b);
    const imid = Math.floor(irrsSorted.length / 2);
    const medianIrr =
      irrsSorted.length % 2 ? irrsSorted[imid] : (irrsSorted[imid - 1] + irrsSorted[imid]) / 2;
    return {
      mean_total: mean(totals),
      median_total: median,
      min_total: Math.min(...totals),
      max_total: Math.max(...totals),
      mean_irr: mean(irrs),
      median_irr: medianIrr,
      hit_rate_gt_100: totals.filter((t) => t > (summary?.product.principal_cr ?? 100)).length / totals.length,
      mean_abs_nifty_ret: mean(filteredSummary.map((s) => s.abs_nifty_ret)),
    };
  }, [filteredSummary, summary]);

  useEffect(() => {
    if (!summary) return;
    const exists = summary.summary.some((s) => s.path_id === pathId);
    if (!exists) setPathId(summary.summary[0]?.path_id ?? 1);
  }, [summary, pathId]);

  // Keep session cache in sync when the user picks another path.
  useEffect(() => {
    if (!sessionReady || !summary) return;
    const ok = writeCachedSession({
      v: 1,
      jobId: jobId ?? "",
      nPaths: nPathsRef.current,
      pathId,
      summary,
    });
    if (!ok) {
      if (!cacheQuotaWarnedRef.current) {
        cacheQuotaWarnedRef.current = true;
        setError(
          "This run is too large to cache in the browser tab. Avoid refresh — switch tabs freely while this session stays open.",
        );
      }
    } else {
      cacheQuotaWarnedRef.current = false;
    }
  }, [sessionReady, summary, jobId, pathId]);

  useEffect(() => {
    if (!jobId || !summary || running) {
      setPathDetailLoading(false);
      return;
    }
    if (!summary.summary.some((s) => s.path_id === pathId)) {
      setPathDetailLoading(false);
      return;
    }

    let cancelled = false;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const expectedJob = jobId;
    const expectedPath = pathId;

    void (async () => {
      setPathDetailLoading(true);
      setPathDetailError(null);
      const maxAttempts = 10;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (cancelled) return;
        try {
          const d = await client.pathDetail(expectedJob, expectedPath);
          if (cancelled) return;
          if (jobId !== expectedJob || pathId !== expectedPath) return;
          setPathDetail(d);
          setPathDetailError(null);
          setPathDetailLoading(false);
          return;
        } catch (e) {
          if (cancelled) return;
          const msg = e instanceof Error ? e.message : String(e);
          if (/superseded by a newer run/i.test(msg)) {
            clearDeskResults(setSummary, setJobId, setPathDetail, setPathDetailError, setPathId, cacheQuotaWarnedRef);
            setPathDetailLoading(false);
            return;
          }
          // Free hosts recycle memory — keep cached summary so Analytics tabs stay filled.
          if (/unknown forward test job|Unknown job|no longer on the server/i.test(msg)) {
            setJobId(null);
            setPathDetail(null);
            setPathDetailError(
              "This run is no longer held on the server (common after free-host sleep). Path Summary stays available — click Run again for path ledgers and charts.",
            );
            setPathDetailLoading(false);
            try {
              localStorage.removeItem(LS_KEY);
            } catch {
              /* ignore */
            }
            if (summary) {
              writeCachedSession({
                v: 1,
                jobId: "",
                nPaths: nPathsRef.current,
                pathId: expectedPath,
                summary,
              });
            }
            return;
          }
          if (isTransientPathDetailError(msg) && attempt < maxAttempts - 1) {
            await sleep(Math.min(4_000, 400 * 1.35 ** attempt));
            continue;
          }
          setPathDetailError(
            isTransientPathDetailError(msg)
              ? "Still preparing this path ledger. It will appear automatically in a moment."
              : msg,
          );
          setPathDetailLoading(false);
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId, pathId, summary, pathRetryToken, running]);

  const retryPathDetail = useCallback(() => {
    setPathDetailError(null);
    setPathRetryToken((t) => t + 1);
  }, []);

  const upload = useCallback(async (file: File) => {
    setError(null);
    intentionalCancelRef.current = true;
    runGenRef.current += 1;
    runningLockRef.current = false;
    setRunning(false);
    setProgress(0);
    setMessage("");
    void client.cancelForwardTest(jobId, "product_upload");
    try {
      const res = await client.uploadProduct(file);
      setProduct(res.product);
      if (res.product?.n_paths != null) setNPathsState(clampNPaths(Number(res.product.n_paths)));
      clearDeskResults(setSummary, setJobId, setPathDetail, setPathDetailError, setPathId, cacheQuotaWarnedRef);
      if (res.market && isDeskHorizonMeta(res.market)) {
        setMarket(res.market);
      } else {
        const m = await client.marketMeta();
        setMarket(m);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      intentionalCancelRef.current = false;
    }
  }, [jobId]);

  const refreshMarket = useCallback(async () => {
    const synced = await client.sync(true);
    if (!synced.ok) {
      const detail =
        typeof synced.market_sync?.error === "string"
          ? synced.market_sync.error
          : "Market sync did not complete";
      throw new Error(detail);
    }
    const m = await client.marketMeta();
    setMarket(m);
  }, []);

  const refreshProduct = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([client.currentProduct(), client.marketMeta()]);
      setProduct(p);
      // Never overwrite path count for a finished book (Logic Atlas remounts call this).
      if (p?.n_paths != null && !summaryRef.current) {
        setNPathsState(clampNPaths(Number(p.n_paths)));
      }
      if (isDeskHorizonMeta(m)) setMarket(m);
    } catch {
      // Keep last known product if API is waking / offline.
    }
  }, []);

  const run = useCallback(async (overrideNPaths?: number) => {
    // Hard single-flight: ignore double-clicks / overlapping Run presses.
    if (runningLockRef.current) return;
    runningLockRef.current = true;
    intentionalCancelRef.current = false;

    const runN = clampNPaths(overrideNPaths ?? nPaths);
    if (overrideNPaths != null && runN !== nPaths) {
      setNPathsState(runN);
    }

    const gen = ++runGenRef.current;
    const clientRunId = newClientRunId();
    // Keep prior summary on screen until the new run finishes — never flash EmptyRunHint mid-wake.
    const priorSummary = summaryRef.current;
    setError(null);
    setPathDetailError(null);
    setPathDetail(null);
    setRunning(true);
    setProgress(0);
    setMessage("Waking API…");
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const startedAt = Date.now();
    const maxWallMs = 45 * 60_000;
    let pollSoftFails = 0;
    try {
      // Cold Render: wake first so the Run POST is not raced by proxy retries.
      setMessage("Waking API…");
      await keepApiAwake();
      if (gen !== runGenRef.current) return;
      setMessage("Starting simulation…");
      const { job_id } = await client.runForwardTest(runN, clientRunId);
      if (gen !== runGenRef.current) return;
      setJobId(job_id);
      jobIdRef.current = job_id;
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ jobId: job_id, nPaths: runN }));
      } catch {
        /* ignore */
      }
      setMessage("Queued — starting paths…");
      for (;;) {
        if (gen !== runGenRef.current) return;
        if (Date.now() - startedAt > maxWallMs) {
          setError("Forward test timed out waiting for the server. Please try again.");
          setJobId(null);
          try {
            localStorage.removeItem(LS_KEY);
          } catch {
            /* ignore */
          }
          break;
        }
        let st: Awaited<ReturnType<typeof client.jobStatus>>;
        try {
          st = await client.jobStatus(job_id);
          pollSoftFails = 0;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (
            isTransientNetworkError(msg) ||
            /no longer on the server|Unknown job|unknown forward test job/i.test(msg)
          ) {
            pollSoftFails += 1;
            if (pollSoftFails <= 12) {
              setMessage("Reconnecting to the API…");
              void keepApiAwake();
              await sleep(Math.min(4_000, 600 * pollSoftFails));
              continue;
            }
          }
          throw e;
        }
        if (gen !== runGenRef.current) return;
        setProgress(st.progress);
        const cleanMsg = String(st.message || "")
          .replace(/\x1b\[[0-9;]*m/g, "")
          .replace(/tqdm/gi, "")
          .trim();
        setMessage(cleanMsg || "Computing paths…");
        if (st.status === "done") {
          let s: ForwardTestSummary | null = null;
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              s = await client.summary(job_id);
              break;
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              if (attempt < 3 && isTransientNetworkError(msg)) {
                void keepApiAwake();
                await sleep(800 * (attempt + 1));
                continue;
              }
              throw e;
            }
          }
          if (!s) throw new Error("Summary was empty after a successful run.");
          if (gen !== runGenRef.current) return;
          const resultN = s.n_paths ?? s.path_count;
          let cachedN = runN;
          if (resultN != null && Number(resultN) !== runN) {
            const serverN = Number(resultN);
            // Deploy hosts may clamp path count below the desk request — adopt server value.
            if (Number.isFinite(serverN) && serverN > 0 && serverN <= runN) {
              cachedN = clampNPaths(serverN);
              setNPathsState(cachedN);
            } else {
              setError("Received results for a different path count. Please run again.");
              setJobId(null);
              try {
                localStorage.removeItem(LS_KEY);
              } catch {
                /* ignore */
              }
              break;
            }
          }
          setSummary(s);
          setPathId(1);
          const cached = writeCachedSession({
            v: 1,
            jobId: job_id,
            nPaths: cachedN,
            pathId: 1,
            summary: s,
          });
          if (!cached) {
            setError(
              "Results loaded, but this run is too large to cache in the browser tab. Avoid refresh while working.",
            );
          }
          // Drop in-progress pointer; completed payload is in sessionStorage for this tab.
          try {
            localStorage.removeItem(LS_KEY);
          } catch {
            /* ignore */
          }
          break;
        }
        if (st.status === "cancelled") {
          if (gen !== runGenRef.current || intentionalCancelRef.current) {
            setError(null);
            setJobId(null);
            try {
              localStorage.removeItem(LS_KEY);
            } catch {
              /* ignore */
            }
            break;
          }
          // Unexpected cancel — keep prior book if we still have it.
          setError("Simulation stopped. Only one run can be active — click Run once and wait for it to finish.");
          setJobId(null);
          if (priorSummary && !summaryRef.current) setSummary(priorSummary);
          try {
            localStorage.removeItem(LS_KEY);
          } catch {
            /* ignore */
          }
          break;
        }
        if (st.status === "error") {
          setError(st.error || st.message);
          setJobId(null);
          if (priorSummary) setSummary(priorSummary);
          try {
            localStorage.removeItem(LS_KEY);
          } catch {
            /* ignore */
          }
          break;
        }
        await sleep(st.progress < 5 ? 180 : 280);
      }
    } catch (e) {
      if (gen !== runGenRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setJobId(null);
      // Restore prior finished book if the new run never delivered a summary.
      if (priorSummary) setSummary(priorSummary);
      try {
        localStorage.removeItem(LS_KEY);
      } catch {
        /* ignore */
      }
    } finally {
      if (gen === runGenRef.current) {
        runningLockRef.current = false;
        setRunning(false);
        intentionalCancelRef.current = false;
      }
    }
  }, [nPaths]);

  const clearResults = useCallback(() => {
    clearDeskResults(setSummary, setJobId, setPathDetail, setPathDetailError, setPathId);
    setError(null);
    setMessage("");
    setProgress(0);
  }, []);

  const value: Store = {
    dark,
    setDark,
    market,
    product,
    nPaths,
    setNPaths,
    sinceYear,
    setSinceYear,
    jobId,
    summary,
    filteredSummary,
    filteredYearly,
    filteredKpis,
    pathId,
    setPathId,
    pathDetail,
    pathDetailLoading,
    pathDetailError,
    retryPathDetail,
    running,
    progress,
    message,
    error,
    setError,
    upload,
    run,
    clearResults,
    sessionReady,
    refreshMarket,
    refreshProduct,
    years,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useForwardTest() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useForwardTest outside provider");
  return v;
}
