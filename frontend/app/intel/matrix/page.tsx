"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";

import { client, formatDeskDate, formatNum } from "@/lib/api";
import { useForwardTest } from "@/lib/store";
import { EmptyRunHint } from "@/components/ui/Shared";
import { SheetTable } from "@/components/SheetTable";
import { DownloadButton } from "@/components/DownloadButton";

type PreviewPayload = Awaited<ReturnType<typeof client.mcMatrixPreview>>;

export default function MonteCarloMatrixPage() {
  const { summary, jobId, clearResults } = useForwardTest();
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await client.mcMatrixPreview(jobId, 20, 30);
      setPreview(data);
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "Failed to load path matrix");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tableRows = useMemo(() => {
    if (!preview?.rows?.length) return [];
    return preview.rows.map((row) =>
      row.map((cell, i) => {
        if (i === 0) return cell;
        const n = Number(cell);
        return Number.isFinite(n) ? formatNum(n, 2) : String(cell);
      }),
    );
  }, [preview]);

  const headers = useMemo(() => {
    if (!preview?.headers?.length) return ["Path"];
    return preview.headers.map((h, i) => (i === 0 ? "Path" : formatDeskDate(h)));
  }, [preview]);

  const onDownload = async () => {
    if (!jobId) return;
    setError(null);
    await client.downloadMcMatrix(jobId);
  };

  if (!summary || !jobId) return <EmptyRunHint />;

  const meta = summary.mc_matrix;
  const nPaths = preview?.n_paths ?? meta?.n_paths ?? summary.path_count;
  const nDates = preview?.n_dates ?? meta?.n_dates ?? meta?.dates?.length ?? "—";

  return (
    <div className="page-enter space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="ar-panel ar-band overflow-hidden"
      >
        <div className="border-b border-[var(--ar-border)] bg-gradient-to-r from-[var(--ar-table-head-from)] to-transparent px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--ar-subtle)] font-ui">Intel</p>
              <h2 className="font-display text-3xl text-[var(--ar-maroon)] md:text-4xl">Simulated Nifty Paths</h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--ar-muted)] font-ui">
                Path rows and trading-date columns from As Of Today through Simulation End.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <Link
                href="/intel"
                className="rounded-full border border-[var(--ar-border)] bg-[var(--ar-surface)] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ar-maroon)] font-ui hover:border-[var(--ar-gold)]"
              >
                Market Calendar
              </Link>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--ar-border)] bg-[var(--ar-surface)] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ar-maroon)] font-ui hover:border-[var(--ar-gold)] disabled:opacity-50"
                onClick={() => void load()}
                disabled={loading}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {loading ? "Refreshing…" : "Refresh"}
              </button>
              <DownloadButton
                label="Download Excel"
                onClick={async () => {
                  try {
                    await onDownload();
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : "Download failed";
                    setError(msg);
                    if (/no longer on the server|Unknown job|Run a fresh|Click Run/i.test(msg)) {
                      clearResults();
                    }
                  }
                }}
              />
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Paths", value: String(nPaths) },
              { label: "Trading Dates", value: String(nDates) },
              {
                label: "Horizon",
                value: `${formatDeskDate(preview?.first_date ?? summary.asof)} → ${formatDeskDate(preview?.last_date ?? summary.simulation_end)}`,
              },
              {
                label: "Current Nifty Spot",
                value:
                  preview?.spot0 != null
                    ? formatNum(preview.spot0, 2)
                    : meta?.spot0 != null
                      ? formatNum(meta.spot0, 2)
                      : "—",
              },
            ].map((m) => (
              <div key={m.label} className="glass rounded-2xl p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ar-subtle)] font-ui">
                  {m.label}
                </p>
                <p className="font-display text-lg tabular-nums text-[var(--ar-maroon)]">{m.value}</p>
              </div>
            ))}
          </div>
          {error ? (
            <p className="mt-3 text-sm text-[var(--ar-maroon)] font-ui">{error}</p>
          ) : null}
        </div>
      </motion.section>

      {loading && !preview ? (
        <p className="text-sm text-[var(--ar-muted)] font-ui px-1">Loading preview…</p>
      ) : (
        <SheetTable
          title="Simulated Nifty Paths"
          subtitle="Preview · download Excel for the full grid"
          headers={headers}
          rows={tableRows}
          filename={`simulated-nifty-preview-${jobId}.xlsx`}
          sheetName="Preview"
          minWidth={720}
          maxHeight={560}
        />
      )}
    </div>
  );
}
