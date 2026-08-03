"use client";

import { motion } from "framer-motion";
import {
  CalendarRange,
  ChartCandlestick,
  Dices,
  Flag,
  Hourglass,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { SiteNav } from "@/components/layout/SiteNav";
import { ProgressModal } from "@/components/ProgressModal";
import { useForwardTest } from "@/lib/store";
import { formatDeskDate, isDeskHorizonMeta } from "@/lib/api";
import { deskSpring, easeOut, fadeUpItem, staggerContainer } from "@/lib/motion";

type MetaItem = { label: string; value: string; icon: LucideIcon };

export function AppShell({ children }: { children: React.ReactNode }) {
  const { market, product, nPaths, running, progress, message, error, setError } = useForwardTest();

  const asof = market?.asof ?? market?.last_date ?? null;
  // Always use API Product End — never asof + days client-side.
  const productEnd = market?.product_end ?? market?.simulation_end ?? null;
  const tenureDays =
    product?.tenure_days != null && Number(product.tenure_days) > 0
      ? Number(product.tenure_days)
      : market?.tenure_days != null && Number(market.tenure_days) > 0
        ? Number(market.tenure_days)
        : null;
  const mcPaths =
    nPaths > 0
      ? nPaths
      : product?.n_paths != null
        ? Number(product.n_paths)
        : market?.n_paths != null
          ? Number(market.n_paths)
          : null;
  const tenureAligned =
    product?.tenure_days == null ||
    market?.tenure_days == null ||
    Number(product.tenure_days) === Number(market.tenure_days);
  const horizonReady = isDeskHorizonMeta(market) && tenureAligned;
  const tradingDays = horizonReady ? market!.trading_days : null;
  const monthlyExpiries = horizonReady ? market!.expiries : null;

  const meta: MetaItem[] = market
    ? [
        { label: "As Of Today", value: formatDeskDate(asof), icon: CalendarRange },
        {
          label: "Product End",
          value: productEnd ? formatDeskDate(productEnd) : "—",
          icon: Flag,
        },
        {
          label: "Tenure Days",
          value: tenureDays != null ? tenureDays.toLocaleString("en-IN") : "—",
          icon: Hourglass,
        },
        {
          label: "Paths",
          value: mcPaths != null ? mcPaths.toLocaleString("en-IN") : "—",
          icon: Dices,
        },
        {
          label: "Trading Days",
          value: tradingDays != null ? Number(tradingDays).toLocaleString("en-IN") : "—",
          icon: ChartCandlestick,
        },
        {
          label: "Monthly Expiries",
          value: monthlyExpiries != null ? Number(monthlyExpiries).toLocaleString("en-IN") : "—",
          icon: Layers,
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
          <motion.div
            className="brand-title min-w-0"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={easeOut}
          >
            <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--ar-subtle)]">
              Anand Rathi Wealth · GIFT City
            </p>
            <h1 className="truncate font-display text-lg md:text-2xl">
              Category III AIF · Structured Units Forwardtester
            </h1>
          </motion.div>
        </div>
        {meta.length ? (
          <div className="market-meta-strip" aria-label="Forward simulation horizon">
            <motion.div
              className="market-meta-full"
              variants={staggerContainer}
              initial="hidden"
              animate="show"
            >
              {meta.map((m) => {
                const Icon = m.icon;
                return (
                  <motion.div
                    key={m.label}
                    className="market-meta-card"
                    variants={fadeUpItem}
                    whileHover={{ y: -2, transition: deskSpring }}
                  >
                    <span className="market-meta-card__label">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--ar-gold-dark)]" aria-hidden />
                      <span className="market-meta-card__label-text">{m.label}</span>
                    </span>
                    <strong className="market-meta-card__value" title={m.value}>
                      {m.value}
                    </strong>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        ) : null}
        <SiteNav />
      </header>
      <motion.main
        className="page-enter mx-auto w-full max-w-full flex-1 px-4 py-4 pb-3 lg:px-6"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={easeOut}
      >
        {children}
      </motion.main>
      <footer className="border-t border-[var(--ar-border)] py-3 text-center text-xs text-[var(--ar-subtle)] font-ui">
        <div className="desk-gold-rule desk-gold-rule--wide mb-2 opacity-80" />
        Anand Rathi Wealth · GIFT City Cat-III AIF Forwardtester
      </footer>
    </div>
  );
}
