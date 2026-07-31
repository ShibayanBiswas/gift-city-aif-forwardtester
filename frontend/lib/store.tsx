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
  Frequency,
  PathDetail,
  PathSummary,
  ProductSpec,
  client,
  isDeskHorizonMeta,
  isTransientPathDetailError,
  keepApiAwake,
} from "@/lib/api";

type Store = {
  dark: boolean;
  setDark: (v: boolean) => void;
  market: Awaited<ReturnType<typeof client.marketMeta>> | null;
  product: ProductSpec | null;
  frequency: Frequency;
  setFrequency: (f: Frequency) => void;
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
  run: () => Promise<void>;
  /** Force Yahoo + calendar refresh and reload market meta for the desk strip. */
  refreshMarket: () => Promise<void>;
  /** Reload current ProductSpec so Intel / Product chips stay in sync after uploads. */
  refreshProduct: () => Promise<void>;
  years: number[];
};

const Ctx = createContext<Store | null>(null);
const LS_KEY = "gift-aif-forward-job";

function newClientRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function productFingerprint(p: {
  principal_cr?: number;
  tenure_days?: number;
  simulation_end_days?: number | null;
  n_obs?: number;
  observation_months?: number[];
  legs?: unknown[];
  roll_rate?: number;
  fee_rate?: number;
  cash_rate?: number;
  gsec_rate?: number;
} | null | undefined): string {
  if (!p) return "";
  return [
    p.principal_cr,
    p.tenure_days,
    p.simulation_end_days,
    p.n_obs,
    (p.observation_months ?? []).join(","),
    Array.isArray(p.legs) ? p.legs.length : 0,
    p.roll_rate,
    p.fee_rate,
    p.cash_rate,
    p.gsec_rate,
  ].join("|");
}

function productsMatch(
  live: Parameters<typeof productFingerprint>[0],
  job: Parameters<typeof productFingerprint>[0],
): boolean {
  if (!live || !job) return false;
  return productFingerprint(live) === productFingerprint(job);
}

function clearDeskResults(
  setSummary: (v: ForwardTestSummary | null) => void,
  setJobId: (v: string | null) => void,
  setPathDetail: (v: PathDetail | null) => void,
  setPathDetailError: (v: string | null) => void,
  setPathId: (v: number) => void,
) {
  setSummary(null);
  setJobId(null);
  setPathDetail(null);
  setPathDetailError(null);
  setPathId(1);
  localStorage.removeItem(LS_KEY);
}

