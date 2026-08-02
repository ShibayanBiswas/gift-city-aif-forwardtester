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
  onClick: (onProgress?: (message: string, progress?: number) => void) => void | Promise<void>;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  return (
    <motion.button
      type="button"
      disabled={busy}
      whileHover={busy ? undefined : { y: -2, scale: 1.02 }}
      whileTap={busy ? undefined : tapPress}
      transition={tapSpring}
      title={status ?? label}
      onClick={() => {
        void (async () => {
          setBusy(true);
          setStatus("Please wait…");
          try {
            await onClick((message) => {
              setStatus(message);
            });
          } finally {
            setBusy(false);
            setStatus(null);
          }
        })();
      }}
      className={`desk-btn inline-flex items-center gap-2 rounded-full border border-[var(--ar-border)] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ar-maroon)] hover:border-[var(--ar-gold)] disabled:cursor-wait disabled:opacity-70 font-ui ${className}`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {busy ? status || "Please wait…" : label}
    </motion.button>
  );
}
