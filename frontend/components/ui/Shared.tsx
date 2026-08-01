"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, ChevronDown, Clock3, Hash, Loader2, RefreshCw, Search, TrendingUp, X } from "lucide-react";
import { useForwardTest } from "@/lib/store";
import type { PathSummary } from "@/lib/api";
import { FREQUENCY_LABELS, formatDeskDate, formatNum, formatPct } from "@/lib/api";

function calendarDays(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00`);
  const b = new Date(`${end}T00:00:00`);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

/** Match path id, year, dates, trading days, or Nifty levels (multi-token AND). */
function pathMatchesQuery(path: PathSummary, raw: string): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  const cal = calendarDays(path.start, path.end);
  const startN = Math.round(path.start_nifty ?? 0);
  const endN = Math.round(path.end_nifty ?? 0);
  const hay = [
    `path ${path.path_id}`,
    String(path.year),
    path.start,
    path.end,
    path.start.replace(/-/g, ""),
    path.end.replace(/-/g, ""),
    path.start.slice(0, 7),
    path.end.slice(0, 7),
    String(path.n_trading_days ?? ""),
    String(cal),
    formatNum(path.start_nifty, 0),
    formatNum(path.end_nifty, 0),
    String(startN),
    String(endN),
  ]
    .join(" ")
    .toLowerCase();

  return q.split(/\s+/).every((token) => {
    const pathToken = token.match(/^path\s*(\d+)$/i) ?? token.match(/^#(\d+)$/);
    if (pathToken) return path.path_id === Number(pathToken[1]);

    if (/^\d+$/.test(token)) {
      const n = Number(token);
      // Path id exact / prefix first — avoids Nifty "10" noise when jumping to Path 10
      if (path.path_id === n || String(path.path_id).startsWith(token)) return true;
      if (path.year === n) return true;
      if (path.start.startsWith(token) || path.end.startsWith(token)) return true;
      // Longer digits can mean a Nifty level or trading-day count
      if (token.length >= 4) {
        if (path.n_trading_days === n || cal === n) return true;
        if (String(startN).includes(token) || String(endN).includes(token)) return true;
      }
      return false;
    }

    return hay.includes(token);
  });
}

function rankPathMatch(path: PathSummary, raw: string): number {
  const q = raw.trim().toLowerCase();
  if (!q) return path.path_id;
  const first = q.split(/\s+/)[0] ?? "";
  const n = Number(first.replace(/^#/, "").replace(/^path\s*/i, ""));
  if (Number.isFinite(n)) {
    if (path.path_id === n) return 0;
    if (String(path.path_id).startsWith(String(n))) return 1;
    if (path.year === n) return 2;
  }
  return 3;
}

function formatLongDate(iso: string): string {
  const desk = formatDeskDate(iso);
  if (desk === "—") return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return desk;
  const weekday = d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
  return `${weekday}, ${desk}`;
}

function PathMeta({ path }: { path: PathSummary }) {
  const cal = calendarDays(path.start, path.end);
  const items = [
    { icon: Hash, label: "Path", value: String(path.path_id) },
    { icon: CalendarDays, label: "Start Date", value: formatLongDate(path.start) },
    { icon: CalendarDays, label: "End Date", value: formatLongDate(path.end) },
    { icon: Clock3, label: "Trading Days", value: String(path.n_trading_days ?? "—") },
    { icon: Clock3, label: "Calendar Days", value: String(cal) },
    { icon: TrendingUp, label: "Start Nifty", value: formatNum(path.start_nifty, 2) },
    { icon: TrendingUp, label: "End Nifty", value: formatNum(path.end_nifty, 2) },
  ];
  return (
    <div className="mt-3 grid w-full gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-7">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <motion.div
            key={it.label}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -2, scale: 1.01 }}
            className="meta-chip"
          >
            <div className="flex items-center gap-1.5 text-[10px] tracking-[0.16em] text-[var(--ar-subtle)] font-ui">
              <Icon className="h-3 w-3 text-[var(--ar-gold-dark)]" />
              {it.label}
            </div>
            <p className="mt-1 font-display text-base tabular-nums text-[var(--ar-maroon)] leading-tight">{it.value}</p>
          </motion.div>
        );
      })}
    </div>
  );
}

/** Row height for virtualized path list — keep in sync with option padding. */
const OPTION_H = 124;
/** At least four full options visible without scrolling. */
const VISIBLE_OPTIONS = 4;
/** Caption + search field in the open menu chrome. */
const MENU_HEADER_H = 92;
/** Fixed open-menu list height — identical on every desk tab. */
const MENU_LIST_H = OPTION_H * VISIBLE_OPTIONS;
const VIRTUAL_WINDOW = VISIBLE_OPTIONS + 8;

export function PathSelect({
  className = "",
  showMeta = true,
}: {
  className?: string;
  showMeta?: boolean;
}) {
  const { filteredSummary, pathId, setPathId } = useForwardTest();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerWrapRef = useRef<HTMLDivElement>(null);
  const triggerBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const active = useMemo(
    () => filteredSummary.find((p) => p.path_id === pathId) ?? filteredSummary[0],
    [filteredSummary, pathId],
  );
  const visiblePaths = useMemo(() => {
    const matched = filteredSummary.filter((p) => pathMatchesQuery(p, query));
    if (!query.trim()) return matched;
    return [...matched].sort((a, b) => {
      const ra = rankPathMatch(a, query);
      const rb = rankPathMatch(b, query);
      if (ra !== rb) return ra - rb;
      return a.path_id - b.path_id;
    });
  }, [filteredSummary, query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerWrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (active && active.path_id !== pathId) setPathId(active.path_id);
  }, [active, pathId, setPathId]);

  useEffect(() => {
    if (!open) {
      setMenuBox(null);
      setQuery("");
      setScrollTop(0);
      return;
    }
    const place = () => {
      const btn = triggerBtnRef.current;
      if (!btn) return;
      const gap = 7;
      const menuH = MENU_HEADER_H + MENU_LIST_H;
      let r = btn.getBoundingClientRect();
      let spaceBelow = window.innerHeight - r.bottom - gap;

      // Prefer opening downward with room for exactly four options.
      if (spaceBelow < menuH) {
        const targetTop = 64;
        const delta = r.top - targetTop;
        if (delta > 4) {
          window.scrollBy(0, delta);
          r = btn.getBoundingClientRect();
          spaceBelow = window.innerHeight - r.bottom - gap;
        }
      }

      const spaceAbove = r.top - gap;
      const openUp = spaceBelow < menuH && spaceAbove > spaceBelow;
      const top = openUp
        ? Math.max(8, r.top - gap - menuH)
        : r.bottom + gap;
      setMenuBox({
        top: Math.max(8, Math.min(top, window.innerHeight - menuH - 8)),
        left: Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)),
        width: r.width,
      });
    };
    place();
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 40);
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      place();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    if (query.trim()) {
      listRef.current.scrollTop = 0;
      setScrollTop(0);
      return;
    }
    if (!active) return;
    const idx = visiblePaths.findIndex((p) => p.path_id === active.path_id);
    if (idx < 0) return;
    const top = Math.max(0, idx * OPTION_H - OPTION_H);
    listRef.current.scrollTop = top;
    setScrollTop(top);
  }, [open, active, visiblePaths, query]);

  if (!active) {
    return (
      <div className={`font-ui ${className}`}>
        <p className="text-sm text-[var(--ar-muted)]">No simulation paths available yet.</p>
      </div>
    );
  }

  const startIdx = Math.max(0, Math.floor(scrollTop / OPTION_H) - 2);
  const endIdx = Math.min(visiblePaths.length, startIdx + VIRTUAL_WINDOW);
  const slice = visiblePaths.slice(startIdx, endIdx);
  const padTop = startIdx * OPTION_H;
  const padBottom = Math.max(0, (visiblePaths.length - endIdx) * OPTION_H);
  const q = query.trim();

  const pickPath = (id: number) => {
    setPathId(id);
    setOpen(false);
  };

  const menu =
    open && menuBox
      ? createPortal(
          <AnimatePresence>
            <motion.div
              ref={menuRef}
              key="path-select-menu"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.99 }}
              transition={{ type: "spring", stiffness: 420, damping: 28 }}
              className="path-select-menu"
              style={{
                position: "fixed",
                top: menuBox.top,
                left: menuBox.left,
                width: menuBox.width,
                zIndex: 80,
              }}
            >
              <div
                className="border-b border-[var(--ar-border)] bg-[var(--ar-surface)] px-3 pb-2 pt-2"
                style={{ minHeight: MENU_HEADER_H }}
              >
                <div className="path-select-search">
                  <Search className="path-select-search-icon h-3.5 w-3.5" aria-hidden />
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        if (query) setQuery("");
                        else setOpen(false);
                        return;
                      }
                      if (e.key === "Enter" && visiblePaths[0]) {
                        e.preventDefault();
                        pickPath(visiblePaths[0].path_id);
                      }
                    }}
                    placeholder="Search Path · Year · Date · Nifty…"
                    aria-label="Search simulation paths"
                    className="path-select-search-input"
                  />
                  {q ? (
                    <button
                      type="button"
                      className="path-select-search-clear"
                      aria-label="Clear path search"
                      onClick={() => {
                        setQuery("");
                        searchRef.current?.focus();
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                <p className="mt-1.5 text-[10px] tracking-[0.18em] text-[var(--ar-subtle)]">
                  {q
                    ? `${visiblePaths.length} Match${visiblePaths.length === 1 ? "" : "es"} · ${filteredSummary.length} Total`
                    : `${filteredSummary.length} Paths · Showing 4 At A Time · Start · End · Days · Nifty`}
                </p>
              </div>
              <div
                ref={listRef}
                className="path-select-list overflow-auto overscroll-contain"
                style={{ height: MENU_LIST_H, maxHeight: MENU_LIST_H }}
                onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
              >
                {visiblePaths.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
                    <p className="font-display text-lg text-[var(--ar-maroon)]">No Paths Match</p>
                    <p className="text-xs text-[var(--ar-muted)]">
                      Try a path number, year, date, or Nifty level
                    </p>
                  </div>
                ) : (
                  <>
                    <div style={{ height: padTop }} />
                    <ul>
                      {slice.map((p) => {
                        const selected = p.path_id === active.path_id;
                        const cal = calendarDays(p.start, p.end);
                        return (
                          <li key={p.path_id} style={{ height: OPTION_H }} className="box-border">
                            <button
                              type="button"
                              onClick={() => pickPath(p.path_id)}
                              className={`path-select-option h-full ${selected ? "path-select-option-active" : ""}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-display text-base text-[var(--ar-maroon)]">Path {p.path_id}</span>
                                <span className="text-[10px] tracking-wide text-[var(--ar-subtle)]">{p.year}</span>
                              </div>
                              <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-3 lg:grid-cols-6">
                                <div className="path-partition">
                                  <span>Start Date</span>
                                  <strong>{formatDeskDate(p.start)}</strong>
                                </div>
                                <div className="path-partition">
                                  <span>End Date</span>
                                  <strong>{formatDeskDate(p.end)}</strong>
                                </div>
                                <div className="path-partition">
                                  <span>Trading Days</span>
                                  <strong>{p.n_trading_days ?? "—"}</strong>
                                </div>
                                <div className="path-partition">
                                  <span>Calendar Days</span>
                                  <strong>{cal}</strong>
                                </div>
                                <div className="path-partition">
                                  <span>Start Nifty</span>
                                  <strong>{formatNum(p.start_nifty, 0)}</strong>
                                </div>
                                <div className="path-partition">
                                  <span>End Nifty</span>
                                  <strong>{formatNum(p.end_nifty, 0)}</strong>
                                </div>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <div style={{ height: padBottom }} />
                  </>
                )}
              </div>
            </motion.div>
          </AnimatePresence>,
          document.body,
        )
      : null;

  return (
    <div className={`w-full space-y-3 font-ui ${className}`}>
      <div ref={triggerWrapRef} className="relative w-full">
        <label className="mb-1.5 block text-[10px] tracking-[0.2em] text-[var(--ar-subtle)]">
          Select Simulation Path
        </label>
        <button
          ref={triggerBtnRef}
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="path-select-trigger group w-full text-left"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] tracking-[0.18em] text-[var(--ar-subtle)]">Active Path</p>
              <p className="font-display text-xl text-[var(--ar-maroon)] md:text-2xl">Path {active.path_id}</p>
              <p className="mt-1 truncate text-xs text-[var(--ar-muted)] md:text-sm">
                {formatLongDate(active.start)} → {formatLongDate(active.end)}
              </p>
            </div>
            <motion.span animate={{ rotate: open ? 180 : 0 }} className="mt-1 shrink-0 text-[var(--ar-gold-dark)]">
              <ChevronDown className="h-5 w-5" />
            </motion.span>
          </div>
          <div className="mt-3 flex w-full flex-wrap gap-2">
            <span className="path-pill">{active.n_trading_days ?? "—"} Trading Days</span>
            <span className="path-pill">{calendarDays(active.start, active.end)} Calendar Days</span>
            <span className="path-pill">Start Nifty {formatNum(active.start_nifty, 0)}</span>
            <span className="path-pill">End Nifty {formatNum(active.end_nifty, 0)}</span>
          </div>
        </button>
        {menu}
      </div>

      {showMeta ? <PathMeta path={active} /> : null}
    </div>
  );
}

