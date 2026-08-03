"use client";

import { useMemo } from "react";
import { useForwardTest } from "@/lib/store";
import { EmptyRunHint, KpiBand, PathDetailGate, PathSelect } from "@/components/ui/Shared";
import { ChartFrame, PathSeriesChart } from "@/components/charts/Charts";
import { DownloadButton } from "@/components/DownloadButton";
import { downloadExcel } from "@/lib/download";
import { isPlausibleTradingDate } from "@/lib/api";

export default function AnalyticsPage() {
  const { summary, pathDetail, pathId } = useForwardTest();

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
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--ar-subtle)] font-ui">
              Analytics · Path Charts
            </p>
            <h2 className="font-display text-2xl text-[var(--ar-maroon)]">Path Charts</h2>
            <p className="mt-1 text-sm text-[var(--ar-muted)] font-ui">
              All Monte Carlo paths share one start date (As Of Today), so yearly-by-start-year rollups are not used.
              Review cohort KPIs here, then inspect net required futures delta for a selected path. NAV lives on
              Computation.
            </p>
          </div>
        </div>
      </section>

      <KpiBand />

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
              >
                <PathSeriesChart
                  dates={chartDates}
                  values={chartDelta}
                  yLabel="Net Required Futures Delta"
                  color="#7a1e2c"
                  seriesName="Net Required Futures Delta"
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
