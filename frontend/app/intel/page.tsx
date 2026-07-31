"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { formatDeskDate, formatNum, isPlausibleTradingDate } from "@/lib/api";
import { useForwardTest } from "@/lib/store";
import { EmptyRunHint, PathDetailGate, PathSelect, SubPageTabs } from "@/components/ui/Shared";
import { SheetTable } from "@/components/SheetTable";

type TabId = "nifty" | "expiries" | "rolls";

export default function IntelPage() {
  const { summary, pathDetail, pathId, product } = useForwardTest();
  const [tab, setTab] = useState<TabId>("nifty");

  const niftyRows = useMemo(() => {
    const dates = pathDetail?.dates ?? [];
    const nifty = pathDetail?.nifty ?? [];
    return dates
      .map((d, i) => ({ d, c: nifty[i] }))
      .filter((r) => isPlausibleTradingDate(r.d) && r.c != null && Number.isFinite(Number(r.c)))
      .map((r) => [formatDeskDate(r.d), formatNum(Number(r.c), 2)]);
  }, [pathDetail]);

  const expiryRows = useMemo(() => {
    const rows = pathDetail?.monthly_expiries ?? [];
    if (rows.length) {
      return rows
        .filter((r) => isPlausibleTradingDate(r.expiry_date))
        .map((r, i) => [
          i + 1,
          formatDeskDate(r.expiry_date),
          r.weekday ?? "—",
          r.is_monthly_last === false ? "Weekly" : "Monthly",
          r.nifty_close == null ? "—" : formatNum(r.nifty_close, 2),
        ]);
    }
    // Fallback for older cached path details: observation expiries only.
    return (pathDetail?.obs_builds ?? [])
      .filter((b) => isPlausibleTradingDate(b.expiry))
      .map((b, i) => [
        i + 1,
        formatDeskDate(b.expiry),
        "—",
        "Monthly",
        formatNum(b.nifty, 2),
      ]);
  }, [pathDetail]);

  const rollRows = useMemo(() => {
    const rows = pathDetail?.rolls ?? [];
    if (rows.length) {
      return rows
        .filter((r) => isPlausibleTradingDate(r.shift_date))
        .map((r, i) => [
          i + 1,
          formatDeskDate(r.shift_date),
          r.roll_cost == null ? "—" : formatNum(r.roll_cost, 3),
        ]);
    }
    // Fallback: non-zero rollover points from Computation ledger.
    const seen = new Set<string>();
    const out: Array<[number, string, string]> = [];
    for (const row of pathDetail?.computation_rows ?? []) {
      const d = String(row.date ?? "");
      const cost = Number(row.rollover_cost ?? 0);
      if (!isPlausibleTradingDate(d) || !Number.isFinite(cost) || Math.abs(cost) < 1e-12) continue;
      if (seen.has(d)) continue;
      seen.add(d);
      out.push([out.length + 1, formatDeskDate(d), formatNum(cost, 3)]);
    }
    return out;
  }, [pathDetail]);

  if (!summary) return <EmptyRunHint />;

  const start = pathDetail?.start ? formatDeskDate(pathDetail.start) : "—";
  const end = pathDetail?.end ? formatDeskDate(pathDetail.end) : "—";

  return (
    <div className="page-enter space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="ar-panel ar-band overflow-hidden"
      >
        <div className="border-b border-[var(--ar-border)] bg-gradient-to-r from-[var(--ar-table-head-from)] to-transparent px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--ar-subtle)] font-ui">
                Intel · Path Market
              </p>
              <h2 className="font-display text-3xl text-[var(--ar-maroon)] md:text-4xl">
                Simulated Path Market Sheet
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--ar-muted)] font-ui">
                Each GBM path has its own Nifty series (like{" "}
                <span className="font-ui">Nifty Simulations.xlsx</span>: rows = path
                numbers, columns = days). The same trading date can show different
                prices across paths. Monthly expiries and futures shift{" "}
                <em>dates</em> come from the shared forward calendar; Nifty on those
                dates and roll <em>points</em> are recomputed from this path&apos;s
                simulated closes — there is no separate shared price database.
              </p>
            </div>
          </div>
          <div className="mt-4">
            <PathSelect className="w-full" showMeta />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Selected Path", value: String(pathId) },
              { label: "Path Window", value: `${start} → ${end}` },
              {
                label: "Simulated Sessions",
                value: pathDetail?.dates?.length != null ? String(pathDetail.dates.length) : "—",
              },
              {
                label: "Product Roll Rate",
                value:
                  product?.roll_rate != null ? `${(product.roll_rate * 100).toFixed(2)}%` : "—",
              },
            ].map((m) => (
              <div key={m.label} className="glass rounded-2xl p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ar-subtle)] font-ui">
                  {m.label}
                </p>
                <p className="font-display text-lg tabular-nums text-[var(--ar-maroon)]">{m.value}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 py-4">
          <SubPageTabs
            tabs={[
              { id: "nifty", label: "Simulated Nifty Closes" },
              { id: "expiries", label: "Monthly Expiries" },
              { id: "rolls", label: "Futures Roll Costs" },
            ]}
            active={tab}
            onChange={(id) => setTab(id as TabId)}
          />
        </div>
      </motion.section>

      <PathDetailGate loadingLabel="Loading Path Market…">
        {tab === "nifty" ? (
          <SheetTable
            title={`Path ${pathId} · Simulated Nifty`}
            subtitle={`GBM lognormal closes on Mon–Fri sessions · ${start} → ${end}`}
            headers={["Trading Date", "Simulated Nifty"]}
            rows={niftyRows}
            filename={`path-${pathId}-simulated-nifty.xlsx`}
            sheetName="Simulated Nifty"
            columnTypes={["date", "number"]}
            minWidth={420}
            maxHeight={560}
          />
        ) : null}

        {tab === "expiries" ? (
          <SheetTable
            title={`Path ${pathId} · Monthly Expiries`}
            subtitle="Last-Tuesday expiries in this path window · Nifty from this path's GBM series"
            headers={["Row", "Expiry Date", "Weekday", "Contract", "Simulated Nifty"]}
            rows={expiryRows}
            filename={`path-${pathId}-monthly-expiries.xlsx`}
            sheetName="Monthly Expiries"
            columnTypes={["integer", "date", "text", "text", "number"]}
            minWidth={720}
            maxHeight={560}
          />
        ) : null}

        {tab === "rolls" ? (
          <SheetTable
            title={`Path ${pathId} · Futures Roll Costs`}
            subtitle="Month-end futures shifts · roll points = 7% × path average spot × day fraction (scaled by product roll rate in NAV)"
            headers={["Row", "Futures Shift Date", "Roll Cost In Index Points"]}
            rows={rollRows}
            filename={`path-${pathId}-futures-rolls.xlsx`}
            sheetName="Futures Rolls"
            columnTypes={["integer", "date", "number"]}
            minWidth={640}
            maxHeight={560}
          />
        ) : null}
      </PathDetailGate>
    </div>
  );
}
