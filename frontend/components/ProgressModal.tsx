"use client";

import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { client, formatDeskDate, formatNum } from "@/lib/api";

function cleanProgressCopy(raw: string): string {
  return raw
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/tqdm/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function Glyph({ children }: { children: React.ReactNode }) {
  return <span className="font-serif italic text-[var(--ar-maroon)]">{children}</span>;
}

export function ProgressModal({
  open,
  progress,
  message,
  error,
  onDismiss,
}: {
  open: boolean;
  progress: number;
  message: string;
  error?: string | null;
  onDismiss?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [gbm, setGbm] = useState<{
    spot0: number;
    mean_return_pct?: number;
    mean_return: number;
    std_dev_pct?: number;
    std_dev: number;
    drift: number;
    asof: string;
  } | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || error) return;
    let cancelled = false;
    void client
      .gbmParams()
      .then((r) => {
        if (!cancelled && r.gbm) setGbm(r.gbm);
      })
      .catch(() => {
        /* keep prior */
      });
    return () => {
      cancelled = true;
    };
  }, [open, error]);

  if (!mounted) return null;

  const failed = Boolean(error);
  const copy = cleanProgressCopy(error || message || "Preparing engine…");
  const pct = Math.min(100, Math.max(0, progress));

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 backdrop-blur-md"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 6 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="relative mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-[rgba(212,178,76,0.35)] bg-[var(--ar-surface)] shadow-2xl"
          >
            <div className="h-1.5 w-full bg-gradient-to-r from-[var(--ar-maroon)] via-[var(--ar-gold)] to-[var(--ar-maroon)]" />
            <div className="px-6 py-5">
              <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--ar-subtle)] font-ui">Live Simulation</p>
              <h2 className="mt-1 font-serif text-2xl text-[var(--ar-maroon)]">
                {failed
                  ? /stopped|cancelled|refresh|closed|only one run/i.test(copy)
                    ? "Simulation Stopped"
                    : "Simulation Failed"
                  : "Computing Forward Paths"}
              </h2>
              <p className="mt-2 min-h-[1.25rem] text-sm text-[var(--ar-muted)] font-ui">{copy}</p>

              {!failed && gbm ? (
                <div className="mt-4 space-y-2 rounded-xl border border-[var(--ar-border)] bg-[var(--ar-panel)]/60 px-4 py-3 font-ui text-sm">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ar-subtle)]">
                    Geometric Brownian Motion · As-Of {formatDeskDate(gbm.asof)}
                  </p>
                  <p className="leading-relaxed text-[var(--ar-ink)]">
                    Current Nifty Spot <Glyph>S<sub>0</sub></Glyph>
                    <span className="float-right tabular-nums font-semibold text-[var(--ar-maroon)]">
                      {gbm.spot0.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                    </span>
                  </p>
                  <div className="clear-both" />
                  <p className="leading-relaxed text-[var(--ar-ink)]">
                    Daily Average Return <Glyph>μ</Glyph>
                    <span className="float-right tabular-nums font-semibold text-[var(--ar-maroon)]">
                      {formatNum(gbm.mean_return_pct ?? gbm.mean_return * 100, 4)}%
                    </span>
                  </p>
                  <div className="clear-both" />
                  <p className="leading-relaxed text-[var(--ar-ink)]">
                    Daily Standard Deviation <Glyph>σ</Glyph>
                    <span className="float-right tabular-nums font-semibold text-[var(--ar-maroon)]">
                      {formatNum(gbm.std_dev_pct ?? gbm.std_dev * 100, 2)}%
                    </span>
                  </p>
                  <div className="clear-both" />
                  <p className="leading-relaxed text-[var(--ar-ink)]">
                    Mean Drift <Glyph>μ − ½σ²</Glyph>
                    <span className="float-right tabular-nums font-semibold text-[var(--ar-maroon)]">
                      {gbm.drift.toFixed(6)}
                    </span>
                  </p>
                  <div className="clear-both" />
                </div>
              ) : null}

              {!failed ? (
                <>
                  <div className="mt-5 h-3 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--ar-maroon)] to-[var(--ar-gold)]"
                      animate={{ width: `${pct}%` }}
                      transition={{ ease: "easeOut", duration: 0.28 }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm font-ui">
                    <span className="text-[var(--ar-subtle)]">Please Wait</span>
                    <span className="font-semibold tabular-nums text-[var(--ar-maroon)]">{pct.toFixed(1)}%</span>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="mt-5 inline-flex rounded-full bg-[var(--ar-maroon)] px-4 py-2 text-xs font-semibold text-white"
                >
                  Dismiss
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
