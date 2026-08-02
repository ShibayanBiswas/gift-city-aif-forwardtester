"use client";

import { motion } from "framer-motion";
import type { ProductSpec } from "@/lib/api";
import { formatDeskDate, formatNum, tradeSideLabel, addCalendarDaysIso } from "@/lib/api";
import { useForwardTest } from "@/lib/store";
import { DownloadButton } from "@/components/DownloadButton";
import { downloadBrandedExcel, type CellValue, type ColumnType } from "@/lib/download";

function isActiveLeg(l: { include?: boolean }): boolean {
  return l.include !== false;
}

function optionTypeText(code?: string | null): string {
  return (code || "P").toUpperCase().startsWith("C") ? "Call Option" : "Put Option";
}

/**
 * Desk units (must stay consistent everywhere):
 * - quantity: signed raw qty (−91.5)
 * - strike_pct: percent-of-spot points (137 = 137%)
 * - return_level: fraction (0.37 = +37%)
 * - forward / discount / vol: fractions (0.066 = 6.6%)
 */
export function optionsBookRowsFromProduct(product: ProductSpec): CellValue[][] {
  return product.legs.filter(isActiveLeg).map((l, i) => [
    i + 1,
    tradeSideLabel(l.quantity, l.option_type),
    optionTypeText(l.option_type),
    Number(l.quantity.toFixed(3)),
    Number(l.strike_pct.toFixed(6)),
    Number(l.return_level.toFixed(6)),
    l.forward_rate != null ? Number(l.forward_rate.toFixed(6)) : "",
    l.discount_rate != null ? Number(l.discount_rate.toFixed(6)) : "",
    l.vol_near != null ? Number(l.vol_near.toFixed(8)) : "",
    l.vol != null ? Number(l.vol.toFixed(8)) : "",
  ]);
}

/** Compact unique-leg table for Hedging Sheet (display strings). */
export function uniqueOptionsBookDisplayRows(product: ProductSpec): Array<Array<string | number>> {
  return product.legs.filter(isActiveLeg).map((l, i) => [
    i + 1,
    tradeSideLabel(l.quantity, l.option_type),
    Number(l.quantity.toFixed(3)),
    `${formatNum(l.strike_pct, 3)}%`,
    `${(l.return_level * 100).toFixed(3)}%`,
  ]);
}

/** Typed Excel export for the compact unique-leg table. */
export function uniqueOptionsBookExportRows(product: ProductSpec): CellValue[][] {
  return product.legs.filter(isActiveLeg).map((l, i) => [
    i + 1,
    tradeSideLabel(l.quantity, l.option_type),
    Number(l.quantity.toFixed(3)),
    Number(l.strike_pct.toFixed(6)),
    Number(l.return_level.toFixed(6)),
  ]);
}

export const UNIQUE_OPTIONS_BOOK_COLUMN_TYPES: ColumnType[] = [
  "integer",
  "text",
  "number",
  "pct_points",
  "percent",
];

const OBS_HEADERS = ["#", "Month Offset", "Calendar Days From Start"] as const;

const FUND_HEADERS = ["Parameter", "Value"] as const;

const LEG_HEADERS = [
  "#",
  "Trade Side",
  "Option Type",
  "Raw Quantity",
  "Strike Percent",
  "Return Level",
  "Forward",
  "Discount",
  "Vol Near",
  "Vol Far",
] as const;