export function PathDetailGate({
  children,
  loadingLabel = "Loading path detail…",
}: {
  children: React.ReactNode;
  loadingLabel?: string;
}) {
  const { pathDetail, pathDetailLoading, pathDetailError, retryPathDetail, pathId, running } = useForwardTest();
  const matched = pathDetail != null && pathDetail.path_id === pathId;

  // While a run is in flight, detail is fetching, or stale path data is on screen —
  // never show the wrong path's ledger under the new Path N title.
  if (!matched && (pathDetailLoading || running || pathDetail != null)) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="ar-panel ar-band flex items-center justify-center gap-3 p-12 text-sm text-[var(--ar-muted)] font-ui"
      >
        <Loader2 className="h-5 w-5 animate-spin text-[var(--ar-maroon)]" />
        {running ? "Waiting For Forward Test To Finish…" : loadingLabel}
      </motion.div>
    );
  }

  if (!matched && pathDetailError) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="ar-panel ar-band p-8 text-center"
      >
        <p className="text-xs tracking-[0.2em] text-[var(--ar-subtle)] font-ui">Path {pathId}</p>
        <h3 className="mt-2 font-display text-2xl text-[var(--ar-maroon)]">Preparing Path Ledger</h3>
        <p className="mx-auto mt-2 max-w-lg text-sm text-[var(--ar-muted)] font-ui">
          {pathDetailError}
        </p>
        <button
          type="button"
          onClick={retryPathDetail}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-[var(--ar-maroon)] px-4 py-2 text-xs font-semibold text-white"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh Path
        </button>
      </motion.div>
    );
  }

  if (!matched) {
    return (
      <p className="text-sm text-[var(--ar-muted)] font-ui">Select a simulation path to continue.</p>
    );
  }

  return (
    <div className="relative">
      {pathDetailLoading ? (
        <div className="pointer-events-none absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-[var(--ar-border)] bg-[var(--ar-surface)] px-2.5 py-1 text-[10px] text-[var(--ar-muted)] shadow-sm font-ui">
          <Loader2 className="h-3 w-3 animate-spin" /> Refreshing…
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function EmptyRunHint() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="ar-panel ar-band glass glass-glow-cyan overflow-hidden p-12 text-center"
    >
      <div className="mx-auto mb-4 h-1 w-24 rounded-full bg-gradient-to-r from-[var(--ar-maroon)] via-[var(--ar-gold)] to-[var(--ar-maroon)]" />
      <p className="text-xs tracking-[0.28em] text-[var(--ar-subtle)] font-ui">Desk Ready</p>
      <h2 className="mt-2 font-display text-3xl text-[var(--ar-maroon)] md:text-4xl">
        Run A Forward Test To Illuminate The Desk
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[var(--ar-muted)] font-ui">
        Choose path frequency, upload a product sheet if needed, then press Run. Paths start from
        today through Simulation End; each window is one full product tenure.
      </p>
    </motion.div>
  );
}

export function KpiBand() {
  const { filteredKpis, filteredSummary, sinceYear, frequency, product, summary } = useForwardTest();
  if (!filteredKpis) return null;
  const principalCr = product?.principal_cr ?? 100;
  const principalLabel =
    Number.isInteger(principalCr) || Math.abs(principalCr - Math.round(principalCr)) < 1e-9
      ? `${Math.round(principalCr)}`
      : formatNum(principalCr, 2);
  const items = [
    {
      label: `Total Paths · ${FREQUENCY_LABELS[frequency] ?? frequency}`,
      mean: String(summary?.path_count ?? filteredSummary.length),
      median: null as string | null,
    },
    {
      label: `Paths From ${sinceYear}`,
      mean: String(filteredSummary.length),
      median: null as string | null,
    },
    {
      label: "Terminal Value In ₹ Crores",
      mean: formatNum(filteredKpis.mean_total, 3),
      median: formatNum(filteredKpis.median_total, 3),
    },
    {
      label: "Internal Rate Of Return",
      mean: formatPct(filteredKpis.mean_irr, 3),
      median: formatPct(filteredKpis.median_irr, 3),
    },
    {
      label: `Share Finishing Above ${principalLabel} Crores`,
      mean: formatPct(filteredKpis.hit_rate_gt_100, 3),
      median: null,
    },
    {
      label: "Path Frequency",
      mean: FREQUENCY_LABELS[frequency] ?? frequency,
      median: null,
    },
  ];
  return (
    <div className="w-full overflow-x-auto pb-1">
      <div className="flex min-w-full gap-3">
        {items.map((k, i) => (
          <motion.div
            key={k.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            whileHover={{ y: -4, scale: 1.02 }}
            className="glass glass-glow-cyan min-w-[11.5rem] flex-1 rounded-2xl p-4"
          >
            <p className="text-[10px] tracking-[0.16em] text-[var(--ar-subtle)] font-ui">{k.label}</p>
            {k.median != null ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[9px] tracking-[0.12em] text-[var(--ar-subtle)] font-ui">Mean</p>
                  <p className="font-display text-xl tabular-nums text-[var(--ar-maroon)]">{k.mean}</p>
                </div>
                <div>
                  <p className="text-[9px] tracking-[0.12em] text-[var(--ar-subtle)] font-ui">Median</p>
                  <p className="font-display text-xl tabular-nums text-[var(--ar-maroon)]">{k.median}</p>
                </div>
              </div>
            ) : (
              <p className="mt-2 font-display text-2xl tabular-nums text-[var(--ar-maroon)]">{k.mean}</p>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export function MetricPair({
  labelA,
  valueA,
  labelB,
  valueB,
}: {
  labelA: string;
  valueA: string;
  labelB: string;
  valueB: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[
        { label: labelA, value: valueA },
        { label: labelB, value: valueB },
      ].map((m, i) => (
        <motion.div
          key={m.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          whileHover={{ y: -2 }}
          className="glass rounded-2xl p-4"
        >
          <p className="text-[10px] tracking-[0.16em] text-[var(--ar-subtle)] font-ui">{m.label}</p>
          <p className="mt-1 font-display text-xl tabular-nums text-[var(--ar-maroon)]">{m.value}</p>
        </motion.div>
      ))}
    </div>
  );
}

export function SubPageTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: string; label: string }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="nav-pill-shell inline-flex flex-wrap gap-1 rounded-2xl border p-1.5 font-ui shadow-sm">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={active === t.id ? "nav-sub-pill nav-sub-pill-active" : "nav-sub-pill"}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
