"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { client, formatDeskDate, formatNum, isPlausibleTradingDate } from "@/lib/api";
import { useForwardTest } from "@/lib/store";
import { EmptyRunHint, PathSelect, SubPageTabs } from "@/components/ui/Shared";
import { SheetTable } from "@/components/SheetTable";

type TabId = "nifty" | "expiries" | "rolls";

type HorizonMarket = Awaited<ReturnType<typeof client.pathHorizonMarket>>;

export default function IntelPage() {
  const { summary, pathId, product, jobId } = useForwardTest();
  const [tab, setTab] = useState<TabId>("nifty");
  const [market, setMarket] = useState<HorizonMarket | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!jobId || !pathId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await client.pathHorizonMarket(jobId, pathId);
      setMarket(data);
    } catch (e) {
      setMarket(null);
      setError(e instanceof Error ? e.message : "Failed to load path market horizon");
    } finally {
      setLoading(false);
    }
  }, [jobId, pathId]);

  useEffect(() => {
    void load();
  }, [load]);

  const niftyRows = useMemo(() => {
    const dates = market?.dates ?? [];
    const nifty = market?.nifty ?? [];
    return dates
      .map((d, i) => ({ d, c: nifty[i] }))
      .filter((r) => isPlausibleTradingDate(r.d) && r.c != null && Number.isFinite(Number(r.c)))
      .map((r) => [formatDeskDate(r.d), formatNum(Number(r.c), 2)]);
  }, [market]);

  const expiryRows = useMemo(() => {
    return (market?.monthly_expiries ?? [])
      .filter((r) => isPlausibleTradingDate(r.expiry_date))
      .map((r, i) => [
        i + 1,
        formatDeskDate(r.expiry_date),
        r.weekday ?? "—",
        "Monthly",
        r.nifty_close == null ? "—" : formatNum(r.nifty_close, 2),
      ]);
  }, [market]);

  const rollRows = useMemo(() => {
    return (market?.rolls ?? [])
      .filter((r) => isPlausibleTradingDate(r.shift_date))
      .map((r, i) => [
        i + 1,
        formatDeskDate(r.shift_date),
        r.roll_cost == null ? "—" : formatNum(r.roll_cost, 3),
      ]);
  }, [market]);

  if (!summary || !jobId) return <EmptyRunHint />;

  const horizonStart = market?.horizon_start ? formatDeskDate(market.horizon_start) : "—";
  const horizonEnd = market?.horizon_end ? formatDeskDate(market.horizon_end) : "—";
  const tenureLabel =
    market?.tenure_start && market?.tenure_end
      ? `${formatDeskDate(market.tenure_start)} → ${formatDeskDate(market.tenure_end)}`
      : "—";

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
              <h2 className="font-display text-2xl text-[var(--ar-maroon)] md:text-3xl">
                Simulated Path Market Sheet
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--ar-muted)] font-ui">
                Full horizon from as-of through Simulation End for the selected path. Nifty closes
                come from that path&apos;s Geometric Brownian Motion row. Monthly expiries use the
                last Tuesday of each month with holiday snap. Futures roll points use this path&apos;s
                simulated spots, so different paths show different roll costs on the same shift date.
              </p>
            </div>
            <Link href="/intel/matrix" className="nav-sub-pill nav-sub-pill-active shrink-0">
              Monte Carlo Matrix
            </Link>
          </div>
          <div className="mt-4">
            <PathSelect className="w-full" showMeta />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Selected Path", value: String(pathId) },
              { label: "Market Horizon", value: `${horizonStart} → ${horizonEnd}` },
              {
                label: "Trading Sessions",
                value: market?.n_trading_days != null ? String(market.n_trading_days) : "—",
              },
              { label: "Product Tenure Window", value: tenureLabel },
            ].map((m) => (
              <div key={m.label} className="glass rounded-2xl p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ar-subtle)] font-ui">
                  {m.label}
                </p>
                <p className="font-display text-lg tabular-nums text-[var(--ar-maroon)]">{m.value}</p>
              </div>
            ))}
          </div>
          {product?.roll_rate != null ? (
            <p className="mt-3 text-xs text-[var(--ar-muted)] font-ui">
              Product roll rate {((product.roll_rate ?? 0) * 100).toFixed(2)}% scales roll points inside
              NAV; table values are index points before that scale.
            </p>
          ) : null}
          {error ? <p className="mt-3 text-sm text-[var(--ar-maroon)] font-ui">{error}</p> : null}
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

      {loading && !market ? (
        <p className="px-1 text-sm text-[var(--ar-muted)] font-ui">Loading path market horizon…</p>
      ) : (
        <>
          {tab === "nifty" ? (
            <SheetTable
              title={`Path ${pathId} · Simulated Nifty Closes`}
              subtitle={`Geometric Brownian Motion closes on weekday sessions · ${horizonStart} → ${horizonEnd}`}
              headers={["Trading Date", "Simulated Nifty"]}
              rows={niftyRows}
              filename={`path-${pathId}-horizon-nifty.xlsx`}
              sheetName="Simulated Nifty"
              columnTypes={["date", "number"]}
              minWidth={420}
              maxHeight={560}
            />
          ) : null}

          {tab === "expiries" ? (
            <SheetTable
              title={`Path ${pathId} · Monthly Expiries`}
              subtitle={`Last Tuesday of each month with holiday snap · Nifty from this path · ${horizonStart} → ${horizonEnd}`}
              headers={["Row", "Expiry Date", "Weekday", "Contract", "Simulated Nifty"]}
              rows={expiryRows}
              filename={`path-${pathId}-horizon-expiries.xlsx`}
              sheetName="Monthly Expiries"
              columnTypes={["integer", "date", "text", "text", "number"]}
              minWidth={720}
              maxHeight={560}
            />
          ) : null}

          {tab === "rolls" ? (
            <SheetTable
              title={`Path ${pathId} · Futures Roll Costs`}
              subtitle={`Month-end futures shifts · roll points from this path average spot × seven percent × day fraction · ${horizonStart} → ${horizonEnd}`}
              headers={["Row", "Futures Shift Date", "Roll Cost In Index Points"]}
              rows={rollRows}
              filename={`path-${pathId}-horizon-rolls.xlsx`}
              sheetName="Futures Rolls"
              columnTypes={["integer", "date", "number"]}
              minWidth={640}
              maxHeight={560}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
