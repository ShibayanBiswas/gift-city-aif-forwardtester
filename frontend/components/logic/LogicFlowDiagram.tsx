"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  Cpu,
  Database,
  FileSpreadsheet,
  LineChart,
  Search,
  Sigma,
  Zap,
} from "lucide-react";

import type { LogicModule, LogicNode, LogicNodeKind } from "@/lib/logic-atlas";
import { cn } from "@/lib/api";

const kindIcons: Record<LogicNodeKind, typeof Database> = {
  input: Search,
  process: Cpu,
  engine: Zap,
  lookup: Database,
  output: LineChart,
};

const moduleIcons: Record<string, typeof Database> = {
  "product-input": FileSpreadsheet,
  "macro-paths": CalendarDays,
  "roll-market": BarChart3,
  expiry: BookOpen,
  hedging: Sigma,
  computation: Zap,
  summary: LineChart,
};

/** Kind colours: AR desk tones — no purple-on-white cluster. */
const kindColorMap: Record<
  LogicNodeKind,
  { border: string; bg: string; text: string; ring: string; iconBg: string }
> = {
  input: {
    border: "border-[rgba(184,134,11,0.45)]",
    bg: "bg-gradient-to-br from-[rgba(212,178,76,0.18)] via-[var(--ar-surface)] to-[rgba(212,178,76,0.06)]",
    text: "text-[var(--ar-gold-dark)]",
    ring: "ring-[rgba(212,178,76,0.5)]",
    iconBg: "bg-[rgba(212,178,76,0.16)]",
  },
  process: {
    border: "border-[rgba(15,118,110,0.4)]",
    bg: "bg-gradient-to-br from-[rgba(15,118,110,0.1)] via-[var(--ar-surface)] to-[rgba(15,118,110,0.04)]",
    text: "text-teal-800 dark:text-teal-300",
    ring: "ring-teal-500/40",
    iconBg: "bg-teal-500/12",
  },
  engine: {
    border: "border-[rgba(122,30,44,0.45)]",
    bg: "bg-gradient-to-br from-[rgba(122,30,44,0.12)] via-[var(--ar-surface)] to-[rgba(212,178,76,0.08)]",
    text: "text-[var(--ar-maroon)]",
    ring: "ring-[rgba(122,30,44,0.4)]",
    iconBg: "bg-[rgba(122,30,44,0.12)]",
  },
  lookup: {
    border: "border-[rgba(28,25,23,0.28)]",
    bg: "bg-gradient-to-br from-[rgba(28,25,23,0.06)] via-[var(--ar-surface)] to-[rgba(212,178,76,0.05)]",
    text: "text-[var(--ar-ink)]",
    ring: "ring-stone-400/40",
    iconBg: "bg-stone-500/10",
  },
  output: {
    border: "border-[rgba(5,150,105,0.4)]",
    bg: "bg-gradient-to-br from-[rgba(5,150,105,0.1)] via-[var(--ar-surface)] to-[rgba(212,178,76,0.05)]",
    text: "text-emerald-800 dark:text-emerald-300",
    ring: "ring-emerald-500/40",
    iconBg: "bg-emerald-500/12",
  },
};

