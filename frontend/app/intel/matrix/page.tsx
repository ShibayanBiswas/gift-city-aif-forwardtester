"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Download, RefreshCw } from "lucide-react";

import {
  client,
  formatDeskDate,
  formatNum,
} from "@/lib/api";
import { useForwardTest } from "@/lib/store";
import { EmptyRunHint } from "@/components/ui/Shared";
import { SheetTable } from "@/components/SheetTable";

type PreviewPayload = Awaited<ReturnType<typeof client.mcMatrixPreview>>;

export default function MonteCarloMatrixPage() {
  const { summary, jobId } = useForwardTest();
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
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
      setError(e instanceof Error ? e.message : "Failed to load Monte Carlo matrix");
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
    setDownloading(true);
    setError(null);
    try {
      await client.downloadMcMatrix(jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
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
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--ar-subtle)] font-ui">
                Intel · Monte Carlo Matrix
              </p>
              <h2 className="font-display text-3xl text-[var(--ar-maroon)] md:text-4xl">
                Path × Date Nifty Grid
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--ar-muted)] font-ui">
                Full-horizon GBM matrix from as-of through Simulation End. Rows are path
                numbers; columns are trading dates (holidays excluded). Formula matches
                Excel Monte Carlo:{" "}
                <span className="font-ui">Sₜ = Sₜ₋₁ · exp(drift + σ · Z)</span>. Tenure
                windows and roll costs slice this same grid — different paths ⇒ different
                Nifty on the same date ⇒ different roll points.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/intel" className="nav-sub-pill">
                Path Market
              </Link>
              <button
                type="button"
                className="nav-sub-pill inline-flex items-center gap-1.5"
                onClick={() => void load()}
                disabled={loading}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
              <button
                type="button"
                className="nav-sub-pill nav-sub-pill-active inline-flex items-center gap-1.5"
                onClick={() => void onDownload()}
                disabled={downloading}
              >
                <Download className="h-3.5 w-3.5" />
                {downloading ? "Preparing…" : "Download Excel"}
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Paths (rows)", value: String(nPaths) },
              { label: "Trading Dates (cols)", value: String(nDates) },
              {
                label: "As Of → End",
                value: `${formatDeskDate(preview?.first_date ?? summary.asof)} → ${formatDeskDate(preview?.last_date ?? summary.simulation_end)}`,
              },
              {
                label: "S0 / Drift",
                value:
                  preview?.spot0 != null
                    ? `${formatNum(preview.spot0, 2)} / ${formatNum(preview.drift ?? 0, 6)}`
                    : meta?.spot0 != null
                      ? `${formatNum(meta.spot0, 2)} / ${formatNum(meta.drift ?? 0, 6)}`
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
          {preview?.truncated ? (
            <p className="mt-3 text-xs text-[var(--ar-muted)] font-ui">
              Preview shows the first {preview.preview_paths} paths × {preview.preview_dates}{" "}
              dates. Download Excel for the full matrix.
            </p>
          ) : null}
        </div>
      </motion.section>

      {loading && !preview ? (
        <p className="text-sm text-[var(--ar-muted)] font-ui px-1">Loading matrix preview…</p>
      ) : (
        <SheetTable
          title="Monte Carlo · Nifty Paths"
          subtitle="Vertical = path number · Horizontal = forward trading dates"
          headers={headers}
          rows={tableRows}
          filename={`monte-carlo-preview-${jobId}.xlsx`}
          sheetName="MC Preview"
          minWidth={720}
          maxHeight={560}
        />
      )}
    </div>
  );
}
