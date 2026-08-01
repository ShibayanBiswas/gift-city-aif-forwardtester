"use client";

import { motion } from "framer-motion";
import { CalendarRange, ChartCandlestick, Layers, Hourglass, Flag } from "lucide-react";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { SiteNav } from "@/components/layout/SiteNav";
import { ProgressModal } from "@/components/ProgressModal";
import { useForwardTest } from "@/lib/store";
import { addCalendarDaysIso, formatDeskDate, isDeskHorizonMeta } from "@/lib/api";

const META_ICONS = [CalendarRange, Flag, Hourglass, ChartCandlestick, Layers] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { market, product, running, progress, message, error, setError } = useForwardTest();

  const asof = market?.asof ?? market?.last_date ?? null;
  // Prefer live Product Input days; never leave a stale market horizon (e.g. legacy 7300).
  const simDaysRaw = product?.simulation_end_days ?? market?.simulation_end_days ?? null;
  const simDays = simDaysRaw != null && Number(simDaysRaw) > 0 ? Number(simDaysRaw) : null;
  const simEnd =
    asof && simDays != null
      ? addCalendarDaysIso(asof, simDays)
      : market?.simulation_end ?? null;
  const horizonAligned =
    product?.simulation_end_days == null ||
    market?.simulation_end_days == null ||
    Number(product.simulation_end_days) === Number(market.simulation_end_days);
  const horizonReady = isDeskHorizonMeta(market) && horizonAligned;
  const tradingDays = horizonReady ? market!.trading_days : null;
  const monthlyExpiries = horizonReady ? market!.expiries : null;

  const meta = market
    ? [
        { label: "As Of Today", value: formatDeskDate(asof) },
        {
          label: "Simulation End",
          value: simEnd ? formatDeskDate(simEnd) : "—",
        },
        {
          label: "Simulation End Days",
          value: simDays != null ? String(simDays) : "—",
        },
        {
          label: "Trading Days",
          value: tradingDays != null ? String(tradingDays) : "—",
        },
        {
          label: "Monthly Expiries",
          value: monthlyExpiries != null ? String(monthlyExpiries) : "—",
        },
      ]
    : [];

  return (
    <div className="relative flex min-h-screen flex-col bg-mesh">
      <ProgressModal
        open={running || Boolean(error)}
        progress={progress}
        message={message}
        error={error}
        onDismiss={() => setError(null)}
      />
      <header className="brand-header sticky top-0 z-50 font-ui">
        <div className="mx-auto flex max-w-full items-center gap-3 px-4 py-3 lg:px-6">
          <BrandLogo />
          <div className="brand-title min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--ar-subtle)]">
              Anand Rathi Wealth · GIFT City
            </p>
            <h1 className="truncate font-display text-lg text-[var(--ar-maroon)] md:text-2xl">
              Category III AIF · Structured Units Forwardtester
            </h1>
          </div>
        </div>
        {meta.length ? (
          <div className="market-meta-strip" aria-label="Forward simulation horizon">
            <div className="market-meta-full">
              {meta.map((m, i) => {
                const Icon = META_ICONS[i] ?? CalendarRange;
                return (
                  <motion.div
                    key={m.label}
                    className="market-meta-card"
                    initial={{ opacity: 0, x: -40 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: 0.07 * i,
                      duration: 0.5,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    whileHover={{ y: -2 }}
                  >
                    <span className="market-meta-card__label">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--ar-gold-dark)]" aria-hidden />
                      {m.label}
                    </span>
                    <strong className="market-meta-card__value" title={m.value}>
                      {m.value}
                    </strong>
                  </motion.div>
                );
              })}
            </div>
          </div>
        ) : null}
        <SiteNav />
      </header>
      <main className="page-enter mx-auto w-full max-w-full flex-1 px-4 py-4 pb-3 lg:px-6">{children}</main>
      <footer className="border-t border-[var(--ar-border)] py-3 text-center text-xs text-[var(--ar-subtle)]">
        Anand Rathi Wealth · GIFT City Cat-III AIF Forwardtester
      </footer>
    </div>
  );
}
