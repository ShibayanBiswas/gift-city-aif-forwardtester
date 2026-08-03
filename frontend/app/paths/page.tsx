"use client";

import { motion } from "framer-motion";
import { useForwardTest } from "@/lib/store";
import { EmptyRunHint, MetricPair, PathDetailGate, PathSelect } from "@/components/ui/Shared";
import { PathCalendar } from "@/components/PathCalendar";
import { DownloadButton } from "@/components/DownloadButton";
import { downloadExcel } from "@/lib/download";
import { formatDeskDate, formatNum, formatPct, isPlausibleTradingDate } from "@/lib/api";

const DESK_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDeskMonth(isoDate: string): string {
  const [y, m] = isoDate.slice(0, 7).split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return isoDate.slice(0, 7);
  return `${DESK_MONTHS[m - 1]}-${y}`;
}

export default function PathsPage() {
  const { summary, pathDetail, pathId, product } = useForwardTest();
  if (!summary) return <EmptyRunHint />;

  const obsSet = new Set(pathDetail?.observations ?? []);
  const plausibleDates = (pathDetail?.dates ?? []).filter((d) => isPlausibleTradingDate(d));
  const calendarExportRows = plausibleDates.map((d, i) => [
    i + 1,
    d,
    formatDeskMonth(d),
    obsSet.has(d) ? "Observation" : "Trading",
  ]);

  return (
    <div className="page-enter space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="ar-panel ar-band overflow-visible p-5"
      >
        <div className="mb-5 max-w-3xl">
          <p className="text-xs tracking-[0.22em] text-[var(--ar-subtle)] font-ui">Desk · Paths</p>
          <h2 className="font-display text-3xl text-[var(--ar-maroon)] md:text-4xl">Path Calendar</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ar-muted)] font-ui">
            Use the path selector below to open a path and review its trading calendar.
          </p>
        </div>
        <PathSelect className="w-full" showMeta />
      </motion.section>

      <PathDetailGate loadingLabel="Loading Path Dates…">
        {pathDetail ? (
          <>
            <MetricPair
              labelA="Path Start Date"
              valueA={formatDeskDate(pathDetail.start)}
              labelB="Path End Date"
              valueB={formatDeskDate(pathDetail.end)}
            />
            <section className="horizontal-rail-fill w-full">
              <div className="horizontal-rail-fill-inner flex w-full gap-3">
              {[
                { label: "Path Number", value: String(pathId) },
                { label: "Trading Days In Path", value: String(plausibleDates.length) },
                {
                  label: "Terminal Value In Crores",
                  value: formatNum(Number(pathDetail.summary.total)),
                },
                {
                  label: "Internal Rate Of Return",
                  value: formatPct(Number(pathDetail.summary.irr)),
                },
              ].map((k, i) => (
                <motion.div
                  key={k.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 * i }}
                  whileHover={{ y: -3 }}
                  className="rail-card-fill glass min-w-0 flex-1 rounded-2xl px-4 py-3"
                >
                  <p className="text-[10px] tracking-[0.16em] text-[var(--ar-subtle)] font-ui">{k.label}</p>
                  <p className="mt-1 font-display text-xl tabular-nums text-[var(--ar-maroon)]">{k.value}</p>
                </motion.div>
              ))}
              </div>
            </section>
            <section className="ar-panel ar-band p-5">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] tracking-[0.2em] text-[var(--ar-subtle)] font-ui">Trading Calendar</p>
                  <h3 className="mt-1 font-display text-2xl text-[var(--ar-maroon)]">Every Session In The Path</h3>
                </div>
                <DownloadButton
                  onClick={() =>
                    downloadExcel(
                      `path-${pathId}-trading-calendar.xlsx`,
                      ["Session Number", "Trading Date", "Month", "Session Type"],
                      calendarExportRows,
                      {
                        sheetName: "Trading Calendar",
                        title: `Trading Calendar · Path ${pathId}`,
                        subtitle: `${plausibleDates.length} Sessions · ${pathDetail.observations.length} Observations${
                          product?.name ? ` · ${product.name}` : ""
                        }`,
                        columnTypes: ["integer", "date", "text", "text"],
                      },
                    )
                  }
                />
              </div>
              <PathCalendar dates={plausibleDates} observations={pathDetail.observations} />
            </section>
          </>
        ) : null}
      </PathDetailGate>
    </div>
  );
}
