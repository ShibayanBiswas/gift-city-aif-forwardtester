"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { client, formatDeskDate, isPlausibleTradingDate } from "@/lib/api";
import { useForwardTest } from "@/lib/store";
import { SubPageTabs } from "@/components/ui/Shared";
import { SheetTable } from "@/components/SheetTable";

type TabId = "rolls" | "expiries";

/** Shared forward calendar only — no path Nifty / roll points (those differ by path). */
export default function IntelPage() {
  const { market, product } = useForwardTest();
  const [tab, setTab] = useState<TabId>("rolls");
  const [rollDates, setRollDates] = useState<Array<{ shift_date: string }>>([]);
  const [expiryDates, setExpiryDates] = useState<
    Array<{ expiry_date: string; weekday?: string; is_monthly_last?: boolean }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [simEnd, setSimEnd] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [rolls, expiries] = await Promise.all([client.rolls(), client.expiries(false)]);
      setRollDates(rolls.rows.map((r) => ({ shift_date: r.shift_date })));
      setExpiryDates(
        expiries.rows
          .filter((r) => r.is_monthly_last !== false)
          .map((r) => ({
            expiry_date: r.expiry_date,
            weekday: r.weekday,
            is_monthly_last: r.is_monthly_last,
          })),
      );
      setAsOf(rolls.asof ?? expiries.asof ?? null);
      setSimEnd(rolls.simulation_end ?? expiries.simulation_end ?? null);
    } catch (err) {
      setRollDates([]);
      setExpiryDates([]);
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, market?.asof, market?.simulation_end, market?.simulation_end_days, product?.name]);

  const rollDisplayRows = useMemo(
    () =>
      rollDates
        .filter((r) => isPlausibleTradingDate(r.shift_date))
        .map((r, i) => {
          const d = r.shift_date.slice(0, 10);
          const wd = new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", {
            weekday: "long",
            timeZone: "UTC",
          });
          return [i + 1, formatDeskDate(r.shift_date), wd];
        }),
    [rollDates],
  );
  const rollExportRows = useMemo(
    () =>
      rollDates
        .filter((r) => isPlausibleTradingDate(r.shift_date))
        .map((r, i) => {
          const d = r.shift_date.slice(0, 10);
          const wd = new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", {
            weekday: "long",
            timeZone: "UTC",
          });
          return [i + 1, r.shift_date, wd];
        }),
    [rollDates],
  );

  const expiryDisplayRows = useMemo(
    () =>
      expiryDates
        .filter((r) => isPlausibleTradingDate(r.expiry_date))
        .map((r, i) => [
          i + 1,
          formatDeskDate(r.expiry_date),
          r.weekday ?? "—",
          "Monthly",
        ]),
    [expiryDates],
  );
  const expiryExportRows = useMemo(
    () =>
      expiryDates
        .filter((r) => isPlausibleTradingDate(r.expiry_date))
        .map((r, i) => [i + 1, r.expiry_date, r.weekday ?? "—", "Monthly"]),
    [expiryDates],
  );

  const asOfLabel = formatDeskDate(asOf ?? market?.asof ?? market?.last_date);
  const simEndLabel = formatDeskDate(simEnd ?? market?.simulation_end);

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
                Intel · Market Calendar
              </p>
              <h2 className="font-display text-3xl text-[var(--ar-maroon)] md:text-4xl">
                Forward Calendar Dates
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--ar-muted)] font-ui">
                Futures shift dates and monthly Nifty option expiry dates from As Of Today through Simulation End.
                Path prices and roll costs differ by path — see Simulated Nifty Paths, Hedging Sheet, and Computation.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/intel/matrix"
                className="rounded-lg border border-[rgba(212,178,76,0.45)] px-3 py-1.5 text-xs font-semibold text-[var(--ar-maroon)] font-ui"
              >
                Simulated Nifty Paths
              </Link>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="rounded-lg border border-[rgba(212,178,76,0.45)] px-3 py-1.5 text-xs font-semibold text-[var(--ar-maroon)] disabled:opacity-50 font-ui"
              >
                {loading ? "Refreshing…" : "Refresh Calendar"}
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "As Of Today", value: asOfLabel },
              { label: "Simulation End", value: simEndLabel },
              {
                label: "Futures Shift Dates",
                value: String(rollDisplayRows.length),
              },
              {
                label: "Monthly Expiries",
                value: String(expiryDisplayRows.length),
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
              { id: "rolls", label: "Futures Shift Dates" },
              { id: "expiries", label: "Nifty Option Expiries" },
            ]}
            active={tab}
            onChange={(id) => setTab(id as TabId)}
          />
        </div>
      </motion.section>

      {loading && rollDates.length === 0 && expiryDates.length === 0 ? (
        <p className="text-sm text-[var(--ar-muted)] font-ui">Loading forward calendar…</p>
      ) : null}
      {loadError ? (
        <div className="ar-panel ar-band p-6 text-sm text-[var(--ar-muted)] font-ui">
          <p className="font-display text-xl text-[var(--ar-maroon)]">Could Not Load Market Calendar</p>
          <p className="mt-2">{loadError}</p>
        </div>
      ) : null}

      {!loadError && tab === "rolls" ? (
        <SheetTable
          title="Futures Shift Dates"
          subtitle={`${rollDisplayRows.length} dates from ${asOfLabel} through ${simEndLabel}.`}
          headers={["Row", "Futures Shift Date", "Weekday"]}
          rows={rollDisplayRows}
          exportRows={rollExportRows}
          filename="futures-shift-dates.xlsx"
          sheetName="Futures Shifts"
          columnTypes={["integer", "date", "text"]}
          minWidth={560}
          maxHeight={560}
        />
      ) : null}

      {!loadError && tab === "expiries" ? (
        <SheetTable
          title="Nifty Option Expiries"
          subtitle={`${expiryDisplayRows.length} monthly expiry dates from ${asOfLabel} through ${simEndLabel}.`}
          headers={["Row", "Expiry Date", "Weekday", "Contract"]}
          rows={expiryDisplayRows}
          exportRows={expiryExportRows}
          filename="nifty-option-expiry-dates.xlsx"
          sheetName="Option Expiries"
          columnTypes={["integer", "date", "text", "text"]}
          minWidth={640}
          maxHeight={560}
        />
      ) : null}
    </div>
  );
}
