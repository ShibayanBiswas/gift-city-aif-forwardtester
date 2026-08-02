"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Download, Loader2 } from "lucide-react";
import { tapPress, tapSpring } from "@/lib/motion";

export function DownloadButton({
  label = "Download Excel",
  onClick,
  className = "",
}: {
  label?: string;
  onClick: () => void | Promise<void>;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <motion.button
      type="button"
      disabled={busy}
      whileHover={busy ? undefined : { y: -2, scale: 1.02 }}
      whileTap={busy ? undefined : tapPress}
      transition={tapSpring}
      onClick={() => {
        void (async () => {
          setBusy(true);
          try {
            await onClick();
          } finally {
            setBusy(false);
          }
        })();
      }}
      className={`desk-btn inline-flex items-center gap-2 rounded-full border border-[var(--ar-border)] bg-[var(--ar-surface)] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ar-maroon)] shadow-sm hover:bg-[rgba(212,178,76,0.12)] disabled:cursor-wait disabled:opacity-70 font-ui ${className}`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {busy ? "Preparing…" : label}
    </motion.button>
  );
}