function FlowNode({
  node,
  index,
  active,
  onClick,
}: {
  node: LogicNode;
  index: number;
  active?: boolean;
  onClick?: () => void;
}) {
  const Icon = kindIcons[node.kind];
  const colors = kindColorMap[node.kind];
  const blurb = node.description;
  const chip = node.bullets?.[0];

  return (
    <motion.button
      className={cn(
        "logic-node group relative min-w-0 w-full flex-1 overflow-hidden rounded-xl border px-3 py-2.5 text-left shadow-sm transition-all duration-200",
        `logic-node--${node.kind}`,
        colors.border,
        colors.bg,
        "cursor-pointer hover:shadow-md",
        active && cn("ring-2 ring-offset-1 ring-offset-[var(--ar-surface)] shadow-md", colors.ring),
      )}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      whileHover={{ y: -1, scale: 1.01 }}
      whileTap={onClick ? { scale: 0.99 } : undefined}
      transition={{ delay: index * 0.03, duration: 0.24, ease: "easeOut" }}
      type="button"
      onClick={onClick}
    >
      <motion.span
        aria-hidden
        className="logic-node__orb"
        animate={{ opacity: [0.28, 0.5, 0.28], scale: [1, 1.06, 1] }}
        transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut", delay: index * 0.1 }}
      />
      <div className="relative z-[1] flex h-full flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className={cn("shrink-0 rounded-md p-1.5", colors.iconBg)}>
            <Icon className={cn("h-3.5 w-3.5", colors.text)} />
          </div>
          <p className={cn("text-[9px] font-bold uppercase tracking-[0.16em] font-ui", colors.text)}>
            {node.kind}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[0.95rem] font-semibold leading-snug text-[var(--ar-ink)]">{node.label}</p>
          <p className="mt-1 line-clamp-6 text-[11px] leading-snug text-[var(--ar-muted)] font-ui">
            {blurb}
          </p>
        </div>
        {chip ? (
          <p className="logic-node__chip font-ui">{chip}</p>
        ) : null}
      </div>
    </motion.button>
  );
}

function FlowArrow() {
  return (
    <motion.div
      className="logic-flow-arrow flex w-5 shrink-0 items-center justify-center self-center"
      animate={{ opacity: [0.4, 1, 0.4], x: [0, 1, 0] }}
      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
    >
      <ArrowRight className="h-4 w-4 text-[var(--ar-gold-dark)]" />
    </motion.div>
  );
}

export function LogicFlowDiagram({
  module,
  activeNodeId,
  onNodeSelect,
}: {
  module: LogicModule;
  activeNodeId?: string;
  onNodeSelect?: (node: LogicNode) => void;
}) {
  return (
    <div className="logic-pipeline-scroll">
      <div className="logic-pipeline-row">
        {module.nodes.map((node, index) => (
          <div key={node.id} className="logic-pipeline-item">
            <FlowNode
              node={node}
              index={index}
              active={activeNodeId === node.id}
              onClick={onNodeSelect ? () => onNodeSelect(node) : undefined}
            />
            {index < module.nodes.length - 1 ? <FlowArrow /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LogicModuleCard({
  module,
  selected,
  onSelect,
}: {
  module: LogicModule;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const Icon = moduleIcons[module.id] ?? BookOpen;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "logic-module-card cursor-pointer",
        `logic-module-card--${module.accent}`,
        selected && "logic-module-card--selected",
      )}
    >
      <span className="logic-module-card__sheen" aria-hidden />
      <span className="logic-module-card__orb logic-module-card__orb--primary" aria-hidden />
      <span className="logic-module-card__orb logic-module-card__orb--secondary" aria-hidden />
      <div className="relative z-[2] flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="logic-module-card__kicker font-ui">
              {module.excelSheet} · {module.stageCount} Stages
            </p>
            <h3 className="logic-module-card__title">{module.title}</h3>
            <p className="mt-0.5 text-xs text-[var(--ar-muted)] font-ui">{module.subtitle}</p>
          </div>
          <div className="rounded-lg border border-[rgba(212,178,76,0.28)] bg-[rgba(212,178,76,0.1)] p-2">
            <Icon className="h-4 w-4 text-[var(--ar-maroon)]" />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {module.metrics.map((m) => (
            <div
              key={m.label}
              className="rounded-md border border-[var(--ar-border)] bg-[rgba(255,252,247,0.72)] px-2 py-1.5 dark:bg-[rgba(34,24,28,0.85)]"
            >
              <p className="text-[8px] uppercase tracking-[0.12em] text-[var(--ar-subtle)] font-ui">{m.label}</p>
              <p className="mt-0.5 font-display text-[0.8rem] leading-tight tabular-nums text-[var(--ar-maroon)]">
                {m.value}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-2.5 line-clamp-2 text-xs leading-snug text-[var(--ar-muted)] font-ui">{module.purpose}</p>
      </div>
    </button>
  );
}
