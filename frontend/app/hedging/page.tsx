"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useForwardTest } from "@/lib/store";
import { EmptyRunHint, PathDetailGate, PathSelect, SubPageTabs } from "@/components/ui/Shared";
import { formatDeskDate, formatNum, isPlausibleTradingDate, tradeSideLabel } from "@/lib/api";
import { SheetTable } from "@/components/SheetTable";
import { DownloadButton } from "@/components/DownloadButton";
import { downloadExcel } from "@/lib/download";
import { NestedOptionsBook } from "@/components/NestedOptionsBook";
import {
  uniqueOptionsBookDisplayRows,
  uniqueOptionsBookExportRows,
  UNIQUE_OPTIONS_BOOK_COLUMN_TYPES,
} from "@/components/ProductSpecTables";

type HedgeTab = "observations" | "options_book";

const OBS_HEADERS = [
  "Observation Number",
  "Month Offset",
  "Calendar Days From Start",
  "Target Date",
  "Monthly Expiry",
  "Nifty On Expiry",
];

const UNIQUE_BOOK_HEADERS = [
  "#",
  "Trade Side",
  "Raw Option Quantity",
  "Strike As Percent Of Spot",
  "Underlying Return Level",
];
// Trade Side values are "Sold Put Option" / "Bought Put Option" (default book = puts).

const OPTIONS_BOOK_HEADERS = [
  "Raw Option Quantity",
  "Strike As Percent Of Spot",
  "Strike Level",
  "Observation Expiry Date",
  "Nifty On Expiry",
  "Implied Volatility",
  "Contract Quantity",
];

