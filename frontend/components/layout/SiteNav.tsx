"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { LayoutDashboard, BarChart3, Calculator, Sparkles, Moon, Sun, Upload, Play, Download } from "lucide-react";
import { mainSections, resolveNav } from "@/lib/navigation";
import {
  cn,
  client,
  DEPLOY_PATH_HARD_WARN_AT,
  DEPLOY_PATH_SOFT_CAP,
  MAX_N_PATHS,
  MIN_N_PATHS,
  MONTE_CARLO_LIMITS_WARN_AT,
  MONTE_CARLO_PATH_PRESETS,
  parseMonteCarloPathInput,
} from "@/lib/api";
import { useForwardTest } from "@/lib/store";
import { deskSpring } from "@/lib/motion";

const icons = {
  home: LayoutDashboard,
  analytics: BarChart3,
  desk: Calculator,
  intel: Sparkles,
} as const;

const PRESET_SET = new Set<number>(MONTE_CARLO_PATH_PRESETS);

type PathDialog =
  | { kind: "limits"; n: number; next: "apply" | "run"; asCustom: boolean }
  | { kind: "alert"; title: string; body: string }
  | null;

function MonteCarloDialog({
  dialog,
  onCancel,
  onConfirm,
}: {
  dialog: PathDialog;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const isLimits = dialog?.kind === "limits";
  const softCap =
    dialog?.kind === "limits" &&
    dialog.n >= DEPLOY_PATH_SOFT_CAP &&
    dialog.n < DEPLOY_PATH_HARD_WARN_AT;
  const hardCap = dialog?.kind === "limits" && dialog.n >= DEPLOY_PATH_HARD_WARN_AT;
  const title = !dialog
    ? ""
    : isLimits
      ? hardCap
        ? "High Path Count — Deploy Limits"
        : softCap
          ? "Above Free-Host Soft Cap"
          : "Larger Path Count"
      : dialog.title;
  const body = !dialog
    ? null
    : isLimits
      ? (
          <>
            You selected{" "}
            <strong className="text-[var(--ar-ink)]">{dialog.n.toLocaleString("en-IN")}</strong> paths.
            {hardCap ? (
              <>
                {" "}
                Counts at or above {DEPLOY_PATH_HARD_WARN_AT.toLocaleString("en-IN")} take much longer and use
                more memory. Free cloud hosts often time out or cap near{" "}
                {DEPLOY_PATH_SOFT_CAP.toLocaleString("en-IN")} paths — prefer 100 to 1,000 for interactive desk
                work. Continue only if your deployment can finish this run.
              </>
            ) : softCap ? (
              <>
                {" "}
                This exceeds the free-host soft ceiling of about{" "}
                {DEPLOY_PATH_SOFT_CAP.toLocaleString("en-IN")} paths. The server may clamp, slow down, or fail
                under memory pressure. Prefer 100 to 1,000 for day-to-day work.
              </>
            ) : (
              <>
                {" "}
                Larger counts take longer and use more memory. Prefer 100 to 1,000 for interactive work.
              </>
            )}
          </>
        )
      : (
          dialog.body
        );

  return createPortal(
    <AnimatePresence>
      {dialog ? (
        <motion.div
          key="mc-dialog-overlay"
          role="dialog"
          aria-modal
          aria-labelledby="mc-dialog-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-md font-ui"
          onClick={onCancel}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={deskSpring}
            className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-[rgba(212,178,76,0.35)] bg-[var(--ar-surface)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="desk-gold-rule !h-1.5 !w-full !rounded-none" />
            <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-[rgba(212,178,76,0.18)] blur-2xl" />
            <div className="pointer-events-none absolute -bottom-10 -left-6 h-28 w-28 rounded-full bg-[rgba(122,30,44,0.14)] blur-2xl" />
            <div className="relative px-6 py-5">
              <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--ar-subtle)]">
                {isLimits ? "Computation Limits" : "Paths"}
              </p>
              <h2 id="mc-dialog-title" className="mt-1 font-serif text-2xl text-[var(--ar-maroon)]">
                {title}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[var(--ar-muted)]">{body}</p>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                {isLimits ? (
                  <>
                    <motion.button
                      type="button"
                      className="rounded-full border border-[var(--ar-border)] px-4 py-2 text-xs font-semibold"
                      onClick={onCancel}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                    >
                      Cancel
                    </motion.button>
                    <motion.button
                      type="button"
                      className="rounded-full bg-[var(--ar-maroon)] px-4 py-2 text-xs font-semibold text-white"
                      onClick={onConfirm}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                    >
                      Continue
                    </motion.button>
                  </>
                ) : (
                  <motion.button
                    type="button"
                    className="rounded-full bg-[var(--ar-maroon)] px-4 py-2 text-xs font-semibold text-white"
                    onClick={onConfirm}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    OK
                  </motion.button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export function SiteNav() {
  const pathname = usePathname();
  const section = resolveNav(pathname);
  const pathInputId = useId();
  const {
    dark,
    setDark,
    nPaths,
    setNPaths,
    running,
    run,
    upload,
    product,
    setError,
  } = useForwardTest();

  const [mode, setMode] = useState<"preset" | "custom">(() =>
    PRESET_SET.has(nPaths) ? "preset" : "custom",
  );
  const [customDraft, setCustomDraft] = useState(() =>
    PRESET_SET.has(nPaths) ? "" : String(nPaths),
  );
  const [dialog, setDialog] = useState<PathDialog>(null);

  // Keep mode in sync when product upload / API changes nPaths.
  useEffect(() => {
    if (PRESET_SET.has(nPaths)) {
      setMode("preset");
      setCustomDraft("");
    } else {
      setMode("custom");
      setCustomDraft(String(nPaths));
    }
  }, [nPaths]);

  const applyN = (n: number, asCustom: boolean) => {
    setNPaths(n);
    if (asCustom || !PRESET_SET.has(n)) {
      setMode("custom");
      setCustomDraft(String(n));
    } else {
      setMode("preset");
      setCustomDraft("");
    }
  };

  const requestNPaths = (n: number, asCustom: boolean) => {
    if (n >= MONTE_CARLO_LIMITS_WARN_AT) {
      setDialog({ kind: "limits", n, next: "apply", asCustom });
      return;
    }
    applyN(n, asCustom);
  };

  const commitCustomDraft = () => {
    const parsed = parseMonteCarloPathInput(customDraft);
    if (!parsed.ok) {
      setDialog({ kind: "alert", title: parsed.title, body: parsed.body });
      setCustomDraft(String(nPaths));
      return;
    }
    if (parsed.n === nPaths && mode === "custom") {
      setCustomDraft(String(parsed.n));
      return;
    }
    requestNPaths(parsed.n, true);
  };

  const onSelectChange = (value: string) => {
    if (value === "custom") {
      setMode("custom");
      setCustomDraft(String(nPaths));
      return;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    requestNPaths(n, false);
  };

  const requestRun = () => {
    let runN = nPaths;
    if (mode === "custom") {
      const parsed = parseMonteCarloPathInput(customDraft || String(nPaths));
      if (!parsed.ok) {
        setDialog({ kind: "alert", title: parsed.title, body: parsed.body });
        return;
      }
      runN = parsed.n;
    }
    if (runN >= MONTE_CARLO_LIMITS_WARN_AT) {
      setDialog({
        kind: "limits",
        n: runN,
        next: "run",
        asCustom: mode === "custom" || !PRESET_SET.has(runN),
      });
      return;
    }
    if (runN !== nPaths) applyN(runN, mode === "custom");
    void run(runN);
  };

  const onDialogConfirm = () => {
    if (!dialog) return;
    if (dialog.kind === "alert") {
      setDialog(null);
      return;
    }
    const { n, next, asCustom } = dialog;
    applyN(n, asCustom);
    setDialog(null);
    if (next === "run") void run(n);
  };

  const selectValue = mode === "custom" ? "custom" : String(nPaths);

  return (
    <div className="border-t border-[var(--ar-border)]">
      <MonteCarloDialog
        dialog={dialog}
        onCancel={() => setDialog(null)}
        onConfirm={onDialogConfirm}
      />
      <div className="mx-auto flex max-w-full flex-wrap items-center justify-between gap-3 px-4 py-2 lg:px-6">
        <div className="nav-pill-shell flex items-center gap-1 rounded-2xl border p-1.5 shadow-md">
          {mainSections.map((item) => {
            const active = section.id === item.id;
            const Icon = icons[item.id as keyof typeof icons] ?? LayoutDashboard;
            return (
              <Link
                key={item.id}
                href={item.href}
                className={cn(
                  "relative flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold font-ui transition-all md:px-5",
                  active ? "btn-nav-active" : "text-[var(--ar-muted)] hover:bg-[var(--ar-panel)] hover:text-[var(--ar-ink)]",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="main-nav-active"
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-[rgba(212,178,76,0.35)] to-[rgba(122,30,44,0.18)] shadow-inner"
                    transition={deskSpring}
                  />
                ) : null}
                <motion.span className="relative inline-flex" whileHover={{ scale: 1.1, rotate: -4 }}>
                  <Icon className="h-4 w-4" />
                </motion.span>
                <span className="relative">{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 font-ui">
          <div
            className="inline-flex flex-wrap items-center gap-1.5 text-xs text-[var(--ar-muted)]"
            title={`Path count for this run · ${MIN_N_PATHS} to ${MAX_N_PATHS}`}
          >
            <label htmlFor={pathInputId} className="hidden sm:inline">
              Paths
            </label>
            <select
              id={pathInputId}
              className="desk-select disabled:opacity-50"
              disabled={running}
              value={selectValue}
              onChange={(e) => onSelectChange(e.target.value)}
              aria-label="Paths"
            >
              {MONTE_CARLO_PATH_PRESETS.map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString("en-IN")}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
            {mode === "custom" ? (
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                disabled={running}
                value={customDraft}
                placeholder={`1–${MAX_N_PATHS}`}
                aria-label="Custom path count"
                onChange={(e) => setCustomDraft(e.target.value.replace(/[^\d]/g, ""))}
                onBlur={commitCustomDraft}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                  if (e.key === "Escape") {
                    setCustomDraft(String(nPaths));
                    if (PRESET_SET.has(nPaths)) setMode("preset");
                  }
                }}
                className="desk-select w-[5.75rem] disabled:opacity-50"
              />
            ) : null}
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ar-border)] px-3 py-1.5 text-xs hover:border-[var(--ar-gold)]"
            onClick={() => {
              void client.downloadSample().catch((e) => {
                setError(e instanceof Error ? e.message : String(e));
              });
            }}
          >
            <Download size={14} />
            <span className="hidden md:inline">Sample Input</span>
          </button>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--ar-border)] px-3 py-1.5 text-xs hover:border-[var(--ar-gold)]">
            <Upload size={14} />
            <span className="hidden md:inline">Upload</span>
            <input
              type="file"
              accept=".xlsx,.xlsm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
          </label>
          <button
            type="button"
            disabled={running || !product}
            onClick={requestRun}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ar-maroon)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
          >
            <Play size={14} /> Run
          </button>
          <button
            type="button"
            aria-label="Toggle theme"
            onClick={() => setDark(!dark)}
            className="rounded-full border border-[var(--ar-border)] p-2"
          >
            {dark ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {section.subNav?.length ? (
          <motion.div
            key={section.id}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="nav-sub-bar border-t"
          >
            <div className="mx-auto flex max-w-full flex-wrap gap-1 px-4 py-2 lg:px-6">
              {section.subNav.map((item) => {
                const active = item.match(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn("nav-sub-pill font-ui", active && "nav-sub-pill-active")}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
