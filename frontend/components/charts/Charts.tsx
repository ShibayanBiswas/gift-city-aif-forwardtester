"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";
import { AnimatePresence, motion } from "framer-motion";
import { formatNum } from "@/lib/api";

export function ChartFrame({
  title,
  subtitle,
  children,
  height = "h-80",
  sinceYear,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  height?: string;
  /** When set, remounts the chart module whenever the Since-year filter changes. */
  sinceYear?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="ar-panel ar-band overflow-hidden p-5"
    >
      <div className="mb-4 flex items-end gap-3">
        <div className="min-w-0 flex-1">
          {subtitle ? (
            <p className="text-[10px] tracking-[0.22em] text-[var(--ar-subtle)] font-ui">{subtitle}</p>
          ) : null}
          <h3 className="font-display text-xl text-[var(--ar-maroon)] md:text-2xl">{title}</h3>
        </div>
        {sinceYear != null ? (
          <span className="chart-since-pill ml-auto shrink-0 font-ui">Since {sinceYear}</span>
        ) : null}
      </div>
      <div className={`chart-shell ${height}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={sinceYear ?? "static"}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="h-full w-full"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

const tooltipBox: CSSProperties = {
  background: "var(--ar-surface)",
  border: "1px solid var(--ar-chart-border)",
  borderRadius: 14,
  boxShadow: "var(--ar-shadow)",
  padding: "10px 12px",
  color: "var(--ar-ink)",
};

const legendStyle: CSSProperties = {
  fontSize: 11,
  paddingTop: 8,
  color: "var(--ar-muted)",
};

type YearlyChartRow = {
  year: number;
  paths?: number;
  mean_total: number;
  median_total: number;
};

const YEARLY_SERIES: Record<string, { label: string; color: string }> = {
  mean_total: { label: "Mean Terminal In Crores", color: "#7a1e2c" },
  median_total: { label: "Median Terminal In Crores", color: "#d4b24c" },
};

function YearlyBarTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as YearlyChartRow | undefined;
  if (!row) return null;

  const seen = new Set<string>();
  const items: Array<{ key: string; label: string; color: string; value: number }> = [];
  for (const entry of payload) {
    const key = String(entry.dataKey ?? "");
    const meta = YEARLY_SERIES[key];
    if (!meta || seen.has(key)) continue;
    seen.add(key);
    const value = key === "mean_total" ? row.mean_total : row.median_total;
    if (!Number.isFinite(value)) continue;
    items.push({ key, label: meta.label, color: meta.color, value });
  }
  if (!items.length) return null;

  const year = row.year ?? label;

  return (
    <div style={tooltipBox} className="font-ui text-xs">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ar-subtle)]">
        Path Start Year · {year}
      </p>
      {typeof row.paths === "number" ? (
        <p className="mt-1 text-[var(--ar-muted)]">Number Of Paths · {row.paths}</p>
      ) : null}
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-[var(--ar-ink)]">
              <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
              {item.label}
            </span>
            <strong className="tabular-nums text-[var(--ar-maroon)]">{formatNum(item.value, 3)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Theme-aware grid props shared by yearly and path charts. */
const PLOT_GRID_PROPS = {
  stroke: "var(--ar-chart-grid-strong)",
  strokeDasharray: "3 5",
  strokeWidth: 1,
  vertical: true,
  horizontal: true,
} as const;

export function YearlyTotalChart({
  data,
  sinceYear,
}: {
  data: YearlyChartRow[];
  sinceYear?: number;
}) {
  if (!data.length) {
    return (
      <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-1 px-4 text-center font-ui">
        <p className="font-display text-lg text-[var(--ar-maroon)]">No Yearly Paths In View</p>
        <p className="text-xs text-[var(--ar-muted)]">
          {sinceYear != null
            ? `Widen the Since ${sinceYear} filter to illuminate this chart`
            : "Run a forward test to populate yearly terminals"}
        </p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 16, right: 18, left: 14, bottom: 52 }}>
        <defs>
          <linearGradient id="barMean" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7a1e2c" stopOpacity={0.98} />
            <stop offset="55%" stopColor="#7a1e2c" stopOpacity={0.78} />
            <stop offset="100%" stopColor="#7a1e2c" stopOpacity={0.5} />
          </linearGradient>
          <linearGradient id="barMedian" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d4b24c" stopOpacity={0.98} />
            <stop offset="55%" stopColor="#d4b24c" stopOpacity={0.82} />
            <stop offset="100%" stopColor="#b8860b" stopOpacity={0.55} />
          </linearGradient>
          <linearGradient id="areaMeanShade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7a1e2c" stopOpacity={0.26} />
            <stop offset="70%" stopColor="#7a1e2c" stopOpacity={0.08} />
            <stop offset="100%" stopColor="#7a1e2c" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="areaMedianShade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d4b24c" stopOpacity={0.3} />
            <stop offset="70%" stopColor="#d4b24c" stopOpacity={0.1} />
            <stop offset="100%" stopColor="#d4b24c" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...PLOT_GRID_PROPS} />
        <XAxis
          dataKey="year"
          tick={{ fill: "var(--ar-chart-tick)", fontSize: 11 }}
          tickFormatter={(y) => String(y)}
          axisLine={{ stroke: "var(--ar-chart-border)" }}
          tickLine={{ stroke: "var(--ar-chart-grid)" }}
          height={44}
          label={{
            value: "Path Start Year",
            position: "insideBottom",
            offset: -2,
            fill: "var(--ar-chart-label)",
            fontSize: 11,
          }}
        />
        <YAxis
          tick={{ fill: "var(--ar-chart-tick)", fontSize: 11 }}
          width={66}
          axisLine={{ stroke: "var(--ar-chart-border)" }}
          tickLine={{ stroke: "var(--ar-chart-grid)" }}
          label={{
            value: "Terminal Value In ₹ Crores",
            angle: -90,
            position: "insideLeft",
            style: { textAnchor: "middle" },
            offset: 0,
            fill: "var(--ar-chart-label)",
            fontSize: 11,
          }}
        />
        <Tooltip
          content={<YearlyBarTooltip />}
          cursor={{ fill: "var(--ar-chart-cursor)" }}
          shared
          filterNull
        />
        <Legend
          verticalAlign="top"
          align="right"
          height={32}
          wrapperStyle={legendStyle}
          iconType="circle"
          iconSize={8}
          content={({ payload }) => {
            const seen = new Set<string>();
            const items: Array<{ key: string; label: string; color: string }> = [];
            for (const entry of payload ?? []) {
              const key = String(entry.dataKey ?? "");
              const meta = YEARLY_SERIES[key];
              if (!meta || seen.has(key)) continue;
              if (entry.type === "none" || (entry as { legendType?: string }).legendType === "none") continue;
              seen.add(key);
              items.push({ key, label: meta.label, color: meta.color });
            }
            if (!items.length) {
              items.push(
                { key: "mean_total", label: YEARLY_SERIES.mean_total.label, color: YEARLY_SERIES.mean_total.color },
                {
                  key: "median_total",
                  label: YEARLY_SERIES.median_total.label,
                  color: YEARLY_SERIES.median_total.color,
                },
              );
            }
            return (
              <ul className="flex flex-wrap justify-end gap-4 font-ui text-[11px] text-[var(--ar-muted)]">
                {items.map((item) => (
                  <li key={item.key} className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                    {item.label}
                  </li>
                ))}
              </ul>
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="mean_total"
          fill="url(#areaMeanShade)"
          stroke="none"
          legendType="none"
          tooltipType="none"
          isAnimationActive={false}
          name=""
        />
        <Area
          type="monotone"
          dataKey="median_total"
          fill="url(#areaMedianShade)"
          stroke="none"
          legendType="none"
          tooltipType="none"
          isAnimationActive={false}
          name=""
        />
        <Bar
          dataKey="mean_total"
          fill="url(#barMean)"
          name={YEARLY_SERIES.mean_total.label}
          radius={[7, 7, 0, 0]}
          maxBarSize={30}
          animationDuration={700}
        />
        <Bar
          dataKey="median_total"
          fill="url(#barMedian)"
          name={YEARLY_SERIES.median_total.label}
          radius={[7, 7, 0, 0]}
          maxBarSize={30}
          animationDuration={700}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function PathSeriesChart({
  dates,
  values,
  yLabel,
  color,
  seriesName,
  sinceYear,
  showZeroLine,
}: {
  dates: string[];
  values: number[];
  yLabel: string;
  color: string;
  seriesName?: string;
  sinceYear?: number;
  showZeroLine?: boolean;
}) {
  const name = seriesName ?? yLabel;
  const n = Math.min(dates.length, values.length);
  const data = Array.from({ length: n }, (_, i) => ({ date: dates[i], value: values[i] }));
  const maxPoints = 420;
  let plotted = data;
  if (data.length > maxPoints) {
    const bucket = Math.ceil(data.length / maxPoints);
    const out: typeof data = [];
    for (let i = 0; i < data.length; i += bucket) {
      const slice = data.slice(i, Math.min(data.length, i + bucket));
      let minI = 0;
      let maxI = 0;
      for (let j = 1; j < slice.length; j++) {
        if (slice[j].value < slice[minI].value) minI = j;
        if (slice[j].value > slice[maxI].value) maxI = j;
      }
      const order = minI <= maxI ? [minI, maxI] : [maxI, minI];
      for (const idx of order) {
        const pt = slice[idx];
        if (!out.length || out[out.length - 1].date !== pt.date) out.push(pt);
      }
    }
    const last = data[data.length - 1];
    if (!out.length || out[out.length - 1].date !== last.date) out.push(last);
    plotted = out;
  }

  if (!plotted.length) {
    return (
      <div className="flex h-full min-h-[16rem] items-center justify-center font-ui text-sm text-[var(--ar-muted)]">
        No Series Points
        {sinceYear != null ? ` · Since ${sinceYear}` : ""}
      </div>
    );
  }

  const safe = `${color.replace("#", "")}-${name.replace(/\W+/g, "").slice(0, 12)}`;
  const gradId = `area-${safe}`;
  const zero =
    showZeroLine ??
    (plotted.some((p) => p.value < 0) && plotted.some((p) => p.value > 0));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={plotted} margin={{ top: 28, right: 18, left: 14, bottom: 52 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.5} />
            <stop offset="42%" stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid {...PLOT_GRID_PROPS} />
        {zero ? (
          <ReferenceLine y={0} stroke="var(--ar-chart-ref)" strokeDasharray="4 4" strokeWidth={1.1} />
        ) : null}
        <XAxis
          dataKey="date"
          tick={{ fill: "var(--ar-chart-tick)", fontSize: 10 }}
          minTickGap={48}
          height={44}
          axisLine={{ stroke: "var(--ar-chart-border)" }}
          tickLine={{ stroke: "var(--ar-chart-grid)" }}
          label={{
            value: "Trading Date",
            position: "insideBottom",
            offset: -2,
            fill: "var(--ar-chart-label)",
            fontSize: 11,
          }}
        />
        <YAxis
          tick={{ fill: "var(--ar-chart-tick)", fontSize: 11 }}
          width={74}
          axisLine={{ stroke: "var(--ar-chart-border)" }}
          tickLine={{ stroke: "var(--ar-chart-grid)" }}
          label={{
            value: yLabel,
            angle: -90,
            position: "insideLeft",
            style: { textAnchor: "middle" },
            offset: 0,
            fill: "var(--ar-chart-label)",
            fontSize: 11,
          }}
        />
        <Tooltip
          contentStyle={tooltipBox}
          labelStyle={{ color: "var(--ar-subtle)", fontSize: 10, letterSpacing: "0.08em" }}
          itemStyle={{ color: "var(--ar-ink)" }}
          labelFormatter={(l) => `Trading Date · ${l}`}
          formatter={(v: number) => [formatNum(Number(v), 3), name]}
          filterNull
          cursor={{ stroke: "var(--ar-gold)", strokeWidth: 1, strokeDasharray: "4 4" }}
        />
        <Legend
          verticalAlign="top"
          align="right"
          height={24}
          wrapperStyle={legendStyle}
          iconType="plainline"
          iconSize={14}
          formatter={() => name}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2.35}
          fill={`url(#${gradId})`}
          dot={false}
          activeDot={{
            r: 4.5,
            strokeWidth: 2,
            stroke: "var(--ar-surface)",
            fill: color,
          }}
          name={name}
          animationDuration={850}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
