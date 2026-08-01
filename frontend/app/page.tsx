"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useForwardTest } from "@/lib/store";
import { EmptyRunHint, KpiBand } from "@/components/ui/Shared";
import { ChartFrame, YearlyTotalChart } from "@/components/charts/Charts";
import { ProductMetaStrip, ProductSpecTables } from "@/components/ProductSpecTables";
import { SheetTable } from "@/components/SheetTable";
import { DownloadButton } from "@/components/DownloadButton";
import { client, formatDeskDate, formatNum } from "@/lib/api";

export default function HomePage() {
  const { product, summary, filteredYearly, sinceYear, market, jobId } = useForwardTest();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const displayName = product?.name === "Default Product" ? "Current Product" : product?.name ?? "Loading…";
  const principalCr = product?.principal_cr ?? 100;
  const principalLabel =
    Number.isInteger(principalCr) || Math.abs(principalCr - Math.round(principalCr)) < 1e-9
      ? String(Math.round(principalCr))
      : principalCr.toFixed(2);

  const yearlyRows = filteredYearly.map((y) => [
    String(y.year),
    y.paths,
    Number(y.mean_total.toFixed(3)),
    Number(y.median_total.toFixed(3)),
    Number(y.min_total.toFixed(3)),
    Number(y.max_total.toFixed(3)),
    Number((y.mean_irr * 100).toFixed(3)),
    Number((y.hit_rate_gt_100 * 100).toFixed(3)),
  ]);

  const gbmEstStart = summary?.gbm?.first_date ?? market?.first_date ?? "2001-01-01";
  const gbmEstEnd =
    market?.asof ?? market?.last_date ?? summary?.asof ?? summary?.gbm?.asof ?? null;

  const downloadSimulatedPaths = async () => {
    if (!jobId) {
      setDownloadError("Run a forward test first to generate simulated Nifty paths.");
      return;
    }
    setDownloadError(null);
    try {
      await client.downloadMcMatrix(jobId);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : "Download failed");
    }
  };

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="ar-panel ar-band overflow-hidden"
      >
        <div className="border-b border-[var(--ar-border)] bg-gradient-to-r from-[var(--ar-table-head-from)] to-transparent px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--ar-subtle)] font-ui">GIFT City · Cat-III AIF</p>
              <h2 className="font-display text-3xl text-[var(--ar-maroon)] md:text-5xl">{displayName}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--ar-muted)] font-ui">
                Structured units forward-tested from today&apos;s Nifty close through Simulation End. Upload a product
                sheet, pick a path frequency, and run the Monte Carlo desk engine.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 font-ui text-sm">
              {[
                { href: "/product", label: "Product" },
                { href: "/hedging", label: "Hedging Sheet" },
                { href: "/computation", label: "Computation" },
                { href: "/paths", label: "Path Calendar" },
                { href: "/analytics", label: "Analytics Lab", primary: true },
              ].map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={
                    l.primary
                      ? "rounded-full bg-[var(--ar-maroon)] px-4 py-2 text-white shadow-lg"
                      : "rounded-full border border-[var(--ar-border)] bg-[var(--ar-surface)] px-4 py-2 hover:border-[var(--ar-gold)]"
                  }
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-5 px-6 py-5">
          {product && (
            <>
              <ProductMetaStrip product={product} />
              <ProductSpecTables product={product} />
            </>
          )}
        </div>
      </motion.section>

      {!summary ? (
        <EmptyRunHint />
      ) : (
        <>
          <KpiBand />
          {summary.gbm ? (
            <motion.section
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="ar-panel overflow-hidden"
            >
              <div className="border-b border-[var(--ar-border)] bg-gradient-to-r from-[var(--ar-table-head-from)] to-transparent px-6 py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-ui text-xs uppercase tracking-[0.22em] text-[var(--ar-subtle)]">
                      Geometric Brownian Motion
                    </p>
                    <p className="mt-1 font-display text-2xl text-[var(--ar-maroon)] md:text-3xl">
                      Estimation {formatDeskDate(gbmEstStart)} → {formatDeskDate(gbmEstEnd)}
                    </p>
                    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--ar-muted)] font-ui">
                      Daily average return and daily standard deviation are recalculated from Nifty history from
                      01-Jan-2001 through today&apos;s as-of close. Download the full path × date simulated Nifty
                      grid in Excel Monte Carlo format.
                    </p>
                  </div>
                  <DownloadButton
                    label="Download Simulated Nifty Paths"
                    onClick={downloadSimulatedPaths}
                    className="shrink-0 bg-[var(--ar-maroon)] text-white hover:bg-[var(--ar-maroon)] hover:border-[var(--ar-gold)]"
                  />
                </div>
                {downloadError ? (
                  <p className="mt-3 text-sm text-[var(--ar-maroon)] font-ui">{downloadError}</p>
                ) : null}
                {summary.mc_matrix ? (
                  <p className="mt-3 text-xs text-[var(--ar-muted)] font-ui">
                    Excel layout · {summary.mc_matrix.n_paths} paths × {summary.mc_matrix.n_dates} trading dates ·
                    rows = path number · columns = dates · {formatDeskDate(summary.asof)} →{" "}
                    {formatDeskDate(summary.simulation_end)}
                  </p>
                ) : null}
              </div>
              <div className="horizontal-rail-fill px-6 py-5">
                <div className="horizontal-rail-fill-inner flex w-full gap-3">
                  {[
                    {
                      label: "Current Nifty Spot",
                      hint: (
                        <span className="font-serif italic">
                          S<sub>0</sub>
                        </span>
                      ),
                      value: formatNum(summary.gbm.spot0, 2),
                    },
                    {
                      label: "Daily Average Return",
                      hint: <span className="font-serif italic">μ</span>,
                      value: `${formatNum(summary.gbm.mean_return_pct ?? summary.gbm.mean_return * 100, 4)}%`,
                    },
                    {
                      label: "Daily Standard Deviation",
                      hint: <span className="font-serif italic">σ</span>,
                      value: `${formatNum(summary.gbm.std_dev_pct ?? summary.gbm.std_dev * 100, 2)}%`,
                    },
                    {
                      label: "Mean Drift",
                      hint: (
                        <span className="font-serif italic">
                          μ − ½σ<sup>2</sup>
                        </span>
                      ),
                      value: summary.gbm.drift.toFixed(6),
                    },
                  ].map((c) => (
                    <div key={c.label} className="rail-card-fill glass min-w-0 flex-1 rounded-2xl px-4 py-3">
                      <p className="text-[10px] tracking-[0.16em] text-[var(--ar-subtle)] font-ui">{c.label}</p>
                      <p className="mt-0.5 text-xs text-[var(--ar-muted)] font-ui">{c.hint}</p>
                      <p className="mt-1 font-display text-lg tabular-nums text-[var(--ar-maroon)]">{c.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </motion.section>
          ) : null}
          <ChartFrame
            title="Yearly Mean And Median Terminal Value"
            subtitle="Home · Summary"
            sinceYear={sinceYear}
          >
            <YearlyTotalChart data={filteredYearly} sinceYear={sinceYear} />
          </ChartFrame>
          <SheetTable
            title={`Yearly Rollup Since ${sinceYear}`}
            subtitle="Mean, Median, Extremes, IRR, And Hit Rate By Start Year · Through Latest Complete Tenure Window"
            headers={[
              "Start Year",
              "Number Of Paths",
              "Mean Terminal In Crores",
              "Median Terminal In Crores",
              "Minimum Terminal In Crores",
              "Maximum Terminal In Crores",
              "Mean IRR %",
              `Share Above ${principalLabel} Crores %`,
            ]}
            rows={yearlyRows}
            filename={`yearly-rollup-since-${sinceYear}.xlsx`}
            sheetName="Yearly Rollup"
            columnTypes={[
              "year",
              "integer",
              "currency",
              "currency",
              "currency",
              "currency",
              "pct_points",
              "pct_points",
            ]}
            minWidth={900}
            maxHeight={480}
          />
        </>
      )}
    </div>
  );
}
