"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

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
    <button
      type="button"
      disabled={busy}
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
      className={`inline-flex items-center gap-2 rounded-full border border-[var(--ar-border)] bg-[var(--ar-surface)] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ar-maroon)] shadow-sm transition hover:border-[var(--ar-gold)] hover:bg-[rgba(212,178,76,0.12)] disabled:cursor-wait disabled:opacity-70 font-ui ${className}`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {busy ? "Preparing…" : label}
    </button>
  );
}
