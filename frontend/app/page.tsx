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
import { deskSpring, easeOut, fadeUpItem, pageSection, staggerContainer, tapPress } from "@/lib/motion";

export default function HomePage() {
  const { product, summary, filteredYearly, sinceYear, market, jobId, clearResults } = useForwardTest();
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

  const downloadSimulatedPaths = async (
    onProgress?: (message: string, progress?: number) => void,
  ) => {
    if (!jobId) {
      setDownloadError("Run a forward test first.");
      return;
    }
    setDownloadError(null);
    try {
      await client.downloadMcMatrix(jobId, onProgress);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Download failed";
      setDownloadError(msg);
      if (/no longer on the server|Unknown job|Run a fresh|Click Run/i.test(msg)) {
        clearResults();
      }
    }
  };

  const quickLinks = [
    { href: "/product", label: "Product" },
    { href: "/hedging", label: "Hedging Sheet" },
    { href: "/computation", label: "Computation" },
    { href: "/paths", label: "Path Calendar" },
    { href: "/analytics", label: "Analytics Lab", primary: true },
  ];

  return (
    <div className="space-y-6">
      <motion.section
        variants={pageSection}
        initial="hidden"
        animate="show"
        className="ar-panel ar-band relative overflow-hidden"
      >
        <div className="hero-ambient" aria-hidden />
        <div className="relative border-b border-[var(--ar-border)] bg-gradient-to-r from-[var(--ar-table-head-from)] to-transparent px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <motion.div
                className="desk-gold-rule mb-3"
                initial={{ scaleX: 0, opacity: 0 }}
                animate={{ scaleX: 1, opacity: 1 }}
                transition={{ ...easeOut, delay: 0.05 }}
                style={{ transformOrigin: "left" }}
              />
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--ar-subtle)] font-ui">GIFT City · Cat-III AIF</p>
              <motion.h2
                className="font-display text-3xl text-[var(--ar-maroon)] md:text-5xl"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...easeOut, delay: 0.08 }}
              >
                {displayName}
              </motion.h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--ar-muted)] font-ui">
                Structured units forward-tested from today&apos;s Nifty close through Simulation End. Upload a product
                sheet, pick a path frequency, and run the desk engine.
              </p>
            </div>
            <motion.div
              className="flex flex-wrap gap-2 font-ui text-sm"
              variants={staggerContainer}
              initial="hidden"
              animate="show"
            >
              {quickLinks.map((l) => (
                <motion.div key={l.href} variants={fadeUpItem} whileHover={{ y: -2 }} whileTap={tapPress}>
                  <Link
                    href={l.href}
                    className={
                      l.primary
                        ? "desk-btn desk-btn-primary inline-block rounded-full px-4 py-2 text-white"
                        : "desk-btn inline-block rounded-full border border-[var(--ar-border)] bg-[var(--ar-surface)] px-4 py-2"
                    }
                  >
                    {l.label}
                  </Link>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
        <div className="relative space-y-5 px-6 py-5">
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
              className="sheet-card overflow-hidden"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={easeOut}
            >
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--ar-border)] bg-gradient-to-r from-[var(--ar-table-head-from)] to-transparent px-5 py-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ar-subtle)] font-ui">Parameters</p>
                  <h3 className="font-display text-xl text-[var(--ar-maroon)]">Nifty Path Parameters</h3>
                  <p className="mt-1 text-sm text-[var(--ar-muted)] font-ui">
                    {formatDeskDate(gbmEstStart)} → {formatDeskDate(gbmEstEnd)}
                  </p>
                </div>
                <DownloadButton label="Download Excel" onClick={downloadSimulatedPaths} />
              </div>
              {downloadError ? (
                <p className="px-5 pt-3 text-sm text-[var(--ar-maroon)] font-ui">{downloadError}</p>
              ) : null}
              <motion.div
                className="horizontal-rail-fill px-5 py-4"
                variants={staggerContainer}
                initial="hidden"
                animate="show"
              >
                <div className="horizontal-rail-fill-inner flex w-full gap-3">
                  {[
                    {
                      label: "Current Nifty Spot",
                      value: formatNum(summary.gbm.spot0, 2),
                    },
                    {
                      label: "Daily Average Return",
                      value: `${formatNum(summary.gbm.mean_return_pct ?? summary.gbm.mean_return * 100, 4)}%`,
                    },
                    {
                      label: "Daily Standard Deviation",
                      value: `${formatNum(summary.gbm.std_dev_pct ?? summary.gbm.std_dev * 100, 2)}%`,
                    },
                    {
                      label: "Drift",
                      value: summary.gbm.drift.toFixed(6),
                    },
                  ].map((c) => (
                    <motion.div
                      key={c.label}
                      variants={fadeUpItem}
                      whileHover={{ y: -3, transition: deskSpring }}
                      className="rail-card-fill glass min-w-0 flex-1 rounded-2xl px-4 py-3"
                    >
                      <p className="text-[10px] tracking-[0.16em] text-[var(--ar-subtle)] font-ui">{c.label}</p>
                      <p className="mt-1 font-display text-lg tabular-nums text-[var(--ar-maroon)]">{c.value}</p>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
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
