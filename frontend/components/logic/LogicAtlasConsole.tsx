"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Brain,
  ExternalLink,
  FileSpreadsheet,
  LineChart,
  Sparkles,
  Table2,
} from "lucide-react";

import { LogicFlowDiagram, LogicModuleCard } from "@/components/logic/LogicFlowDiagram";
import { logicModules, withLiveAtlasData } from "@/lib/logic-atlas";
import { stripBracketDeep } from "@/lib/plainText";
import { useForwardTest } from "@/lib/store";
import { cn, formatNum } from "@/lib/api";

const DESK_LINKS = [
  { href: "/product", label: "Product" },
  { href: "/paths", label: "Paths" },
  { href: "/hedging", label: "Hedging Sheet" },
  { href: "/computation", label: "Computation" },
  { href: "/analytics", label: "Analytics" },
  { href: "/intel", label: "Market Calendar" },
  { href: "/intel/matrix", label: "Simulated Nifty Paths" },
] as const;

export function LogicAtlasConsole() {
  const { market, product, refreshProduct } = useForwardTest();
  const [selectedId, setSelectedId] = useState(logicModules[0]?.id ?? "product-input");

  // Refresh ProductSpec on mount so Atlas chips track the latest upload.
  useEffect(() => {
    void refreshProduct();
  }, [refreshProduct]);

  const modules = useMemo(
    () => stripBracketDeep(withLiveAtlasData(logicModules, product, market)),
    [product, market],
  );

  const selected = useMemo(
    () => modules.find((m) => m.id === selectedId) ?? modules[0],
    [modules, selectedId],
  );

  const totalStages = modules.reduce((s, m) => s + m.nodes.length, 0);

  return (
    <div className="intel-page space-y-3">
      <motion.header
        className="intel-hero"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <div className="intel-hero-orb intel-hero-orb--gold" aria-hidden />
        <div className="intel-hero-orb intel-hero-orb--maroon" aria-hidden />
        <p className="intel-hero-kicker relative z-10">Anand Rathi · Gift City AIF · Desk Intelligence</p>
        <h1 className="intel-hero-title relative z-10">Intel · Logic Atlas</h1>
        <p className="intel-hero-sub relative z-10">
          Working procedure of a desk run: Product Input → Macro Paths → market rolls &amp; expiries → Hedging Sheet
          → Computation → Summary. Metrics track the live Product Input automatically.
        </p>
        <div className="intel-hero-meta relative z-10">
          <motion.span
            className="intel-hero-badge"
            animate={{
              boxShadow: [
                "0 0 0 rgba(212,178,76,0)",
                "0 0 18px rgba(212,178,76,0.35)",
                "0 0 0 rgba(212,178,76,0)",
              ],
            }}
            transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {modules.length} Modules · {totalStages} Steps
          </motion.span>
          <span className="intel-hero-badge">
            <Brain className="h-3.5 w-3.5" />
            Engine Pipeline
          </span>
          <span className="intel-hero-badge">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            backend/app/engine
          </span>
          {product ? (
            <span className="intel-hero-badge">
              <LineChart className="h-3.5 w-3.5" />
              Live · {formatNum(product.principal_cr, 2)} Crores · {product.n_obs} Obs
            </span>
          ) : null}
          {market ? (
            <span className="intel-hero-badge">
              <Table2 className="h-3.5 w-3.5" />
              Market {market.first_date} → {market.last_date}
            </span>
          ) : null}
        </div>
      </motion.header>

      <section className="ar-panel ar-band overflow-hidden">
        <div className="grid gap-2 border-b border-[var(--ar-border)] px-5 py-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Logic Modules", value: String(modules.length) },
            { label: "Pipeline Steps", value: String(totalStages) },
            {
              label: "Live Principal",
              value: product ? `${formatNum(product.principal_cr, 2)} Crores` : "—",
            },
            {
              label: "Market Through",
              value: market?.last_date ?? "—",
            },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-[var(--ar-border)] bg-[var(--ar-surface)] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ar-subtle)] font-ui">{k.label}</p>
              <p className="mt-1 font-display text-2xl tabular-nums text-[var(--ar-maroon)]">{k.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="ar-panel ar-band overflow-hidden">
        <div className="intel-section-head px-5 pt-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ar-subtle)] font-ui">Reference Modules</p>
            <h2 className="font-display text-xl text-[var(--ar-maroon)] md:text-2xl">Working File Pipeline</h2>
            <p className="mt-1 text-sm text-[var(--ar-muted)] font-ui">
              Scroll the rail · select a module · review each stage
            </p>
          </div>
          <nav aria-label="Desk shortcuts" className="intel-desk-nav">
            {DESK_LINKS.map((link) => (
              <Link key={link.href} className="intel-desk-link" href={link.href}>
                <ExternalLink className="h-3 w-3 opacity-70" />
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="logic-module-rail px-5 py-3">
          <div className="flex gap-2">
            {modules.map((module, index) => (
              <div key={module.id} className="logic-module-rail-item">
                <motion.div
                  className="h-full"
                  initial={{ opacity: 0, y: 18, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: index * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                >
                  <LogicModuleCard
                    module={module}
                    selected={selectedId === module.id}
                    onSelect={() => setSelectedId(module.id)}
                  />
                </motion.div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={cn("ar-panel ar-band overflow-hidden", `intel-panel--${selected.accent}`)}>
        <div className="intel-section-head px-5 pt-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ar-subtle)] font-ui">
              Active Pipeline · {selected.excelSheet}
            </p>
            <AnimatePresence mode="wait">
              <motion.h2
                key={selected.id}
                className="font-display text-xl text-[var(--ar-maroon)] md:text-2xl"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.28 }}
              >
                {selected.title}
              </motion.h2>
            </AnimatePresence>
            <p className="mt-1 max-w-3xl text-sm leading-snug text-[var(--ar-muted)] font-ui">{selected.purpose}</p>
            <p className="mt-1 text-xs text-[var(--ar-subtle)] font-ui">
              Sheet · <span className="text-[var(--ar-ink)]">{selected.excelSheet}</span>
              {product ? (
                <>
                  {" "}
                  · Live product · <span className="text-[var(--ar-ink)]">{product.name || "Current"}</span>
                </>
              ) : null}
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(212,178,76,0.4)] bg-[rgba(212,178,76,0.12)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ar-maroon)] font-ui">
            <BookOpen className="h-3.5 w-3.5" />
            {selected.nodes.length} Steps
          </span>
        </div>
        <div className={cn("intel-pipeline-shell mx-3 my-2 md:mx-4", `intel-pipeline-shell--${selected.accent}`)}>
          <LogicFlowDiagram module={selected} />
        </div>
      </section>

      <section className="ar-panel ar-band overflow-hidden">
        <div className="border-b border-[var(--ar-border)] px-5 py-3">
          <div className="flex items-center gap-2">
            <LineChart className="h-4 w-4 text-[var(--ar-gold-dark)]" />
            <h3 className="font-display text-lg text-[var(--ar-maroon)]">Module Outputs</h3>
          </div>
        </div>
        <div className="logic-module-rail px-5 py-3">
          <div className="flex gap-2">
            {selected.outputs.map((output, i) => (
              <motion.div
                key={`${selected.id}-${output}`}
                className={cn("intel-output-chip shrink-0", `intel-output-chip--${selected.accent}`)}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.25 }}
                whileHover={{ y: -2, scale: 1.01 }}
              >
                {output}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="ar-panel ar-band overflow-hidden">
        <div className="border-b border-[var(--ar-border)] px-5 py-3">
          <h3 className="font-display text-lg text-[var(--ar-maroon)]">Defaults And Constants</h3>
          <p className="mt-1 text-sm text-[var(--ar-muted)] font-ui">
            Live Product Input values for this stage (updates on upload)
          </p>
        </div>
        <div className="logic-module-rail px-5 py-3">
          <div className="flex gap-2">
            {selected.defaults.map((d, i) => (
              <motion.div
                key={d.label}
                className="meta-chip w-[min(100%,16rem)] shrink-0"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <p className="text-[10px] tracking-[0.14em] text-[var(--ar-subtle)] font-ui">{d.label}</p>
                <p className="mt-1 font-display text-base tabular-nums text-[var(--ar-maroon)]">{d.value}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
