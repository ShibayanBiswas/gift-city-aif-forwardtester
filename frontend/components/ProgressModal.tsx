"use client";

import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { deskSpring } from "@/lib/motion";

function cleanProgressCopy(raw: string): string {
  return raw
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/tqdm/gi, "")
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
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={deskSpring}
            className="relative mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-[rgba(212,178,76,0.35)] bg-[var(--ar-surface)] shadow-2xl"
          >
            <div className="desk-gold-rule !h-1.5 !w-full !rounded-none" />
            <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-[rgba(212,178,76,0.18)] blur-2xl" />
            <div className="pointer-events-none absolute -bottom-10 -left-6 h-28 w-28 rounded-full bg-[rgba(122,30,44,0.14)] blur-2xl" />
            <div className="relative px-6 py-5">
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
                  <div className="progress-bar-track mt-5 h-3 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                    <motion.div
                      className="progress-bar-fill h-full rounded-full bg-gradient-to-r from-[var(--ar-maroon)] via-[var(--ar-gold)] to-[var(--ar-maroon)] bg-[length:200%_100%]"
                      animate={{ width: `${pct}%` }}
                      transition={{ ease: "easeOut", duration: 0.28 }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm font-ui">
                    <span className="text-[var(--ar-subtle)]">Please Wait</span>
                    <motion.span
                      key={pct.toFixed(0)}
                      initial={{ opacity: 0.4, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="font-semibold tabular-nums text-[var(--ar-maroon)]"
                    >
                      {pct.toFixed(1)}%
                    </motion.span>
                  </div>
                </>
              ) : (
                <motion.button
                  type="button"
                  onClick={onDismiss}
                  className="desk-btn desk-btn-primary mt-5 inline-flex rounded-full px-4 py-2 text-xs font-semibold"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                >
                  Dismiss
                </motion.button>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
