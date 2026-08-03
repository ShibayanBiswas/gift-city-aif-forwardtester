"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { formatDeskDate, formatNum, isPlausibleTradingDate, optionTypeLabel, tradeSideLabel, withHorizontalMinus } from "@/lib/api";

export type OptionLegRow = {
  raw_qty?: number;
  strike_pct: number;
  strike: number;
  expiry: string;
  option?: string;
  forward?: number;
  discount?: number;
  vol: number;
  quantity: number;
};

export type ObsBuildRow = {
  expiry: string;
  nifty: number;
};

type StrikeGroup = {
  key: string;
  raw: number;
  strikePct: number;
  strike: number;
  option: string;
  forward: string;
  discount: string;
  vol: string;
  quantity: string;
  expiries: string[];
};

function fmtPct(rate: number, digits = 0) {
  return withHorizontalMinus(`${(rate * 100).toFixed(digits)}%`);
}

function buildGroups(legs: OptionLegRow[]): StrikeGroup[] {
  // First-seen order only — never sort by Sold / Bought.
  const groups: StrikeGroup[] = [];
  const map = new Map<string, StrikeGroup>();

  for (const lg of legs) {
    if (!isPlausibleTradingDate(lg.expiry)) continue;
    const key = `${lg.raw_qty ?? 0}|${Number(lg.strike_pct).toFixed(6)}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        raw: lg.raw_qty ?? 0,
        strikePct: lg.strike_pct,
        strike: lg.strike,
        option: optionTypeLabel(lg.option),
        forward: lg.forward != null && Number.isFinite(lg.forward) ? fmtPct(lg.forward, 3) : "—",
        discount: lg.discount != null && Number.isFinite(lg.discount) ? fmtPct(lg.discount, 3) : "—",
        vol: fmtPct(lg.vol, 3),
        quantity: formatNum(lg.quantity, 3),
        expiries: [],
      };
      map.set(key, g);
      groups.push(g);
    }
    if (!g.expiries.includes(lg.expiry)) g.expiries.push(lg.expiry);
  }

  return groups;
}

/**
 * Flat table with rowSpan grouping (Primary SP “Underlying Levels” pattern).
 * Strike identity spans metric rows; each observation is a Metric + Expiry + Nifty row.
 */
export function NestedOptionsBook({
  legs,
  obsBuilds,
}: {
  legs: OptionLegRow[];
  obsBuilds?: ObsBuildRow[];
}) {
  const groups = useMemo(() => buildGroups(legs), [legs]);
  const niftyByExpiry = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of obsBuilds ?? []) {
      if (!isPlausibleTradingDate(b?.expiry)) continue;
      map.set(b.expiry, Number(b.nifty));
    }
    return map;
  }, [obsBuilds]);

  if (!groups.length) {
    return <p className="text-sm text-[var(--ar-muted)] font-ui">No option legs for this path.</p>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="sheet-card"
    >
      <div className="desk-rail-scroll overflow-x-auto">
        <table className="data-table-premium sheet-table-fill analytics-stats-table w-full min-w-[1200px] text-left text-sm font-ui">
          <thead className="sticky top-0 z-10 bg-gradient-to-r from-[var(--ar-table-head-from)] to-[var(--ar-table-head-to)] text-xs tracking-wide">
            <tr>
              <th className="px-3 py-2.5">Trade Side</th>
              <th className="px-3 py-2.5 text-right">Raw Quantity</th>
              <th className="px-3 py-2.5 text-right">Strike Percent</th>
              <th className="px-3 py-2.5 text-right">Strike Level</th>
              <th className="px-3 py-2.5">Option Type</th>
              <th className="px-3 py-2.5 text-right">Forward</th>
              <th className="px-3 py-2.5 text-right">Discount</th>
              <th className="px-3 py-2.5 text-right">Volatility</th>
              <th className="px-3 py-2.5 text-right">Contract Qty</th>
              <th className="px-3 py-2.5">Metric</th>
              <th className="px-3 py-2.5">Expiry Date</th>
              <th className="px-3 py-2.5 text-right">Nifty On Expiry</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const n = Math.max(1, g.expiries.length);
              const rows = g.expiries.length ? g.expiries : ["—"];
              return rows.map((exp, rowIndex) => {
                const nifty = niftyByExpiry.get(exp);
                return (
                  <tr
                    key={`${g.key}-${exp}-${rowIndex}`}
                    className="border-b border-[var(--ar-border)] border-l-4 border-l-[rgba(212,178,76,0.45)] odd:bg-[var(--ar-row-alt)]"
                  >
                    {rowIndex === 0 ? (
                      <>
                        <td
                          className="px-3 py-3.5 pl-4 align-top font-semibold text-[var(--ar-maroon)]"
                          rowSpan={n}
                        >
                          {tradeSideLabel(g.raw, g.option)}
                        </td>
                        <td className="cell-value px-3 py-3.5 align-top text-right tabular-nums font-semibold" rowSpan={n}>
                          {formatNum(g.raw, 1)}
                        </td>
                        <td className="cell-value px-3 py-3.5 align-top text-right tabular-nums font-semibold" rowSpan={n}>
                          {formatNum(g.strikePct, 3)}%
                        </td>
                        <td className="cell-value px-3 py-3.5 align-top text-right tabular-nums font-semibold" rowSpan={n}>
                          {formatNum(g.strike, 0)}
                        </td>
                        <td className="px-3 py-3.5 align-top font-semibold" rowSpan={n}>
                          {g.option}
                        </td>
                        <td className="cell-value px-3 py-3.5 align-top text-right tabular-nums" rowSpan={n}>
                          {g.forward}
                        </td>
                        <td className="cell-value px-3 py-3.5 align-top text-right tabular-nums" rowSpan={n}>
                          {g.discount}
                        </td>
                        <td className="cell-value px-3 py-3.5 align-top text-right tabular-nums" rowSpan={n}>
                          {g.vol}
                        </td>
                        <td
                          className="cell-value-highlight px-3 py-3.5 align-top text-right tabular-nums font-semibold text-[var(--ar-maroon)]"
                          rowSpan={n}
                        >
                          {g.quantity}
                        </td>
                      </>
                    ) : null}
                    <td className="cell-metric px-3 py-3.5 font-semibold text-[var(--ar-ink)]">
                      Observation {rowIndex + 1}
                    </td>
                    <td className="cell-value px-3 py-3.5 tabular-nums font-medium text-[var(--ar-ink)]">
                      {formatDeskDate(exp)}
                    </td>
                    <td className="cell-value px-3 py-3.5 pr-4 text-right tabular-nums font-semibold text-[var(--ar-maroon)]">
                      {nifty != null && Number.isFinite(nifty) ? formatNum(nifty, 1) : "—"}
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