function pctLabel(v: number | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function fundEconomicsRows(product: ProductSpec): Array<[string, string]> {
  const cashPct = product.cash_pct ?? 0.05;
  const gsecPct = product.gsec_pct ?? 1 - cashPct;
  const rows: Array<[string, string]> = [
    ["Principal", `${formatNum(product.principal_cr, 2)} Crores`],
    ["Tenure", `${product.tenure_days} Calendar Days`],
    ["Cash Buffer %", pctLabel(cashPct)],
    ["G-Sec Sleeve %", pctLabel(gsecPct)],
    ["Cash Interest Rate", pctLabel(product.cash_rate ?? 0.06)],
    ["G-Sec Interest Rate", pctLabel(product.gsec_rate ?? 0.06)],
    ["Management Fee Rate", pctLabel(product.fee_rate ?? 0.015)],
    ["Buy Brokerage", pctLabel(product.buy_brokerage, 6)],
    ["Sell Brokerage", pctLabel(product.sell_brokerage, 6)],
    ["GST Rate", pctLabel(product.cash_gst_rate ?? 0.18)],
    ["Futures Roll Rate", pctLabel(product.roll_rate ?? 0.07)],
    ["Tax Benefit On Roll", pctLabel(product.tax_benefit_rate ?? 0.42744)],
  ];
  if (product.simulation_end_days != null) {
    rows.push(["Simulation End Days", String(product.simulation_end_days)]);
  }
  return rows;
}

const LEG_COLUMN_TYPES: ColumnType[] = [
  "integer",
  "text",
  "text",
  "number",
  "pct_points",
  "percent",
  "percent",
  "percent",
  "percent",
  "percent",
];

const thClass =
  "whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold tracking-wide text-[var(--ar-subtle)]";
const tdClass = "whitespace-nowrap px-3 py-2.5 text-sm font-ui";

export function ProductSpecTables({ product }: { product: ProductSpec }) {
  const displayName = product.name === "Default Product" ? "Current Product" : product.name;
  const activeLegs = product.legs.filter(isActiveLeg);
  const activeCount = activeLegs.length;

  const obsRows = product.observation_months.map((m, i) => [i + 1, m, Number((m * 30.5).toFixed(1))]);
  const legRows = optionsBookRowsFromProduct(product);
  const fundRows = fundEconomicsRows(product);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <DownloadButton
          label="Download Product Excel"
          onClick={() =>
            downloadBrandedExcel(
              `product-${displayName.replace(/\s+/g, "-").toLowerCase()}.xlsx`,
              [
                {
                  name: "Fund Economics",
                  title: `${displayName} · Fund Economics`,
                  subtitle: `Principal ${formatNum(product.principal_cr, 2)} Cr · Cash ${pctLabel(product.cash_pct ?? 0.05)} / G-Sec ${pctLabel(product.gsec_pct ?? 0.95)}`,
                  headers: [...FUND_HEADERS],
                  rows: fundRows,
                  columnTypes: ["text", "text"],
                },
                {
                  name: "Observation Months",
                  title: `${displayName} · Observation Months`,
                  subtitle: `Principal ${product.principal_cr} Cr · Tenure ${product.tenure_days} Days · ${product.n_obs} Observations`,
                  headers: [...OBS_HEADERS],
                  rows: obsRows,
                  columnTypes: ["integer", "number", "number"],
                },
                {
                  name: "Options Book",
                  title: `${displayName} · Options Book`,
                  subtitle: `${activeCount} Legs · Product Input Order`,
                  headers: [...LEG_HEADERS],
                  columnTypes: LEG_COLUMN_TYPES,
                  rows: legRows,
                },
              ],
              { metaLine: `Product Definition · ${displayName}` },
            )
          }
        />
      </div>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass glass-glow-cyan w-full overflow-hidden rounded-2xl"
      >
        <div className="border-b border-[var(--ar-border)] bg-gradient-to-r from-[var(--ar-table-head-from)] to-[var(--ar-table-head-to)] px-5 py-3">
          <p className="text-[10px] tracking-[0.2em] text-[var(--ar-subtle)] font-ui">Product Input</p>
          <h3 className="font-serif text-lg text-[var(--ar-maroon)]">Fund Economics</h3>
          <p className="mt-1 text-xs text-[var(--ar-muted)] font-ui">
            From Product Input. Day-zero Cash / G-Sec = principal × Cash Buffer % / G-Sec Sleeve %.
            Futures Tx uses Buy/Sell Brokerage every trading day.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table-premium sheet-table-fill w-full min-w-[480px] text-left">
            <thead>
              <tr>
                {FUND_HEADERS.map((h) => (
                  <th key={h} className={thClass}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fundRows.map(([label, value]) => (
                <tr key={label} className="odd:bg-[var(--ar-row-alt)]">
                  <td className={`${tdClass} font-medium`}>{label}</td>
                  <td className={`${tdClass} tabular-nums`}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass glass-glow-cyan w-full overflow-hidden rounded-2xl"
      >
        <div className="border-b border-[var(--ar-border)] bg-gradient-to-r from-[var(--ar-table-head-from)] to-[var(--ar-table-head-to)] px-5 py-3">
          <p className="text-[10px] tracking-[0.2em] text-[var(--ar-subtle)] font-ui">Product Schedule</p>
          <h3 className="font-serif text-lg text-[var(--ar-maroon)]">Observation Months</h3>
          <p className="mt-1 text-xs text-[var(--ar-muted)] font-ui">
            {product.n_obs} Observations · Month Offset × 30.5 Days From Path Start
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table-premium sheet-table-fill w-full min-w-[480px] text-left">
            <thead>
              <tr>
                {OBS_HEADERS.map((h) => (
                  <th key={h} className={thClass}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {product.observation_months.map((m, i) => (
                <tr key={`${m}-${i}`} className="odd:bg-[var(--ar-row-alt)]">
                  <td className={`${tdClass} tabular-nums`}>{i + 1}</td>
                  <td className={`${tdClass} tabular-nums font-medium`}>{m}</td>
                  <td className={`${tdClass} tabular-nums text-[var(--ar-muted)]`}>{(m * 30.5).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="glass glass-glow-purple w-full overflow-hidden rounded-2xl"
      >
        <div className="border-b border-[var(--ar-border)] bg-gradient-to-r from-[var(--ar-table-head-from)] to-[var(--ar-table-head-to)] px-5 py-3">
          <p className="text-[10px] tracking-[0.2em] text-[var(--ar-subtle)] font-ui">Product Options Book</p>
          <h3 className="font-serif text-lg text-[var(--ar-maroon)]">Options Book</h3>
          <p className="mt-1 text-xs text-[var(--ar-muted)] font-ui">
            {activeCount} Active Legs · Product Input Order · Strike As Percent Of Spot
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table-premium sheet-table-fill w-full min-w-[960px] text-left">
            <thead>
              <tr>
                {LEG_HEADERS.map((h) => (
                  <th key={h} className={thClass}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeLegs.map((l, i) => (
                <tr key={`leg-${i}-${l.quantity}-${l.return_level}`} className="odd:bg-[var(--ar-row-alt)]">
                  <td className={`${tdClass} tabular-nums text-[var(--ar-subtle)]`}>{i + 1}</td>
                  <td className={tdClass}>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] tracking-wide ${
                        l.quantity < 0
                          ? "bg-[rgba(122,30,44,0.12)] text-[var(--ar-maroon)]"
                          : "bg-[rgba(212,178,76,0.2)] text-[var(--ar-gold-dark)]"
                      }`}
                    >
                      {tradeSideLabel(l.quantity, l.option_type)}
                    </span>
                  </td>
                  <td className={`${tdClass} font-medium`}>{optionTypeText(l.option_type)}</td>
                  <td className={`${tdClass} tabular-nums font-medium`}>{formatNum(l.quantity, 1)}</td>
                  <td className={`${tdClass} tabular-nums`}>{formatNum(l.strike_pct, 3)}%</td>
                  <td className={`${tdClass} tabular-nums`}>{(l.return_level * 100).toFixed(3)}%</td>
                  <td className={`${tdClass} tabular-nums`}>
                    {l.forward_rate != null ? `${(l.forward_rate * 100).toFixed(3)}%` : "—"}
                  </td>
                  <td className={`${tdClass} tabular-nums`}>
                    {l.discount_rate != null ? `${(l.discount_rate * 100).toFixed(3)}%` : "—"}
                  </td>
                  <td className={`${tdClass} tabular-nums`}>
                    {l.vol_near != null ? `${(l.vol_near * 100).toFixed(3)}%` : "—"}
                  </td>
                  <td className={`${tdClass} tabular-nums`}>
                    {l.vol != null ? `${(l.vol * 100).toFixed(3)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.section>
    </div>
  );
}

export function ProductMetaStrip({ product }: { product: ProductSpec }) {
  const { market } = useForwardTest();
  const activeCount = product.legs.filter(isActiveLeg).length;
  // Always live product + market horizon (never last-run summary).
  const simDays = product.simulation_end_days ?? market?.simulation_end_days ?? null;
  const simEnd =
    market?.simulation_end ??
    (market?.last_date && simDays != null
      ? addCalendarDaysIso(market.last_date, Number(simDays))
      : null);
  const items = [
    { label: "Principal Amount", value: `${formatNum(product.principal_cr, 2)} Crores` },
    { label: "Product Tenure", value: `${product.tenure_days} Calendar Days` },
    { label: "Observation Count", value: String(product.n_obs) },
    { label: "Active Option Legs", value: String(activeCount) },
    ...(simDays != null
      ? [{ label: "Simulation End Days", value: String(simDays) }]
      : []),
    ...(simEnd
      ? [{ label: "Simulation End", value: formatDeskDate(simEnd) }]
      : []),
  ];
  return (
    <div className="w-full overflow-x-auto pb-1">
      <div className="flex min-w-full gap-3">
        {items.map((it) => (
          <div key={it.label} className="glass min-w-[11.5rem] flex-1 rounded-2xl px-4 py-3">
            <p className="text-[10px] tracking-[0.16em] text-[var(--ar-subtle)] font-ui">{it.label}</p>
            <p className="mt-1 font-display text-lg text-[var(--ar-maroon)]">{it.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