export default function HedgingPage() {
  const { summary, pathDetail, pathId, product } = useForwardTest();
  const [tab, setTab] = useState<HedgeTab>("observations");
  const legs = pathDetail?.legs ?? [];
  const builds = pathDetail?.obs_builds ?? [];

  const obsRows = useMemo(
    () =>
      builds
        .filter((b) => isPlausibleTradingDate(b.target_date) && isPlausibleTradingDate(b.expiry))
        .map((b, i) => [
          i + 1,
          b.month,
          b.offset_days.toFixed(1),
          formatDeskDate(b.target_date),
          formatDeskDate(b.expiry),
          formatNum(b.nifty, 1),
        ]),
    [builds],
  );

  const obsExportRows = useMemo(
    () =>
      builds
        .filter((b) => isPlausibleTradingDate(b.target_date) && isPlausibleTradingDate(b.expiry))
        .map((b, i) => [
          i + 1,
          b.month,
          b.offset_days,
          b.target_date,
          b.expiry,
          b.nifty,
        ]),
    [builds],
  );

  /** Unique strikes in Product Input Excel order — never Sold/Bought grouped. */
  const uniqueBookRows = useMemo(() => {
    if (product?.legs?.length) {
      return uniqueOptionsBookDisplayRows(product);
    }
    // Fallback: first-seen order from expanded path legs
    const seen = new Set<string>();
    const rows: Array<Array<string | number>> = [];
    for (const lg of legs) {
      const key = `${lg.raw_qty ?? 0}|${Number(lg.strike_pct).toFixed(6)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const raw = lg.raw_qty ?? 0;
      const retFrac = lg.strike_pct / 100 - 1;
      rows.push([
        rows.length + 1,
        tradeSideLabel(raw, lg.option),
        Number(raw.toFixed(3)),
        `${formatNum(lg.strike_pct, 3)}%`,
        `${(retFrac * 100).toFixed(3)}%`,
      ]);
    }
    return rows;
  }, [product, legs]);

  const uniqueBookExportRows = useMemo(() => {
    if (product?.legs?.length) {
      return uniqueOptionsBookExportRows(product);
    }
    const seen = new Set<string>();
    const rows: Array<Array<string | number>> = [];
    for (const lg of legs) {
      const key = `${lg.raw_qty ?? 0}|${Number(lg.strike_pct).toFixed(6)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const raw = lg.raw_qty ?? 0;
      rows.push([
        rows.length + 1,
        tradeSideLabel(raw, lg.option),
        Number(raw.toFixed(3)),
        Number(lg.strike_pct.toFixed(6)),
        Number((lg.strike_pct / 100 - 1).toFixed(6)),
      ]);
    }
    return rows;
  }, [product, legs]);

  if (!summary) return <EmptyRunHint />;

  return (
    <div className="space-y-4">
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="ar-panel ar-band overflow-visible"
      >
        <div className="border-b border-[var(--ar-border)] bg-gradient-to-r from-[var(--ar-table-head-from)] to-transparent px-5 py-4">
          <div className="mb-4">
            <p className="text-[10px] tracking-[0.2em] text-[var(--ar-subtle)] font-ui">Desk · Hedging Sheet</p>
            <h2 className="font-display text-2xl text-[var(--ar-maroon)] md:text-3xl">
              Hedging Sheet · Path {pathId}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ar-muted)] font-ui">
              Observation schedule and options book for the selected simulation path
            </p>
          </div>
          <PathSelect className="w-full" showMeta />
        </div>
        <div className="px-5 py-3">
          <SubPageTabs
            tabs={[
              { id: "observations", label: "Observation Schedule" },
              { id: "options_book", label: "Options Book" },
            ]}
            active={tab}
            onChange={(id) => setTab(id as HedgeTab)}
          />
        </div>
      </motion.section>

      <PathDetailGate loadingLabel="Loading Hedging Sheet…">
        {pathDetail ? (
          <>
            {tab === "observations" && (
              <>
                <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    { label: "Spot At Inception", value: formatNum(pathDetail.spot0 ?? 0, 2) },
                    {
                      label: "Day-0 Required Delta",
                      value: formatNum(
                        Number(pathDetail.daily_delta?.[0] ?? pathDetail.computation_rows?.[0]?.req_delta ?? 0),
                        0,
                      ),
                    },
                    { label: "Observation Count", value: String(builds.length) },
                    {
                      label: "Observations Mapped",
                      value: String(pathDetail.observations?.length ?? builds.length),
                    },
                  ].map((k) => (
                    <div key={k.label} className="glass rounded-2xl p-4">
                      <p className="text-[10px] tracking-[0.16em] text-[var(--ar-subtle)] font-ui">{k.label}</p>
                      <p className="mt-1 font-display text-xl tabular-nums text-[var(--ar-maroon)]">{k.value}</p>
                    </div>
                  ))}
                </section>
                <SheetTable
                  title="Observation Schedule"
                  subtitle={`Spot At Inception ${formatNum(pathDetail.spot0 ?? 0, 2)} · Month Offset · Target Date · Monthly Expiry · Nifty On Expiry`}
                  headers={OBS_HEADERS}
                  rows={obsRows}
                  exportRows={obsExportRows}
                  columnTypes={["integer", "number", "number", "date", "date", "number"]}
                  filename={`path-${pathId}-observations.xlsx`}
                  sheetName="Observations"
                  minWidth={900}
                  maxHeight={480}
                />
              </>
            )}

            {tab === "options_book" && (
              <section className="space-y-4">
                <SheetTable
                  title="Quantity At Underlying Return Level"
                  subtitle="Product Input Row Order · Strike As Percent Of Spot"
                  headers={UNIQUE_BOOK_HEADERS}
                  rows={uniqueBookRows}
                  exportRows={uniqueBookExportRows}
                  columnTypes={UNIQUE_OPTIONS_BOOK_COLUMN_TYPES}
                  filename={`path-${pathId}-options-book-unique.xlsx`}
                  sheetName="Options Book"
                  minWidth={720}
                  maxHeight={360}
                />

                <div className="flex flex-wrap items-end justify-between gap-2 px-1">
                  <div>
                    <h3 className="font-display text-xl text-[var(--ar-maroon)]">
                      Options Book By Strike
                    </h3>
                    <p className="text-sm text-[var(--ar-muted)] font-ui">
                      One flat table — strike identity spans rows; each observation is a metric line with its expiry
                    </p>
                  </div>
                  <DownloadButton
                    onClick={() => {
                      const niftyByExpiry = new Map(builds.map((b) => [b.expiry, b.nifty]));
                      return downloadExcel(
                        `path-${pathId}-options-book.xlsx`,
                        OPTIONS_BOOK_HEADERS,
                        legs.map((lg) => [
                          lg.raw_qty ?? "",
                          lg.strike_pct,
                          lg.strike,
                          lg.expiry,
                          niftyByExpiry.get(lg.expiry) ?? "",
                          lg.vol,
                          lg.quantity,
                        ]),
                        {
                          sheetName: "Options Book",
                          title: `Options Book · Path ${pathId}`,
                          subtitle: "Hedging Sheet Legs Flattened · Product Input Order",
                          columnTypes: [
                            "number",
                            "pct_points",
                            "number",
                            "date",
                            "number",
                            "percent",
                            "number",
                          ],
                        },
                      );
                    }}
                  />
                </div>
                <NestedOptionsBook legs={legs} obsBuilds={builds} />
              </section>
            )}
          </>
        ) : null}
      </PathDetailGate>
    </div>
  );
}
