"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useForwardTest } from "@/lib/store";
import { formatDeskDate, formatNum, formatPct, isPlausibleTradingDate } from "@/lib/api";
import { EmptyRunHint, KpiBand, PathSelect } from "@/components/ui/Shared";
import { SheetTable } from "@/components/SheetTable";

export default function SummaryTablePage() {
  const { filteredSummary, setPathId } = useForwardTest();
  const rows = useMemo(
    () =>
      filteredSummary.map((r) => [
        r.path_id,
        formatDeskDate(r.start),
        formatDeskDate(r.end),
        r.n_trading_days ?? "—",
        Number(r.start_nifty?.toFixed?.(2) ?? r.start_nifty ?? 0),
        Number(r.end_nifty?.toFixed?.(2) ?? r.end_nifty ?? 0),
        formatNum(r.invt),
        formatNum(r.mtm_futures),
        formatNum(r.cash_plus_int),
        formatNum(r.gsec),
        formatNum(r.transaction_cost),
        formatNum(r.fees),
        formatNum(r.total),
        formatPct(r.irr),
        formatPct(r.abs_nifty_ret),
      ]),
    [filteredSummary],
  );

  const exportRows = useMemo(
    () =>
      filteredSummary
        .filter((r) => isPlausibleTradingDate(r.start) && isPlausibleTradingDate(r.end))
        .map((r) => [
          r.path_id,
          r.start,
          r.end,
          r.n_trading_days ?? "",
          r.start_nifty,
          r.end_nifty,
          r.invt,
          r.mtm_futures,
          r.cash_plus_int,
          r.gsec,
          r.transaction_cost,
          r.fees,
          r.total,
          r.irr,
          r.abs_nifty_ret,
        ]),
    [filteredSummary],
  );

  if (!filteredSummary.length) return <EmptyRunHint />;

  return (
    <div className="space-y-4">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="ar-panel ar-band overflow-hidden"
      >
        <div className="relative border-b border-[var(--ar-border)] bg-gradient-to-r from-[var(--ar-table-head-from)] to-transparent px-6 py-5">
          <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-[rgba(212,178,76,0.12)] blur-3xl" />
          <div className="pointer-events-none absolute -bottom-12 left-1/3 h-36 w-36 rounded-full bg-[rgba(122,30,44,0.08)] blur-3xl" />
          <div className="relative z-[1] flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0 max-w-3xl">
              <p className="text-xs tracking-[0.22em] text-[var(--ar-subtle)] font-ui">Analytics · Summary</p>
              <h2 className="font-display text-3xl text-[var(--ar-maroon)] md:text-4xl">Path Summary</h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ar-muted)] font-ui">
                One row per path. Use the selector below, or click a row, to open that path on Desk pages.
              </p>
            </div>
          </div>

          <div className="relative z-[1] mt-5 space-y-4">
            <PathSelect className="w-full" />
            <KpiBand />
          </div>
        </div>
      </motion.section>

      <SheetTable
        title="Path Results"
        subtitle="Click a row to select that path"
        headers={[
          "Path",
          "Start",
          "End",
          "Trading Days",
          "Start Nifty",
          "End Nifty",
          "Investment",
          "MTM Futures",
          "Cash + Interest",
          "G-Sec",
          "Transaction Cost",
          "Fees",
          "Total",
          "IRR",
          "Abs Nifty Return",
        ]}
        rows={rows}
        exportRows={exportRows}
        filename="path-summary.xlsx"
        sheetName="Path Summary"
        onRowClick={(i) => setPathId(filteredSummary[i]?.path_id ?? 1)}
        minWidth={1200}
        maxHeight={560}
        columnTypes={[
          "integer",
          "date",
          "date",
          "integer",
          "number",
          "number",
          "currency",
          "currency",
          "currency",
          "currency",
          "currency",
          "currency",
          "currency",
          "percent",
          "percent",
        ]}
      />
    </div>
  );
}
