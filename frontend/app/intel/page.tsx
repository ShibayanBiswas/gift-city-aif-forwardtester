"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { client, formatDeskDate, formatNum, isPlausibleTradingDate } from "@/lib/api";
import { useForwardTest } from "@/lib/store";
import { SubPageTabs } from "@/components/ui/Shared";
import { SheetTable } from "@/components/SheetTable";

type TabId = "rolls" | "expiries" | "nifty";

type ExpiryRow = {
  expiry_date: string;
  nifty_close: number | null;
  weekday?: string;
  is_monthly_last?: boolean;
  kind?: string;
  source?: string;
};

export default function IntelPage() {
  const { market, product, refreshMarket, refreshProduct } = useForwardTest();
  const [tab, setTab] = useState<TabId>("rolls");
  const [nifty, setNifty] = useState<Array<{ date: string; close: number; source?: string }>>([]);
  const [expiries, setExpiries] = useState<ExpiryRow[]>([]);
  const [monthlyLastCount, setMonthlyLastCount] = useState(0);
  const [rolls, setRolls] = useState<
    Array<{ shift_date: string; roll_cost: number | null; source?: string }>
  >([]);
  const [sheetMeta, setSheetMeta] = useState<{
    asof?: string;
    simulation_end?: string;
    simulation_end_days?: number;
  }>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  const loadSheets = useCallback(
    async (opts?: { forceSync?: boolean }) => {
      setLoading(true);
      setLoadError(null);
      try {
        if (opts?.forceSync) {
          await refreshMarket();
        }
        const [n, e, r] = await Promise.all([
          client.nifty(),
          client.expiries(true),
          client.rolls(),
          refreshProduct(),
        ]);
        setNifty(n.rows);
        setExpiries(e.rows);
        setMonthlyLastCount(e.monthly_last_count ?? e.rows.filter((x) => x.is_monthly_last).length);
        setRolls(r.rows);
        setSheetMeta({
          asof: n.asof ?? e.asof ?? r.asof,
          simulation_end: n.simulation_end ?? e.simulation_end ?? r.simulation_end,
          simulation_end_days:
            n.simulation_end_days ?? e.simulation_end_days ?? r.simulation_end_days,
        });
        setSyncedAt(new Date().toISOString());
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [refreshMarket, refreshProduct],
  );

  useEffect(() => {
    void loadSheets();
  }, [
    loadSheets,
    market?.last_date,
    product?.simulation_end_days,
    product?.tenure_days,
    product?.n_obs,
    product?.principal_cr,
    product?.roll_rate,
    product?.observation_months?.join(","),
    product?.legs?.length,
  ]);

  const asOf = sheetMeta.asof ?? market?.last_date ?? "—";
  const simEnd = sheetMeta.simulation_end ?? market?.simulation_end ?? "—";
  const simDays = sheetMeta.simulation_end_days ?? market?.simulation_end_days;

  const rollRows = useMemo(
    () =>
      rolls
        .filter((r) => isPlausibleTradingDate(r.shift_date))
        .map((r, i) => [
          i + 1,
          formatDeskDate(r.shift_date),
          r.roll_cost == null ? "—" : formatNum(r.roll_cost, 3),
          r.source === "forward" ? "Forward" : "Historical",
        ]),
    [rolls],
  );
  const expiryRows = useMemo(
    () =>
      expiries
        .filter((r) => isPlausibleTradingDate(r.expiry_date))
        .map((r, i) => [
          i + 1,
          formatDeskDate(r.expiry_date),
          r.weekday ?? "—",
          r.is_monthly_last ? "Monthly" : "Weekly",
          r.nifty_close == null ? "—" : formatNum(r.nifty_close, 2),
          r.source === "forward" ? "Forward" : "Historical",
        ]),
    [expiries],
  );
  const niftyRows = useMemo(
    () =>
      nifty
        .filter((r) => isPlausibleTradingDate(r.date))
        .map((r) => [
          formatDeskDate(r.date),
          formatNum(r.close, 2),
          r.source === "forward" ? "Forward" : "Historical",
        ]),
    [nifty],
  );

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
                Intel · Market Database
              </p>
              <h2 className="font-display text-3xl text-[var(--ar-maroon)] md:text-4xl">
                Market Reference Workbooks
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--ar-muted)] font-ui">
                Futures rolls, Nifty option expiries, and daily closes from As Of Today through
                Simulation End. Forward rows use Path One Geometric Brownian Motion spots and the
                forward calendar (Mon–Fri; last-Tuesday expiries; month-end futures shifts).
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadSheets({ forceSync: true })}
              disabled={loading}
              className="rounded-lg border border-[rgba(212,178,76,0.45)] px-3 py-1.5 text-xs font-semibold text-[var(--ar-maroon)] disabled:opacity-50 font-ui"
            >
              {loading ? "Refreshing…" : "Refresh Market"}
            </button>
          </div>
          <div className="desk-card-rail mt-4">
            <div className="desk-card-rail__inner">
            {[
              { label: "As Of Today", value: formatDeskDate(asOf) === "—" ? asOf : formatDeskDate(asOf) },
              {
                label: "Simulation End",
                value: formatDeskDate(simEnd) === "—" ? simEnd : formatDeskDate(simEnd),
              },
              {
                label: "Simulation End Days",
                value: simDays != null ? String(simDays) : "—",
              },
              {
                label: "Product Roll Rate",
                value:
                  product?.roll_rate != null ? `${(product.roll_rate * 100).toFixed(2)}%` : "—",
              },
            ].map((m) => (
              <div key={m.label} className="desk-card-rail__card glass">
                <p className="desk-card-rail__label">{m.label}</p>
                <p className="desk-card-rail__value">{m.value}</p>
              </div>
            ))}
            </div>
          </div>
          {syncedAt ? (
            <p className="mt-3 text-[10px] tracking-wide text-[var(--ar-subtle)] font-ui">
              Last Sheet Refresh · {new Date(syncedAt).toLocaleString("en-IN")}
            </p>
          ) : null}
        </div>
        <div className="px-6 py-4">
          <SubPageTabs
            tabs={[
              { id: "rolls", label: "Futures Roll Costs" },
              { id: "expiries", label: "Nifty Option Expiries" },
              { id: "nifty", label: "Nifty Daily Closes" },
            ]}
            active={tab}
            onChange={(id) => setTab(id as TabId)}
          />
        </div>
      </motion.section>

      {loading ? (
        <p className="text-sm text-[var(--ar-muted)] font-ui">Loading market workbooks…</p>
      ) : null}
      {loadError ? (
        <div className="ar-panel ar-band p-6 text-sm text-[var(--ar-muted)] font-ui">
          <p className="font-display text-xl text-[var(--ar-maroon)]">Could Not Load Market Tables</p>
          <p className="mt-2">{loadError}</p>
        </div>
      ) : null}

      {!loading && !loadError && tab === "rolls" && (
        <SheetTable
          title="Futures Monthly Shift Dates"
          subtitle={`From ${formatDeskDate(asOf)} to ${formatDeskDate(simEnd)}.`}
          headers={["Row", "Futures Shift Date", "Roll Cost In Index Points", "Source"]}
          rows={rollRows}
          filename="intel-futures-rolls.xlsx"
          sheetName="Futures Rolls"
          columnTypes={["integer", "date", "number", "text"]}
          minWidth={720}
          maxHeight={560}
        />
      )}

      {!loading && !loadError && tab === "expiries" && (
        <SheetTable
          title="Nifty Option Expiries"
          subtitle={`From ${formatDeskDate(asOf)} to ${formatDeskDate(simEnd)}. ${expiries.length} rows · ${monthlyLastCount} monthly.`}
          headers={["Row", "Expiry Date", "Weekday", "Contract", "Nifty Closing Level", "Source"]}
          rows={expiryRows}
          filename="intel-nifty-option-expiries.xlsx"
          sheetName="Option Expiries"
          columnTypes={["integer", "date", "text", "text", "number", "text"]}
          minWidth={820}
          maxHeight={560}
        />
      )}

      {!loading && !loadError && tab === "nifty" && (
        <SheetTable
          title="Nifty Daily Closing Levels"
          subtitle={`From ${formatDeskDate(asOf)} to ${formatDeskDate(simEnd)}.`}
          headers={["Trading Date", "Nifty Closing Level", "Source"]}
          rows={niftyRows}
          filename="intel-nifty-closes.xlsx"
          sheetName="Nifty Closes"
          columnTypes={["date", "number", "text"]}
          minWidth={520}
          maxHeight={560}
        />
      )}
    </div>
  );
}
