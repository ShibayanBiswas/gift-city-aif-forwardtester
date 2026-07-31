"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useForwardTest } from "@/lib/store";
import { formatDeskDate, formatNum, formatPct, FREQUENCY_LABELS, isPlausibleTradingDate } from "@/lib/api";
import { EmptyRunHint, KpiBand } from "@/components/ui/Shared";
import { SheetTable } from "@/components/SheetTable";

export default function SummaryTablePage() {
  const { filteredSummary, sinceYear, setSinceYear, years, setPathId, frequency } = useForwardTest();
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
    <div className="space-y-5">
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="ar-panel ar-band overflow-hidden"
      >
        <div className="relative overflow-hidden border-b border-[var(--ar-border)] bg-gradient-to-r from-[var(--ar-table-head-from)] via-transparent to-[rgba(122,30,44,0.06)] px-6 py-6">
          <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-[rgba(212,178,76,0.18)] blur-3xl" />
          <div className="pointer-events-none absolute -bottom-12 left-1/3 h-36 w-36 rounded-full bg-[rgba(122,30,44,0.08)] blur-3xl" />
          <div className="relative z-[1] flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0 max-w-3xl">
              <p className="text-xs tracking-[0.22em] text-[var(--ar-subtle)] font-ui">Analytics · Summary</p>
              <h2 className="font-display text-3xl text-[var(--ar-maroon)] md:text-4xl">
                Path Summary Since {sinceYear}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ar-muted)] font-ui">
                Every completed path from the Summary sheet. Filter from 2001 onward, then click a row to select that
                path across Desk pages. Frequency · {FREQUENCY_LABELS[frequency] ?? frequency}.
              </p>
            </div>
            <label className="block font-ui">
              <span className="mb-1.5 block text-[10px] tracking-[0.18em] text-[var(--ar-subtle)]">
                Since Calendar Year
              </span>
              <select
                value={sinceYear}
                onChange={(e) => setSinceYear(Number(e.target.value))}
                className="desk-select min-w-[12rem]"
              >
                {(years.length ? years : [2001]).map((y) => (
                  <option key={y} value={y}>
                    Since {y}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="relative z-[1] mt-5">
            <KpiBand />
          </div>
        </div>
      </motion.section>

      <SheetTable
        title={`All Simulation Paths Since ${sinceYear}`}
        subtitle="Click A Row To Select That Path Across Desk Pages · Horizontal Scroll Enabled"
        headers={[
          "Path Number",
          "Start Date",
          "End Date",
          "Trading Days",
          "Start Nifty",
          "End Nifty",
          "Investment In Crores",
          "Futures MTM In Crores",
          "Cash And Interest",
          "G-Sec Interest",
          "Transaction Cost",
          "Management Fees",
          "Terminal Total",
          "Internal Rate Of Return",
          "Absolute Nifty Return",
        ]}
        rows={rows}
        exportRows={exportRows}
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
        filename={`path-summary-since-${sinceYear}.xlsx`}
        sheetName="Path Summary"
        minWidth={1400}
        maxHeight={640}
        onRowClick={(i) => setPathId(filteredSummary[i].path_id)}
      />
    </div>
  );
}
