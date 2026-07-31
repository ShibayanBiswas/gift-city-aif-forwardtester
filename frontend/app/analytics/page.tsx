"use client";

import { useMemo } from "react";
import { useForwardTest } from "@/lib/store";
import { EmptyRunHint, KpiBand, PathDetailGate, PathSelect } from "@/components/ui/Shared";
import { ChartFrame, PathSeriesChart, YearlyTotalChart } from "@/components/charts/Charts";
import { SheetTable } from "@/components/SheetTable";
import { DownloadButton } from "@/components/DownloadButton";
import { downloadExcel } from "@/lib/download";
import { isPlausibleTradingDate } from "@/lib/api";

export default function AnalyticsPage() {
  const { summary, filteredYearly, sinceYear, pathDetail, pathId, product } = useForwardTest();
  const principalCr = product?.principal_cr ?? 100;
  const principalLabel =
    Number.isInteger(principalCr) || Math.abs(principalCr - Math.round(principalCr)) < 1e-9
      ? String(Math.round(principalCr))
      : principalCr.toFixed(2);

  const yearlyRows = useMemo(
    () =>
      filteredYearly.map((y) => [
        String(y.year),
        y.paths,
        Number(y.mean_total.toFixed(3)),
        Number(y.median_total.toFixed(3)),
        Number(y.min_total.toFixed(3)),
        Number(y.max_total.toFixed(3)),
        Number((y.mean_irr * 100).toFixed(3)),
        Number((y.hit_rate_gt_100 * 100).toFixed(3)),
      ]),
    [filteredYearly],
  );

  const deltaExportRows = useMemo(
    () =>
      (pathDetail?.dates ?? [])
        .map((d, i) => ({ d, i }))
        .filter(({ d }) => isPlausibleTradingDate(d))
        .map(({ d, i }) => [
          d,
          pathDetail?.daily_delta?.[i] ?? "",
          pathDetail?.daily_nav?.[i] ?? "",
        ]),
    [pathDetail],
  );

  const chartDates = useMemo(
    () => (pathDetail?.dates ?? []).filter((d) => isPlausibleTradingDate(d)),
    [pathDetail],
  );
  const chartDelta = useMemo(
    () =>
      (pathDetail?.dates ?? [])
        .map((d, i) => (isPlausibleTradingDate(d) ? pathDetail?.daily_delta?.[i] : null))
        .filter((v): v is number => v != null && Number.isFinite(v)),
    [pathDetail],
  );

  if (!summary) return <EmptyRunHint />;

  return (
    <div className="space-y-4">
      <section className="ar-panel ar-band p-5">
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--ar-subtle)] font-ui">Analytics · Yearly Lab</p>
            <h2 className="font-display text-2xl text-[var(--ar-maroon)]">Yearly Lab</h2>
            <p className="mt-1 text-sm text-[var(--ar-muted)] font-ui">
              Mean, Median, And Hit-Rate Cover Paths From The Header Since Year. Delta Chart Is One Selected Path. NAV
              Lives On Computation.
            </p>
          </div>
          <span className="chart-since-pill ml-auto shrink-0 font-ui">Since {sinceYear}</span>
        </div>
      </section>

      <KpiBand />

      <ChartFrame
        title="Mean Versus Median Terminal By Start Year"
        subtitle="Analytics"
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
        filename={`analytics-yearly-since-${sinceYear}.xlsx`}
        sheetName="Yearly Lab"
        minWidth={900}
        maxHeight={360}
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
      />

      <section className="ar-panel ar-band p-5">
        <div className="mb-4 flex w-full flex-col gap-3">
          <div>
            <p className="text-xs tracking-[0.18em] text-[var(--ar-subtle)] font-ui">Single Path</p>
            <h3 className="font-display text-xl text-[var(--ar-maroon)]">
              Net Required Futures Delta · Path {pathId}
            </h3>
            <p className="mt-1 text-sm text-[var(--ar-muted)] font-ui">
              Sum of option deltas times contract quantity for the selected path.
            </p>
          </div>
          <PathSelect className="w-full" />
        </div>
        <PathDetailGate loadingLabel="Loading Delta Series…">
          {pathDetail?.daily_delta ? (
            <>
              <div className="mb-3 flex justify-end">
                <DownloadButton
                  label="Download Delta / NAV Series"
                  onClick={() =>
                    downloadExcel(
                      `path-${pathId}-delta-nav-series.xlsx`,
                      ["Trading Date", "Net Required Delta", "Net Asset Value in ₹ Crores"],
                      deltaExportRows,
                      {
                        sheetName: "Delta NAV",
                        title: `Delta And NAV Series · Path ${pathId}`,
                        columnTypes: ["date", "number", "number"],
                      },
                    )
                  }
                />
              </div>
              <ChartFrame
                title={`Path ${pathId} · Net Required Futures Delta`}
                subtitle="Single Path Series"
                height="h-72"
                sinceYear={sinceYear}
              >
                <PathSeriesChart
                  dates={chartDates}
                  values={chartDelta}
                  yLabel="Net Required Futures Delta"
                  color="#7a1e2c"
                  seriesName="Net Required Futures Delta"
                  sinceYear={sinceYear}
                  showZeroLine
                />
              </ChartFrame>
            </>
          ) : (
            <p className="text-sm text-[var(--ar-muted)] font-ui">No delta series for this path.</p>
          )}
        </PathDetailGate>
      </section>
    </div>
  );
}
