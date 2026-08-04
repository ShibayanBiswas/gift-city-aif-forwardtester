"use client";

import { Suspense, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useForwardTest } from "@/lib/store";
import { EmptyRunHint, PathDetailGate, PathSelect, SubPageTabs } from "@/components/ui/Shared";
import { formatDeskDate, formatNum, formatPct, isPlausibleTradingDate, type PathSummary } from "@/lib/api";
import { ChartFrame, PathSeriesChart } from "@/components/charts/Charts";
import { SheetTable } from "@/components/SheetTable";
import { DownloadButton } from "@/components/DownloadButton";
import { downloadBrandedExcel } from "@/lib/download";

type CompTab = "result" | "ledger" | "buy_sell" | "daily" | "costs";

const COMP_TABS: CompTab[] = ["result", "ledger", "buy_sell", "daily", "costs"];

function parseCompTab(raw: string | null): CompTab | null {
  if (!raw) return null;
  // Old Brokerage And GST tab is folded into Buy And Sell Costs.
  if (raw === "brokerage_gst") return "buy_sell";
  return COMP_TABS.includes(raw as CompTab) ? (raw as CompTab) : null;
}

/** All-in fee rate as % of notional — 6 dp so buy (0.005499%) stays distinct from sell (0.018249%). */
function formatRatePct(rate: number): string {
  return `${(rate * 100).toFixed(6)}%`;
}

function asSummary(raw: PathSummary | Record<string, number>): PathSummary {
  return raw as PathSummary;
}

const DAILY_HEADERS = [
  "Trading Date",
  "Nifty Spot",
  "Required Delta",
  "Change In Delta",
  "Futures Quantity Traded",
  "Cumulative Futures Position",
  "Futures Mark To Market",
  "Rollover Cost",
  "Tax Benefit On Roll",
  "Cash Balance",
  "Interest On Cash",
  "G-Sec Face Value",
  "Interest On G-Sec",
  "Transaction Cost",
  "Management Fees",
  "Net Asset Value",
];

const COST_HEADERS = [
  "Trading Date",
  "Side",
  "Futures Qty",
  "Nifty",
  "Buy Cost",
  "Sell Cost",
  "Total Tx",
];

export default function ComputationPage() {
  return (
    <Suspense
      fallback={
        <p className="text-sm text-[var(--ar-muted)] font-ui">Loading Computation…</p>
      }
    >
      <ComputationPageInner />
    </Suspense>
  );
}

