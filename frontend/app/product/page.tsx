"use client";

import { useMemo } from "react";
import { useForwardTest } from "@/lib/store";
import { EmptyRunHint, MetricPair, PathSelect } from "@/components/ui/Shared";
import { ProductMetaStrip, ProductSpecTables } from "@/components/ProductSpecTables";
import { DownloadButton } from "@/components/DownloadButton";
import { SheetTable } from "@/components/SheetTable";
import { NestedOptionsBook } from "@/components/NestedOptionsBook";
import { downloadBrandedExcel } from "@/lib/download";
import { formatDeskDate, isPlausibleTradingDate, optionTypeLabel } from "@/lib/api";

export default function ProductPage() {
  const { product, summary, pathDetail, pathId } = useForwardTest();

  const obsDisplayRows = useMemo(
    () =>
      (pathDetail?.obs_builds ?? [])
        .filter((b) => isPlausibleTradingDate(b.expiry) && isPlausibleTradingDate(b.target_date))
        .map((b, i) => [
          i + 1,
          b.month,
          Number(b.offset_days.toFixed(1)),
          formatDeskDate(b.target_date),
          formatDeskDate(b.expiry),
          Number(b.nifty.toFixed(2)),
        ]),
    [pathDetail],
  );

  const obsExportRows = useMemo(
    () =>
      (pathDetail?.obs_builds ?? [])
        .filter((b) => isPlausibleTradingDate(b.expiry) && isPlausibleTradingDate(b.target_date))
        .map((b, i) => [
          i + 1,
          b.month,
          b.offset_days,
          b.target_date,
          b.expiry,
          b.nifty,
        ]),
    [pathDetail],
  );

  const optionsBookRows = useMemo(
    () =>
      (pathDetail?.legs ?? [])
        .filter((lg) => isPlausibleTradingDate(lg.expiry))
        .map((lg) => [
          lg.raw_qty ?? "",
          Number((lg.strike_pct ?? 0).toFixed(6)),
          lg.strike,
          lg.expiry,
          optionTypeLabel(lg.option),
          lg.forward != null && Number.isFinite(lg.forward) ? Number(lg.forward) : "",
          lg.discount != null && Number.isFinite(lg.discount) ? Number(lg.discount) : "",
          Number(lg.vol),
          lg.quantity,
        ]),
    [pathDetail],
  );

  if (!product) {
    return <p className="text-sm text-[var(--ar-muted)]">Loading product…</p>;
  }

  const displayName = product.name === "Default Product" ? "Current Product" : product.name;

  return (
    <div className="space-y-6">
      <section className="ar-panel ar-band overflow-hidden">
        <div className="border-b border-[var(--ar-border)] bg-gradient-to-r from-[var(--ar-table-head-from)] to-transparent px-6 py-5">
          <p className="text-xs tracking-[0.18em] text-[var(--ar-subtle)] font-ui">Desk · Product</p>
          <h2 className="font-serif text-2xl text-[var(--ar-maroon)] md:text-3xl">{displayName}</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ar-muted)] font-ui">
            Product definition from the uploaded sheet. After a run, use the path selector to review observation
            expiries under each strike.
          </p>
        </div>
        <div className="space-y-5 px-6 py-5">
          <ProductMetaStrip product={product} />
          <ProductSpecTables product={product} />
        </div>
      </section>

      {!summary ? (
        <EmptyRunHint />
      ) : (
        <>
          <section className="ar-panel ar-band p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs tracking-[0.18em] text-[var(--ar-subtle)] font-ui">Path Build</p>
                <h3 className="font-serif text-xl text-[var(--ar-maroon)]">
                  Observation Map · Path {pathId}
                </h3>
              </div>
              <div className="flex w-full flex-col gap-2">
                <PathSelect className="w-full" />
                {pathDetail && (
                  <div className="flex justify-end">
                    <DownloadButton
                      label="Download Path Product Excel"
                      onClick={() =>
                        downloadBrandedExcel(
                          `path-${pathId}-product-build.xlsx`,
                          [
                            {
                              name: "Observation Map",
                              title: `Observation Map · Path ${pathId}`,
                              subtitle: `${formatDeskDate(pathDetail.start)} → ${formatDeskDate(pathDetail.end)}`,
                              headers: [
                                "Observation Number",
                                "Month Offset From Start",
                                "Calendar Days From Start",
                                "Target Calendar Date",
                                "Monthly Option Expiry Used",
                                "Nifty Level On Expiry",
                              ],
                              rows: obsExportRows,
                              columnTypes: ["integer", "number", "number", "date", "date", "number"],
                            },
                            {
                              name: "Options Book",
                              title: `Options Book · Path ${pathId}`,
                              headers: [
                                "Raw Option Quantity",
                                "Strike %",
                                "Strike Level",
                                "Observation Expiry",
                                "Option Type",
                                "Forward",
                                "Discount",
                                "Implied Volatility",
                                "Contract Quantity",
                              ],
                              columnTypes: [
                                "number",
                                "pct_points",
                                "number",
                                "date",
                                "text",
                                "percent",
                                "percent",
                                "percent",
                                "number",
                              ],
                              rows: optionsBookRows,
                            },
                          ],
                          { metaLine: `Product Build · Path ${pathId}` },
                        )
                      }
                    />
                  </div>
                )}
              </div>
            </div>
            {pathDetail && (
              <div className="mt-4">
                <MetricPair
                  labelA="Path Start Date"
                  valueA={formatDeskDate(pathDetail.start)}
                  labelB="Path End Date"
                  valueB={formatDeskDate(pathDetail.end)}
                />
              </div>
            )}
            {pathDetail?.obs_builds ? (
              <div className="mt-4">
                <SheetTable
                  title="Observation Map"
                  subtitle="Month Offset · Target · Monthly Expiry · Nifty"
                  headers={[
                    "Observation Number",
                    "Month Offset From Start",
                    "Calendar Days From Start",
                    "Target Calendar Date",
                    "Monthly Option Expiry Used",
                    "Nifty Level On Expiry",
                  ]}
                  rows={obsDisplayRows}
                  exportRows={obsExportRows}
                  columnTypes={["integer", "number", "number", "date", "date", "number"]}
                  filename={`path-${pathId}-observation-map.xlsx`}
                  sheetName="Observation Map"
                  minWidth={900}
                  maxHeight={360}
                />
              </div>
            ) : (
              <p className="mt-4 text-sm text-[var(--ar-muted)]">Loading Path Observations…</p>
            )}
          </section>

          <section className="ar-panel ar-band p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="font-serif text-xl text-[var(--ar-maroon)]">
                  Options Book By Strike
                </h3>
                <p className="text-sm text-[var(--ar-muted)] font-ui">
                  One flat table — strike identity spans rows; each observation is a metric line with its expiry
                </p>
              </div>
              {pathDetail?.legs?.length ? (
                <DownloadButton
                  onClick={() =>
                    downloadBrandedExcel(
                      `path-${pathId}-nested-options-book.xlsx`,
                      [
                        {
                          name: "Options Book",
                          title: `Options Book · Path ${pathId}`,
                          headers: [
                            "Raw option quantity",
                            "Strike as percent of spot",
                            "Strike level",
                            "Observation expiry",
                            "Option type",
                            "Forward rate",
                            "Discount rate",
                            "Implied volatility",
                            "Contract quantity",
                          ],
                          columnTypes: [
                            "number",
                            "pct_points",
                            "number",
                            "date",
                            "text",
                            "percent",
                            "percent",
                            "percent",
                            "number",
                          ],
                          rows: optionsBookRows,
                        },
                      ],
                    )
                  }
                />
              ) : null}
            </div>
            {pathDetail?.legs?.length ? (
              <NestedOptionsBook legs={pathDetail.legs} obsBuilds={pathDetail.obs_builds} />
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
