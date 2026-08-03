"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { LayoutDashboard, BarChart3, Calculator, Sparkles, Moon, Sun, Upload, Play, Download } from "lucide-react";
import { mainSections, resolveNav } from "@/lib/navigation";
import {
  cn,
  client,
  clampNPaths,
  DEFAULT_N_PATHS,
  MAX_N_PATHS,
  MIN_N_PATHS,
  MONTE_CARLO_LIMITS_WARN_AT,
  MONTE_CARLO_PATH_PRESETS,
} from "@/lib/api";
import { useForwardTest } from "@/lib/store";
import { deskSpring } from "@/lib/motion";

const icons = {
  home: LayoutDashboard,
  analytics: BarChart3,
  desk: Calculator,
  intel: Sparkles,
} as const;

function ComputationLimitsDialog({
  open,
  pathCount,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  pathCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 font-ui">
      <div className="max-w-md rounded-2xl border border-[var(--ar-border)] bg-[var(--ar-surface)] p-5 shadow-xl">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ar-subtle)]">Computation Limits</p>
        <h3 className="mt-1 font-display text-xl text-[var(--ar-maroon)]">Monte Carlo Path Count</h3>
        <p className="mt-3 text-sm leading-relaxed text-[var(--ar-muted)]">
          You selected <strong className="text-[var(--ar-ink)]">{pathCount.toLocaleString("en-IN")}</strong> Monte
          Carlo paths (maximum {MAX_N_PATHS.toLocaleString("en-IN")}). Larger counts take longer on free hosts and use
          more memory. Prefer 100–1,000 for interactive desk work; use 5,000–10,000 only when you need denser
          distributions and can wait for the run to finish.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-full border border-[var(--ar-border)] px-4 py-2 text-xs"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-full bg-[var(--ar-maroon)] px-4 py-2 text-xs text-white"
            onClick={onConfirm}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export function SiteNav() {
  const pathname = usePathname();
  const section = resolveNav(pathname);
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

  const presetMatch = (MONTE_CARLO_PATH_PRESETS as readonly number[]).includes(nPaths);
  const [customDraft, setCustomDraft] = useState(presetMatch ? "" : String(nPaths));
  const [pendingN, setPendingN] = useState<number | null>(null);
  const [runConfirmN, setRunConfirmN] = useState<number | null>(null);

  const requestNPaths = (raw: number) => {
    const n = clampNPaths(raw);
    if (raw > MAX_N_PATHS) {
      setError(`Monte Carlo path count must be at most ${MAX_N_PATHS.toLocaleString("en-IN")}.`);
      return;
    }
    if (n < MIN_N_PATHS) return;
    if (n >= MONTE_CARLO_LIMITS_WARN_AT) {
      setPendingN(n);
      return;
    }
    setNPaths(n);
    setCustomDraft((MONTE_CARLO_PATH_PRESETS as readonly number[]).includes(n) ? "" : String(n));
  };

  const applyPending = () => {
    if (pendingN == null) return;
    setNPaths(pendingN);
    setCustomDraft(
      (MONTE_CARLO_PATH_PRESETS as readonly number[]).includes(pendingN) ? "" : String(pendingN),
    );
    setPendingN(null);
  };

  const requestRun = () => {
    if (nPaths >= MONTE_CARLO_LIMITS_WARN_AT) {
      setRunConfirmN(nPaths);
      return;
    }
    void run();
  };

  return (
    <div className="border-t border-[var(--ar-border)]">
      <ComputationLimitsDialog
        open={pendingN != null}
        pathCount={pendingN ?? nPaths}
        onCancel={() => setPendingN(null)}
        onConfirm={applyPending}
      />
      <ComputationLimitsDialog
        open={runConfirmN != null}
        pathCount={runConfirmN ?? nPaths}
        onCancel={() => setRunConfirmN(null)}
        onConfirm={() => {
          setRunConfirmN(null);
          void run();
        }}
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
          <label
            className="inline-flex flex-wrap items-center gap-1.5 text-xs text-[var(--ar-muted)]"
            title={`Monte Carlo paths over the tenure window (${MIN_N_PATHS}–${MAX_N_PATHS})`}
          >
            <span className="hidden sm:inline">Monte Carlo Paths</span>
            <select
              className="desk-select disabled:opacity-50"
              disabled={running}
              value={presetMatch ? String(nPaths) : "custom"}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "custom") {
                  setCustomDraft(String(nPaths));
                  return;
                }
                requestNPaths(Number(v));
              }}
            >
              {MONTE_CARLO_PATH_PRESETS.map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString("en-IN")}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
            <input
              type="number"
              min={MIN_N_PATHS}
              max={MAX_N_PATHS}
              step={1}
              placeholder="Custom"
              disabled={running}
              value={customDraft}
              onChange={(e) => setCustomDraft(e.target.value)}
              onBlur={() => {
                const raw = Number(customDraft);
                if (!customDraft.trim() || !Number.isFinite(raw)) {
                  setCustomDraft(presetMatch ? "" : String(nPaths));
                  return;
                }
                requestNPaths(raw);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="desk-select w-[5.5rem] disabled:opacity-50"
            />
          </label>
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
