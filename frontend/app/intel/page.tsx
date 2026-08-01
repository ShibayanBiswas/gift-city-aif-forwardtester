"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { client, formatDeskDate, formatNum, isPlausibleTradingDate } from "@/lib/api";
import { useForwardTest } from "@/lib/store";
import { EmptyRunHint, PathSelect, SubPageTabs } from "@/components/ui/Shared";
import { SheetTable } from "@/components/SheetTable";

type TabId = "rolls" | "expiries" | "nifty";

type HorizonMarket = Awaited<ReturnType<typeof client.pathHorizonMarket>>;

export default function IntelPage() {
  const { summary, pathId, product, jobId, market } = useForwardTest();
  const [tab, setTab] = useState<TabId>("rolls");
  const [horizon, setHorizon] = useState<HorizonMarket | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!jobId || !pathId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await client.pathHorizonMarket(jobId, pathId);
      setHorizon(data);
    } catch (err) {
      setHorizon(null);
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [jobId, pathId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rollRows = useMemo(
    () =>
      (horizon?.rolls ?? [])
        .filter((r) => isPlausibleTradingDate(r.shift_date))
        .map((r, i) => [
          i + 1,
          formatDeskDate(r.shift_date),
          r.roll_cost == null ? "—" : formatNum(r.roll_cost, 3),
        ]),
    [horizon],
  );

  const expiryRows = useMemo(
    () =>
      (horizon?.monthly_expiries ?? [])
        .filter((r) => isPlausibleTradingDate(r.expiry_date))
        .map((r, i) => [
          i + 1,
          formatDeskDate(r.expiry_date),
          r.weekday ?? "—",
          "Monthly",
          r.nifty_close == null ? "—" : formatNum(r.nifty_close, 2),
        ]),
    [horizon],
  );

  const niftyRows = useMemo(() => {
    const dates = horizon?.dates ?? [];
    const nifty = horizon?.nifty ?? [];
    return dates
      .map((d, i) => ({ d, c: nifty[i] }))
      .filter((r) => isPlausibleTradingDate(r.d) && r.c != null && Number.isFinite(Number(r.c)))
      .map((r) => [formatDeskDate(r.d), formatNum(Number(r.c), 2)]);
  }, [horizon]);

  if (!summary || !jobId) return <EmptyRunHint />;

  const asOf = horizon?.horizon_start ?? market?.asof ?? market?.last_date ?? "—";
  const simEnd = horizon?.horizon_end ?? market?.simulation_end ?? "—";
  const asOfLabel = formatDeskDate(asOf);
  const simEndLabel = formatDeskDate(simEnd);

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
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--ar-subtle)] font-ui">Intel · Path Market</p>
              <h2 className="font-display text-3xl text-[var(--ar-maroon)] md:text-4xl">Simulated Path Market Sheet</h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--ar-muted)] font-ui">
                Excel-style sheets for futures rolls, monthly last-Tuesday option expiries, and simulated Nifty closes
                from as-of through Simulation End for the selected Geometric Brownian Motion path. Different paths show
                different Nifty levels and roll points on the same trading date.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/intel/matrix"
                className="rounded-lg border border-[rgba(212,178,76,0.45)] px-3 py-1.5 text-xs font-semibold text-[var(--ar-maroon)] font-ui"
              >
                Monte Carlo Matrix
              </Link>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="rounded-lg border border-[rgba(212,178,76,0.45)] px-3 py-1.5 text-xs font-semibold text-[var(--ar-maroon)] disabled:opacity-50 font-ui"
              >
                {loading ? "Refreshing…" : "Refresh Path Market"}
              </button>
            </div>
          </div>
          <div className="mt-4">
            <PathSelect className="w-full" showMeta />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { label: "As Of Today", value: asOfLabel },
              { label: "Simulation End", value: simEndLabel },
              {
                label: "Trading Days",
                value: horizon?.n_trading_days != null ? String(horizon.n_trading_days) : "—",
              },
              {
                label: "Selected Path",
                value: String(pathId),
              },
              {
                label: "Product Roll Rate",
                value:
                  product?.roll_rate != null ? `${(product.roll_rate * 100).toFixed(2)}%` : "—",
              },
            ].map((m) => (
              <div key={m.label} className="glass rounded-2xl p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ar-subtle)] font-ui">{m.label}</p>
                <p className="font-display text-lg tabular-nums text-[var(--ar-maroon)]">{m.value}</p>
              </div>
            ))}
          </div>
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

      {loading && !horizon ? (
        <p className="text-sm text-[var(--ar-muted)] font-ui">Loading path market sheets…</p>
      ) : null}
      {loadError ? (
        <div className="ar-panel ar-band p-6 text-sm text-[var(--ar-muted)] font-ui">
          <p className="font-display text-xl text-[var(--ar-maroon)]">Could Not Load Path Market Tables</p>
          <p className="mt-2">{loadError}</p>
        </div>
      ) : null}

      {!loading && !loadError && horizon && tab === "rolls" ? (
        <SheetTable
          title="Futures · Monthly Shift Dates"
          subtitle={`Monthly futures shift dates through ${simEndLabel} · path ${pathId} roll points.`}
          headers={["Row", "Futures Shift Date", "Roll Cost In Index Points"]}
          rows={rollRows}
          filename={`path-${pathId}-futures-rolls.xlsx`}
          sheetName="Futures Rolls"
          columnTypes={["integer", "date", "number"]}
          minWidth={640}
          maxHeight={560}
        />
      ) : null}

      {!loading && !loadError && horizon && tab === "expiries" ? (
        <SheetTable
          title="Nifty Option Expiries · Monthly Last Tuesday"
          subtitle={`Last-Tuesday monthly calendar from ${asOfLabel} through ${simEndLabel}. ${horizon.n_expiries} rows.`}
          headers={["Row", "Expiry Date", "Weekday", "Contract", "Nifty Closing Level"]}
          rows={expiryRows}
          filename={`path-${pathId}-option-expiries.xlsx`}
          sheetName="Option Expiries"
          columnTypes={["integer", "date", "text", "text", "number"]}
          minWidth={720}
          maxHeight={560}
        />
      ) : null}

      {!loading && !loadError && horizon && tab === "nifty" ? (
        <SheetTable
          title="Nifty · Daily Closing Levels"
          subtitle={`Simulated spot series from ${asOfLabel} through ${simEndLabel} · path ${pathId}`}
          headers={["Trading Date", "Nifty Closing Level"]}
          rows={niftyRows}
          filename={`path-${pathId}-nifty-closes.xlsx`}
          sheetName="Nifty Closes"
          columnTypes={["date", "number"]}
          minWidth={420}
          maxHeight={560}
        />
      ) : null}
    </div>
  );
}
