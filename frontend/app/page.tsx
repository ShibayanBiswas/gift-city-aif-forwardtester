"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useForwardTest } from "@/lib/store";
import { EmptyRunHint, KpiBand } from "@/components/ui/Shared";
import { ChartFrame, YearlyTotalChart } from "@/components/charts/Charts";
import { ProductMetaStrip, ProductSpecTables } from "@/components/ProductSpecTables";
import { SheetTable } from "@/components/SheetTable";
import { formatDeskDate, formatNum } from "@/lib/api";

export default function HomePage() {
  const { product, summary, filteredYearly, sinceYear, market } = useForwardTest();
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
                Forward paths from today&apos;s close through Simulation End, each a full product tenure under
                Geometric Brownian Motion.
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
              <div className="border-b border-[var(--ar-border)] bg-gradient-to-r from-[var(--ar-table-head-from)] to-transparent px-5 py-4">
                <p className="font-ui text-xs uppercase tracking-[0.18em] text-[var(--ar-subtle)]">
                  Geometric Brownian Motion
                </p>
                <p className="mt-1 font-display text-xl text-[var(--ar-maroon)] md:text-2xl">
                  Estimation {formatDeskDate(gbmEstStart)} → {formatDeskDate(gbmEstEnd)}
                </p>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--ar-muted)] font-ui">
                  Live μ and σ from Nifty history through today&apos;s as-of close. Path spots step only on
                  Mon–Fri sessions.
                </p>
              </div>
              <div className="desk-card-rail px-5 py-4">
                <div className="desk-card-rail__inner">
                  {[
                    {
                      label: "Current Nifty Spot",
                      hint: (
                        <>
                          <span className="font-serif italic">
                            S<sub>0</sub>
                          </span>
                        </>
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
                  ].map((card, i) => (
                    <motion.div
                      key={card.label}
                      className="desk-card-rail__card glass glass-glow-cyan"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.05 * i }}
                      whileHover={{ y: -3 }}
                    >
                      <p className="desk-card-rail__label">
                        {card.label}
                        <span className="normal-case tracking-normal text-[var(--ar-gold-dark)]">
                          {card.hint}
                        </span>
                      </p>
                      <p className="desk-card-rail__value">{card.value}</p>
                    </motion.div>
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