function ComputationPageInner() {
  const { summary, pathDetail, pathId, product } = useForwardTest();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const onLedgerRoute = pathname?.startsWith("/computation/ledger") ?? false;
  const tab: CompTab =
    onLedgerRoute ? "ledger" : parseCompTab(searchParams.get("tab")) ?? "daily";

  const selectTab = (id: CompTab) => {
    if (id === "ledger") {
      router.push("/computation/ledger");
      return;
    }
    router.push(`/computation?tab=${id}`);
  };

  const s = pathDetail ? asSummary(pathDetail.summary) : null;
  const rows = (pathDetail?.computation_rows ?? []).filter((r) => isPlausibleTradingDate(r.date));
  const costRows = (pathDetail?.cost_rows ?? []).filter((r) => isPlausibleTradingDate(r.date));
  const seriesDates = (pathDetail?.dates ?? []).filter((d) => isPlausibleTradingDate(d));
  const seriesNav = useMemo(() => {
    if (!pathDetail?.daily_nav?.length) return [] as number[];
    return (pathDetail.dates ?? [])
      .map((d, i) => (isPlausibleTradingDate(d) ? pathDetail.daily_nav![i] : null))
      .filter((v): v is number => v != null && Number.isFinite(v));
  }, [pathDetail]);
  const seriesDelta = useMemo(() => {
    if (!pathDetail?.daily_delta?.length) return [] as number[];
    return (pathDetail.dates ?? [])
      .map((d, i) => (isPlausibleTradingDate(d) ? pathDetail.daily_delta![i] : null))
      .filter((v): v is number => v != null && Number.isFinite(v));
  }, [pathDetail]);

  const resultLines = useMemo(() => {
    if (!s) return [];
    return [
      {
        label: "Investment Principal",
        hint: "Opening product notional",
        value: s.invt,
        emphasize: false,
      },
      {
        label: "Mark To Market On Futures",
        hint: "Cumulative futures mark to market including rolls",
        value: s.mtm_futures,
        emphasize: false,
      },
      {
        label: "Cash Plus Interest",
        hint: "Cash buffer plus interest earned on cash",
        value: s.cash_plus_int,
        emphasize: false,
      },
      {
        label: "G-Sec Interest",
        hint: "Interest earned on the G-Sec sleeve",
        value: s.gsec,
        emphasize: false,
      },
      {
        label: "Transaction Cost",
        hint: "All-in buy and sell futures costs",
        value: s.transaction_cost,
        emphasize: false,
      },
      {
        label: "Management Fees",
        hint: "Fees charged on principal over the path tenure",
        value: s.fees,
        emphasize: false,
      },
      {
        label: "Total Terminal Value",
        hint: "Sum of all result components",
        value: s.total,
        emphasize: true,
      },
    ];
  }, [s]);

  // Desk fee card — Product Input brokerage / GST / fee.
  const feeRateRows: Array<Array<string | number>> = [
    ["Buy Brokerage", formatRatePct(product?.buy_brokerage ?? 5.32155129382014e-5)],
    ["Sell Brokerage", formatRatePct(product?.sell_brokerage ?? 0.000180715512938201)],
    ["GST Rate", formatRatePct(product?.cash_gst_rate ?? 0.18)],
    ["Management Fee Rate", formatRatePct(product?.fee_rate ?? 0.015)],
  ];

  const feeRateExportRows: Array<Array<string | number>> = [
    ["Buy Brokerage", product?.buy_brokerage ?? 5.32155129382014e-5],
    ["Sell Brokerage", product?.sell_brokerage ?? 0.000180715512938201],
    ["GST Rate", product?.cash_gst_rate ?? 0.18],
    ["Management Fee Rate", product?.fee_rate ?? 0.015],
  ];

  const pathCostRows: Array<Array<string | number>> = s
    ? [
        ["Buy Cost", formatNum(Number(s.buy_cost ?? 0), 3)],
        ["Sell Cost", formatNum(Number(s.sell_cost ?? 0), 3)],
        ["Total Transaction Cost", formatNum(Math.abs(Number(s.transaction_cost)), 3)],
      ]
    : [];

  const pathCostExportRows: Array<Array<string | number>> = s
    ? [
        ["Buy Cost", Number(s.buy_cost ?? 0)],
        ["Sell Cost", Number(s.sell_cost ?? 0)],
        ["Total Transaction Cost", Math.abs(Number(s.transaction_cost))],
      ]
    : [];

  const dailyTableRows = rows.map((r) => [
    formatDeskDate(r.date),
    formatNum(Number(r.nifty), 2),
    formatNum(Number(r.req_delta), 0),
    formatNum(Number(r.change_in_delta), 0),
    formatNum(Number(r.future_qty), 0),
    formatNum(Number(r.fut_cumulative), 0),
    formatNum(Number(r.mtm_futures), 3),
    formatNum(Number(r.rollover_cost), 3),
    formatNum(Number(r.tax_benefit), 3),
    formatNum(Number(r.cash_mtm), 3),
    formatNum(Number(r.int_on_cash), 3),
    formatNum(Number(r.gsec), 3),
    formatNum(Number(r.int_gsec), 3),
    formatNum(Number(r.tx_futures), 3),
    formatNum(Number(r.fees), 3),
    formatNum(Number(r.nav), 3),
  ]);

  const dailyExportRows = rows.map((r) => [
    String(r.date).slice(0, 10),
    Number(r.nifty),
    Number(r.req_delta),
    Number(r.change_in_delta),
    Number(r.future_qty),
    Number(r.fut_cumulative),
    Number(r.mtm_futures),
    Number(r.rollover_cost),
    Number(r.tax_benefit),
    Number(r.cash_mtm),
    Number(r.int_on_cash),
    Number(r.gsec),
    Number(r.int_gsec),
    Number(r.tx_futures),
    Number(r.fees),
    Number(r.nav),
  ]);

  const costTableRows = costRows
    .filter((r) => Number(r.total_tx) !== 0)
    .map((r) => [
      formatDeskDate(r.date),
      String(r.side),
      formatNum(Number(r.futures_qty), 0),
      formatNum(Number(r.nifty), 2),
      formatNum(Number(r.buy_cost), 3),
      formatNum(Number(r.sell_cost), 3),
      formatNum(Number(r.total_tx), 3),
    ]);

  const costExportRows = costRows
    .filter((r) => Number(r.total_tx) !== 0)
    .map((r) => [
      String(r.date).slice(0, 10),
      String(r.side),
      Number(r.futures_qty),
      Number(r.nifty),
      Number(r.buy_cost),
      Number(r.sell_cost),
      Number(r.total_tx),
    ]);

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
            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ar-subtle)] font-ui">Desk · Computation</p>
            <h2 className="font-display text-2xl text-[var(--ar-maroon)] md:text-3xl">
              Computation · Path {pathId}
            </h2>
            <p className="mt-1 text-sm text-[var(--ar-muted)] font-ui">
              Result · Daily Ledger · Costs
            </p>
          </div>
          <PathSelect className="w-full" showMeta />
        </div>
        <div className="px-5 py-3">
          <SubPageTabs
            tabs={[
              { id: "result", label: "Result" },
              { id: "ledger", label: "Daily Ledger" },
              { id: "buy_sell", label: "Buy And Sell Costs" },
              { id: "daily", label: "Daily Computation Rows" },
              { id: "costs", label: "Trade Cost Ledger" },
            ]}
            active={tab}
            onChange={(id) => selectTab(id as CompTab)}
          />
        </div>
      </motion.section>

      <PathDetailGate loadingLabel="Loading Computation For Path…">
        {pathDetail && s ? (
          <>
            <div className="flex justify-end px-1">
              <DownloadButton
                label="Download Full Path Pack"
                onClick={() =>
                  downloadBrandedExcel(
                    `path-${pathId}-computation-pack.xlsx`,
                    [
                      {
                        name: "Result",
                        title: `Path Result · ${pathId}`,
                        headers: ["Component", "Value In Crores"],
                        columnTypes: ["text", "currency"],
                        rows: resultLines.map((l) => [l.label, l.value]),
                      },
                      {
                        name: "IRR",
                        title: `Annualised IRR · Path ${pathId}`,
                        headers: ["Metric", "Rate"],
                        columnTypes: ["text", "percent"],
                        rows: [["Annualised Internal Rate Of Return", s.irr]],
                      },
                      {
                        name: "Fee Rates",
                        title: "Fee Rates · Percent Of Notional",
                        headers: ["Component", "Rate"],
                        columnTypes: ["text", "percent"],
                        rows: feeRateExportRows,
                      },
                      {
                        name: "Path Costs",
                        title: "Path Transaction Costs",
                        headers: ["Component", "Value In Crores"],
                        columnTypes: ["text", "currency"],
                        rows: pathCostExportRows,
                      },
                      {
                        name: "Daily Nav",
                        title: "Daily Computation Rows",
                        headers: DAILY_HEADERS,
                        rows: dailyExportRows,
                        columnTypes: [
                          "date",
                          "number",
                          "number",
                          "number",
                          "number",
                          "number",
                          "number",
                          "number",
                          "number",
                          "number",
                          "number",
                          "number",
                          "number",
                          "number",
                          "number",
                          "number",
                        ],
                      },
                      {
                        name: "Trade Costs",
                        title: "Trade Cost Ledger",
                        headers: COST_HEADERS,
                        rows: costExportRows,
                        columnTypes: [
                          "date",
                          "text",
                          "number",
                          "number",
                          "number",
                          "number",
                          "number",
                        ],
                      },
                      {
                        name: "NAV Series",
                        title: `Net Asset Value · Path ${pathId}`,
                        headers: ["Trading date", "Net asset value"],
                        rows: seriesDates.map((d) => {
                          const i = (pathDetail.dates ?? []).indexOf(d);
                          return [d, pathDetail.daily_nav?.[i] ?? ""];
                        }),
                        columnTypes: ["date", "number"],
                      },
                      {
                        name: "Delta Series",
                        title: `Net Required Futures Delta · Path ${pathId}`,
                        headers: ["Trading date", "Net required futures delta"],
                        rows: seriesDates.map((d) => {
                          const i = (pathDetail.dates ?? []).indexOf(d);
                          return [d, pathDetail.daily_delta?.[i] ?? ""];
                        }),
                        columnTypes: ["date", "number"],
                      },
                    ],
                    { metaLine: `Computation Pack · Path ${pathId}` },
                  )
                }
              />
            </div>

            {tab === "result" && (
              <div className="space-y-4">
                <motion.section
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="result-sheet overflow-hidden"
                >
                  <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--ar-border)] bg-gradient-to-r from-[var(--ar-table-head-from)] to-transparent px-5 py-4">
                    <div>
                      <p className="text-[10px] tracking-[0.18em] text-[var(--ar-subtle)] font-ui">
                        Computation Result Block
                      </p>
                      <h3 className="font-display text-2xl text-[var(--ar-maroon)] md:text-3xl">
                        Path Result · {pathId}
                      </h3>
                      <p className="mt-1 text-xs text-[var(--ar-muted)] font-ui">
                        Values In Crores Of Rupees · Scroll Horizontally
                      </p>
                    </div>
                    <DownloadButton
                      onClick={() =>
                        downloadBrandedExcel(`path-${pathId}-result.xlsx`, [
                          {
                            name: "Result",
                            title: `Path Result · ${pathId}`,
                            headers: ["Component", "Amount In Crores"],
                            columnTypes: ["text", "currency"],
                            rows: resultLines.map((l) => [l.label, l.value]),
                          },
                          {
                            name: "IRR",
                            title: `Annualised IRR · Path ${pathId}`,
                            headers: ["Metric", "Rate"],
                            columnTypes: ["text", "percent"],
                            rows: [["Annualised Internal Rate Of Return", s.irr]],
                          },
                        ])
                      }
                    />
                  </div>
                  <div className="computation-result-rail px-5 py-4">
                    {resultLines.map((line, i) => (
                      <motion.div
                        key={line.label}
                        className={`computation-result-card ${line.emphasize ? "computation-result-card--hero" : ""}`}
                        initial={{ opacity: 0, x: 24 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.05 * i, type: "spring", stiffness: 320, damping: 26 }}
                        whileHover={{ y: -4, scale: 1.02 }}
                      >
                        <p className="text-[10px] tracking-[0.14em] text-[var(--ar-subtle)] font-ui">{line.label}</p>
                        <p className="mt-1 text-[11px] leading-snug text-[var(--ar-muted)] font-ui">{line.hint}</p>
                        <p
                          className={`mt-3 tabular-nums ${
                            line.emphasize
                              ? "font-display text-3xl text-[var(--ar-maroon)]"
                              : "font-display text-2xl text-[var(--ar-ink)]"
                          }`}
                        >
                          {formatNum(line.value, 3)}
                        </p>
                      </motion.div>
                    ))}
                    <motion.div
                      className="computation-result-card computation-result-card--irr"
                      initial={{ opacity: 0, x: 24 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 * resultLines.length, type: "spring", stiffness: 320, damping: 26 }}
                      whileHover={{ y: -4, scale: 1.02 }}
                    >
                      <p className="text-[10px] tracking-[0.14em] text-[var(--ar-subtle)] font-ui">
                        Annualised Internal Rate Of Return
                      </p>
                      <p className="mt-1 text-[11px] leading-snug text-[var(--ar-muted)] font-ui">
                        IRR On Terminal Value Over Path Tenure Days
                      </p>
                      <p className="mt-3 font-display text-4xl tabular-nums text-[var(--ar-maroon)]">
                        {formatPct(s.irr, 3)}
                      </p>
                    </motion.div>
                    <motion.div
                      role="button"
                      tabIndex={0}
                      className="computation-result-card computation-result-card--ledger cursor-pointer"
                      initial={{ opacity: 0, x: 24 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        delay: 0.05 * (resultLines.length + 1),
                        type: "spring",
                        stiffness: 320,
                        damping: 26,
                      }}
                      whileHover={{ y: -4, scale: 1.02 }}
                      onClick={() => selectTab("ledger")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          selectTab("ledger");
                        }
                      }}
                    >
                      <p className="text-[10px] tracking-[0.14em] text-[var(--ar-subtle)] font-ui">
                        Daily Ledger
                      </p>
                      <p className="mt-1 text-[11px] leading-snug text-[var(--ar-muted)] font-ui">
                        Full-Width Net Asset Value And Futures Delta Charts
                      </p>
                      <p className="mt-3 font-display text-2xl text-[var(--ar-maroon)]">Open Charts</p>
                    </motion.div>
                  </div>
                </motion.section>
              </div>
            )}

            {tab === "ledger" && (
              <div className="space-y-4">
                <motion.section
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="ar-panel ar-band overflow-hidden p-5"
                >
                  <p className="text-[10px] tracking-[0.18em] text-[var(--ar-subtle)] font-ui">Daily Ledger</p>
                  <h3 className="font-display text-2xl text-[var(--ar-maroon)]">
                    Path {pathId} · Daily Series
                  </h3>
                  <p className="mt-1 text-sm text-[var(--ar-muted)] font-ui">
                    Net Asset Value And Required Futures Delta · Each Chart Full Horizontal Width
                  </p>
                </motion.section>

                {seriesNav.length > 1 ? (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    <ChartFrame
                      title={`Path ${pathId} · Net Asset Value`}
                      subtitle={
                        seriesDates.length
                          ? `${formatDeskDate(seriesDates[0])} → ${formatDeskDate(seriesDates[seriesDates.length - 1])} · Daily Ledger`
                          : "Daily Ledger · Full Width"
                      }
                      height="h-80"
                    >
                      <PathSeriesChart
                        dates={seriesDates}
                        values={seriesNav}
                        yLabel="Net Asset Value In ₹ Crores"
                        color="#d4b24c"
                        seriesName="Net Asset Value In ₹ Crores"
                      />
                    </ChartFrame>
                  </motion.div>
                ) : null}

                {seriesDelta.length > 1 ? (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08 }}
                  >
                    <ChartFrame
                      title={`Path ${pathId} · Net Required Futures Delta`}
                      subtitle="Daily Ledger · Sum Of Option Deltas Times Contract Quantity"
                      height="h-80"
                    >
                      <PathSeriesChart
                        dates={seriesDates}
                        values={seriesDelta}
                        yLabel="Net Required Futures Delta"
                        color="#7a1e2c"
                        seriesName="Net Required Futures Delta"
                        showZeroLine
                      />
                    </ChartFrame>
                  </motion.div>
                ) : null}
              </div>
            )}

            {tab === "buy_sell" && (
              <div className="space-y-4">
                <SheetTable
                  title="Fee Rates"
                  subtitle="All-in buy and sell rates · percent of traded notional"
                  headers={["Component", "Rate"]}
                  rows={feeRateRows}
                  exportRows={feeRateExportRows}
                  columnTypes={["text", "percent"]}
                  filename={`path-${pathId}-fee-rates.xlsx`}
                  sheetName="Fee Rates"
                  minWidth={520}
                />
                <SheetTable
                  title="Path Transaction Costs"
                  subtitle="All-in buy and sell costs · ₹ crores · Buy + Sell = Total"
                  headers={["Component", "Value In Crores"]}
                  rows={pathCostRows}
                  exportRows={pathCostExportRows}
                  columnTypes={["text", "currency"]}
                  filename={`path-${pathId}-path-costs.xlsx`}
                  sheetName="Path Costs"
                  minWidth={520}
                />
              </div>
            )}

            {tab === "daily" && (
              <SheetTable
                title="Daily Computation Rows"
                subtitle={
                  rows.length
                    ? `${formatDeskDate(rows[0]?.date)} → ${formatDeskDate(rows[rows.length - 1]?.date)} · ${rows.length} Trading Days`
                    : "Net Asset Value Engine Ledger"
                }
                headers={DAILY_HEADERS}
                rows={dailyTableRows}
                exportRows={dailyExportRows}
                columnTypes={[
                  "date",
                  "number",
                  "number",
                  "number",
                  "number",
                  "number",
                  "number",
                  "number",
                  "number",
                  "number",
                  "number",
                  "number",
                  "number",
                  "number",
                  "number",
                  "number",
                ]}
                filename={`path-${pathId}-daily-computation.xlsx`}
                sheetName="Daily Nav"
                minWidth={1600}
                maxHeight={520}
              />
            )}

            {tab === "costs" && (
              <SheetTable
                title="Trade Cost Ledger"
                subtitle="Days With Futures Quantity Change"
                headers={COST_HEADERS}
                rows={costTableRows}
                exportRows={costExportRows}
                columnTypes={[
                  "date",
                  "text",
                  "number",
                  "number",
                  "number",
                  "number",
                  "number",
                ]}
                filename={`path-${pathId}-trade-costs.xlsx`}
                sheetName="Trade Costs"
                minWidth={900}
                maxHeight={520}
              />
            )}
          </>
        ) : null}
      </PathDetailGate>
    </div>
  );
}
