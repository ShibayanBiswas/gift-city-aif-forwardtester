"use client";

import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

function cleanProgressCopy(raw: string): string {
  return raw
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/tqdm/gi, "")
    .replace(/Monte Carlo/gi, "Simulated")
    .replace(/\s{2,}/g, " ")
    .trim();
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
  useEffect(() => setMounted(true), []);

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
