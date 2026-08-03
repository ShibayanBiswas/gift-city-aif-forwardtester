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

/** On-screen grid: all monthly/quarterly paths fit; date columns capped for browser FPS. */
function previewLimits(pathCount: number | undefined): { paths: number; dates: number } {
  const n = Math.max(1, Number(pathCount) || 200);
  if (n <= 200) return { paths: n, dates: 180 };
  if (n <= 800) return { paths: Math.min(n, 400), dates: 120 };
  return { paths: 400, dates: 90 };
}

export default function MonteCarloMatrixPage() {
  const { summary, jobId, clearResults } = useForwardTest();
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!jobId || !summary) return;
    setLoading(true);
    setError(null);
    try {
      const limits = previewLimits(summary.path_count ?? summary.mc_matrix?.n_paths);
      const data = await client.mcMatrixPreview(jobId, limits.paths, limits.dates);
      setPreview(data);
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "Failed to load path matrix");
    } finally {
      setLoading(false);
    }
  }, [jobId, summary]);

  useEffect(() => {
    void load();
  }, [load]);

  const tableRows = useMemo(() => {
    if (!preview?.rows?.length) return [];
    return preview.rows.map((row) =>
      row.map((cell, i) => {
        const h = String(preview.headers[i] ?? "");
        if (i === 0) return cell;
        if (h === "Start Date" || h === "End Date") return formatDeskDate(cell);
        const n = Number(cell);
        return Number.isFinite(n) ? formatNum(n, 2) : String(cell);
      }),
    );
  }, [preview]);

  const headers = useMemo(() => {
    if (!preview?.headers?.length) return ["Path", "Start Date", "End Date"];
    return preview.headers.map((h, i) => {
      if (i === 0) return "Path";
      if (h === "Start Date" || h === "End Date") return h;
      return formatDeskDate(h);
    });
  }, [preview]);

  const onDownload = async (onProgress?: (message: string, progress?: number) => void) => {
    if (!jobId) return;
    setError(null);
    await client.downloadMcMatrix(jobId, onProgress);
  };

  if (!summary || !jobId) return <EmptyRunHint />;

  const meta = summary.mc_matrix;
  const nPaths = preview?.n_paths ?? meta?.n_paths ?? summary.path_count;
  const nDates = preview?.n_dates ?? meta?.n_dates ?? meta?.dates?.length ?? "—";
  const shownPaths = preview?.preview_paths ?? tableRows.length;
  const shownDates = preview?.preview_dates ?? Math.max(0, headers.length - 3);
  const truncated = Boolean(preview?.truncated);
  const horizonNote =
    preview?.horizon_start && preview?.horizon_end
      ? ` · Full horizon ${formatDeskDate(preview.horizon_start)} → ${formatDeskDate(preview.horizon_end)}`
      : "";
  const sampleNote =
    preview?.date_sample === "head_tail"
      ? " · On-screen columns sample early and late dates · Product End included"
      : "";
  const tableSubtitle = truncated
    ? `Showing ${shownPaths.toLocaleString("en-IN")} of ${Number(nPaths).toLocaleString("en-IN")} paths · ${shownDates.toLocaleString("en-IN")} of ${Number(nDates).toLocaleString("en-IN")} trading dates${sampleNote}${horizonNote} · Download Excel for every trading date`
    : `Showing all ${Number(nPaths).toLocaleString("en-IN")} paths · ${shownDates.toLocaleString("en-IN")} trading-date columns${horizonNote} · Download Excel for the complete file`;

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
                Path rows and trading-date columns from As Of Today through Product End. The on-screen preview samples
                early and late dates so Product End stays visible. Download Excel for the full trading-day grid.
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

          <div className="mt-4 horizontal-rail-fill w-full">
            <div className="horizontal-rail-fill-inner flex w-full gap-3">
            {[
              { label: "Paths", value: Number(nPaths).toLocaleString("en-IN") },
              { label: "Trading Dates", value: Number(nDates).toLocaleString("en-IN") },
              {
                label: "Start",
                value: formatDeskDate(
                  preview?.first_date ?? meta?.first_date ?? summary.asof,
                ),
              },
              {
                label: "End",
                value: formatDeskDate(
                  preview?.last_date ?? meta?.last_date ?? summary.simulation_end,
                ),
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
              <div key={m.label} className="rail-card-fill glass min-w-0 flex-1 rounded-2xl px-4 py-3">
                <p className="text-[10px] tracking-[0.16em] text-[var(--ar-subtle)] font-ui">{m.label}</p>
                <p className="mt-1 font-display text-lg tabular-nums text-[var(--ar-maroon)]">{m.value}</p>
              </div>
            ))}
            </div>
          </div>
          {error ? (
            <p className="mt-3 text-sm text-[var(--ar-maroon)] font-ui">{error}</p>
          ) : null}
        </div>
      </motion.section>

      {loading && !preview ? (
        <p className="text-sm text-[var(--ar-muted)] font-ui px-1">Loading path table…</p>
      ) : (
        <SheetTable
          title="Simulated Nifty Paths"
          subtitle={tableSubtitle}
          headers={headers}
          rows={tableRows}
          filename={`simulated-nifty-preview-${jobId}.xlsx`}
          sheetName="Preview"
          minWidth={960}
          maxHeight="min(70vh, 720px)"
          stickyLeftCols={3}
          stickyColWidths={[72, 118, 118]}
          hideDownload
          columnTypes={[
            "integer",
            "date",
            "date",
            ...Array.from({ length: Math.max(0, headers.length - 3) }, () => "number" as const),
          ]}
        />
      )}
    </div>
  );
}