export function ForwardTestProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(false);
  const [market, setMarket] = useState<Store["market"]>(null);
  const [product, setProduct] = useState<ProductSpec | null>(null);
  const [frequency, setFrequencyState] = useState<Frequency>("daily");
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
  const runGenRef = useRef(0);
  /** Sync lock — React state `running` is too slow to block double-clicks. */
  const runningLockRef = useRef(false);
  const jobIdRef = useRef<string | null>(null);
  const intentionalCancelRef = useRef(false);

  useEffect(() => {
    jobIdRef.current = jobId;
  }, [jobId]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
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
        // If product horizon moved (e.g. legacy 7300 → 3650), force a fresh meta read.
        if (
          p?.simulation_end_days != null &&
          m?.simulation_end_days != null &&
          Number(p.simulation_end_days) !== Number(m.simulation_end_days)
        ) {
          const m2 = await client.marketMeta();
          setMarket(m2);
        } else {
          setMarket(m);
        }
        setProduct(p);
        // Dynamic as-of year from latest Nifty session (not a hardcoded 2001 default).
        if (m?.last_date) {
          const y = Number(String(m.last_date).slice(0, 4));
          if (Number.isFinite(y) && y >= 2001) setSinceYear(y);
        }
        const saved = localStorage.getItem(LS_KEY);
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as { jobId: string; frequency?: Frequency };
            const jid = parsed.jobId;
            const st = await client.jobStatus(jid);
            if (st.status === "done") {
              const s = await client.summary(jid);
              if (!productsMatch(p, s.product)) {
                localStorage.removeItem(LS_KEY);
              } else {
                setJobId(jid);
                setSummary(s);
                setFrequencyState(s.frequency);
                setPathId(1);
              }
            } else if (st.status === "queued" || st.status === "running") {
              // Resume the in-flight job after a soft navigation (not a hard refresh cancel).
              setJobId(jid);
              if (parsed.frequency) setFrequencyState(parsed.frequency);
              setRunning(true);
              runningLockRef.current = true;
              setProgress(st.progress);
              setMessage(st.message || "Resuming simulation…");
              const gen = ++runGenRef.current;
              void (async () => {
                const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
                const startedAt = Date.now();
                try {
                  for (;;) {
                    if (gen !== runGenRef.current) return;
                    if (Date.now() - startedAt > 45 * 60_000) {
                      setError("Forward test timed out waiting for the server. Please try again.");
                      break;
                    }
                    const cur = await client.jobStatus(jid);
                    if (gen !== runGenRef.current) return;
                    setProgress(cur.progress);
                    setMessage(String(cur.message || "Computing paths…").replace(/\x1b\[[0-9;]*m/g, "").trim());
                    if (cur.status === "done") {
                      const s = await client.summary(jid);
                      if (gen !== runGenRef.current) return;
                      setSummary(s);
                      setPathId(1);
                      localStorage.setItem(LS_KEY, JSON.stringify({ jobId: jid, frequency: s.frequency }));
                      break;
                    }
                    if (cur.status === "cancelled") {
                      if (!intentionalCancelRef.current) {
                        setError(null);
                      }
                      localStorage.removeItem(LS_KEY);
                      setJobId(null);
                      break;
                    }
                    if (cur.status === "error") {
                      setError(cur.error || cur.message);
                      localStorage.removeItem(LS_KEY);
                      setJobId(null);
                      break;
                    }
                    await sleep(280);
                  }
                } catch (e) {
                  if (gen === runGenRef.current) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                } finally {
                  if (gen === runGenRef.current) {
                    runningLockRef.current = false;
                    setRunning(false);
                    intentionalCancelRef.current = false;
                  }
                }
              })();
            } else {
              localStorage.removeItem(LS_KEY);
            }
          } catch {
            localStorage.removeItem(LS_KEY);
          }
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

  // Any Product Input change invalidates a prior run that used a different book / horizon.
  useEffect(() => {
    if (!product || !summary?.product) return;
    if (productsMatch(product, summary.product)) return;
    clearDeskResults(setSummary, setJobId, setPathDetail, setPathDetailError, setPathId);
  }, [product, summary]);

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

  const setFrequency = useCallback((f: Frequency) => {
    if (runningLockRef.current) {
      // One simulation at a time — ignore frequency changes mid-run.
      return;
    }
    setFrequencyState(f);
    // Changing frequency invalidates the on-screen book until the next Run.
    setSummary(null);
    setJobId(null);
    setPathDetail(null);
    setPathDetailError(null);
    setPathId(1);
    setError(null);
    localStorage.removeItem(LS_KEY);
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
    return summary.summary.filter((s) => s.year >= sinceYear);
  }, [summary, sinceYear]);

  const filteredYearly = useMemo(() => {
    if (!summary) return [];
    return summary.yearly.filter((y) => y.year >= sinceYear);
  }, [summary, sinceYear]);

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
          if (/unknown forward test job|Unknown job|superseded by a newer run/i.test(msg)) {
            clearDeskResults(setSummary, setJobId, setPathDetail, setPathDetailError, setPathId);
            setPathDetailLoading(false);
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
      clearDeskResults(setSummary, setJobId, setPathDetail, setPathDetailError, setPathId);
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
      if (isDeskHorizonMeta(m)) setMarket(m);
    } catch {
      // Keep last known product if API is waking / offline.
    }
  }, []);

  const run = useCallback(async () => {
    // Hard single-flight: ignore double-clicks / overlapping Run presses.
    if (runningLockRef.current) return;
    runningLockRef.current = true;
    intentionalCancelRef.current = false;

    const gen = ++runGenRef.current;
    const clientRunId = newClientRunId();
    setError(null);
    setPathDetailError(null);
    setRunning(true);
    setProgress(0);
    setMessage("Waking API…");
    clearDeskResults(setSummary, setJobId, setPathDetail, setPathDetailError, setPathId);
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const startedAt = Date.now();
    const maxWallMs = 45 * 60_000;
    try {
      // Cold Render: wake first so the Run POST is not raced by proxy retries.
      setMessage("Waking API…");
      await keepApiAwake();
      if (gen !== runGenRef.current) return;
      setMessage("Starting simulation…");
      const { job_id } = await client.runForwardTest(frequency, clientRunId);
      if (gen !== runGenRef.current) return;
      setJobId(job_id);
      jobIdRef.current = job_id;
      localStorage.setItem(LS_KEY, JSON.stringify({ jobId: job_id, frequency }));
      setMessage("Queued — starting paths…");
      for (;;) {
        if (gen !== runGenRef.current) return;
        if (Date.now() - startedAt > maxWallMs) {
          setError("Forward test timed out waiting for the server. Please try again.");
          setJobId(null);
          localStorage.removeItem(LS_KEY);
          break;
        }
        let st: Awaited<ReturnType<typeof client.jobStatus>>;
        try {
          st = await client.jobStatus(job_id);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/timed out|PATH_DETAIL_TIMEOUT/i.test(msg)) {
            await sleep(800);
            continue;
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
          const s = await client.summary(job_id);
          if (gen !== runGenRef.current) return;
          if (s.frequency !== frequency) {
            setError("Received results for a different path frequency. Please run again.");
            setJobId(null);
            localStorage.removeItem(LS_KEY);
            break;
          }
          setSummary(s);
          setPathId(1);
          localStorage.setItem(LS_KEY, JSON.stringify({ jobId: job_id, frequency }));
          break;
        }
        if (st.status === "cancelled") {
          if (gen !== runGenRef.current || intentionalCancelRef.current) {
            setError(null);
            setJobId(null);
            localStorage.removeItem(LS_KEY);
            break;
          }
          // Unexpected cancel (should be rare with single-flight + idempotency).
          setError("Simulation stopped. Only one run can be active — click Run once and wait for it to finish.");
          setJobId(null);
          localStorage.removeItem(LS_KEY);
          break;
        }
        if (st.status === "error") {
          setError(st.error || st.message);
          setJobId(null);
          localStorage.removeItem(LS_KEY);
          break;
        }
        await sleep(st.progress < 5 ? 180 : 280);
      }
    } catch (e) {
      if (gen !== runGenRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setJobId(null);
      localStorage.removeItem(LS_KEY);
    } finally {
      if (gen === runGenRef.current) {
        runningLockRef.current = false;
        setRunning(false);
        intentionalCancelRef.current = false;
      }
    }
  }, [frequency]);

  const value: Store = {
    dark,
    setDark,
    market,
    product,
    frequency,
    setFrequency,
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
