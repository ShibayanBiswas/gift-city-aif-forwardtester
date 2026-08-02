"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { LayoutDashboard, BarChart3, Calculator, Sparkles, Moon, Sun, Upload, Play, Download } from "lucide-react";
import { mainSections, resolveNav } from "@/lib/navigation";
import { cn, client, FREQUENCY_ORDER, FREQUENCY_LABELS } from "@/lib/api";
import { useForwardTest } from "@/lib/store";
import { deskSpring, tapPress } from "@/lib/motion";

const icons = {
  home: LayoutDashboard,
  analytics: BarChart3,
  desk: Calculator,
  intel: Sparkles,
} as const;

export function SiteNav() {
  const pathname = usePathname();
  const section = resolveNav(pathname);
  const {
    dark,
    setDark,
    frequency,
    setFrequency,
    sinceYear,
    setSinceYear,
    years,
    running,
    run,
    upload,
    product,
    market,
    setError,
  } = useForwardTest();
  const pathCounts = market?.path_counts;

  return (
    <div className="border-t border-[var(--ar-border)]">
      <div className="mx-auto flex max-w-full flex-wrap items-center justify-between gap-3 px-4 py-2 lg:px-6">
        <div className="nav-pill-shell flex items-center gap-1 rounded-2xl border p-1.5 shadow-md">
          {mainSections.map((item) => {
            const active = section.id === item.id;
            const Icon = icons[item.id as keyof typeof icons] ?? LayoutDashboard;
            return (
              <Link
                key={item.id}
                href={item.href}
                className={cn(
                  "relative flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold font-ui transition-all md:px-5",
                  active ? "btn-nav-active" : "text-[var(--ar-muted)] hover:bg-[var(--ar-panel)] hover:text-[var(--ar-ink)]",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="main-nav-active"
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-[rgba(212,178,76,0.35)] to-[rgba(122,30,44,0.18)] shadow-inner"
                    transition={deskSpring}
                  />
                ) : null}
                <motion.span
                  className="relative inline-flex"
                  whileHover={{ scale: 1.12, rotate: -6 }}
                  transition={deskSpring}
                >
                  <Icon className="h-4 w-4" />
                </motion.span>
                <span className="relative">{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 font-ui">
          <select
            value={sinceYear}
            onChange={(e) => setSinceYear(Number(e.target.value))}
            className="desk-select"
            title="Analytics Since Year"
          >
            {(years.length ? years : [2001]).map((y) => (
              <option key={y} value={y}>
                Since Calendar Year {y}
              </option>
            ))}
          </select>
          <select
            value={frequency}
            disabled={running}
            onChange={(e) => setFrequency(e.target.value as typeof frequency)}
            className="desk-select disabled:opacity-50"
            title={
              running
                ? "Wait for the current simulation to finish"
                : "Path Frequency · Daily grids take longer on free hosts"
            }
          >
            {FREQUENCY_ORDER.map((f) => {
              const n = pathCounts?.[f];
              const label = FREQUENCY_LABELS[f];
              return (
                <option key={f} value={f}>
                  {n != null && Number.isFinite(n)
                    ? `${label} · ${n.toLocaleString("en-IN")} paths`
                    : label}
                </option>
              );
            })}
          </select>
          <motion.button
            type="button"
            className="desk-btn inline-flex items-center gap-1.5 rounded-full border border-[var(--ar-border)] px-3 py-1.5 text-xs"
            whileHover={{ y: -1 }}
            whileTap={tapPress}
            onClick={() => {
              void client.downloadSample().catch((e) => {
                setError(e instanceof Error ? e.message : String(e));
              });
            }}
          >
            <Download size={14} />
            <span className="hidden md:inline">Sample Input</span>
          </motion.button>
          <motion.label
            className="desk-btn inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--ar-border)] px-3 py-1.5 text-xs"
            whileHover={{ y: -1 }}
            whileTap={tapPress}
          >
            <Upload size={14} />
            <span className="hidden md:inline">Upload</span>
            <input
              type="file"
              accept=".xlsx,.xlsm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
          </motion.label>
          <motion.button
            type="button"
            disabled={running || !product}
            onClick={() => void run()}
            className="desk-btn desk-btn-primary desk-btn-run inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold"
            whileHover={running || !product ? undefined : { scale: 1.04, y: -1 }}
            whileTap={running || !product ? undefined : tapPress}
          >
            <motion.span
              animate={running ? { rotate: 360 } : { rotate: 0 }}
              transition={running ? { duration: 1.2, repeat: Infinity, ease: "linear" } : undefined}
              className="inline-flex"
            >
              <Play size={14} fill="currentColor" />
            </motion.span>
            Run
          </motion.button>
          <motion.button
            type="button"
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            title={dark ? "Light mode" : "Dark mode"}
            onClick={() => setDark(!dark)}
            className="theme-toggle"
            whileHover={{ scale: 1.04 }}
            whileTap={tapPress}
            transition={deskSpring}
          >
            <span className="theme-toggle__rail" aria-hidden>
              <motion.span
                className="theme-toggle__thumb"
                initial={false}
                animate={{ left: dark ? "50%" : "0%" }}
                transition={deskSpring}
              />
              <span className={cn("theme-toggle__opt", !dark && "is-active")}>
                <motion.span
                  key="moon"
                  animate={!dark ? { rotate: [0, -12, 0], scale: 1 } : { scale: 0.92 }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  className="inline-flex"
                >
                  <Moon size={13} strokeWidth={2.25} />
                </motion.span>
              </span>
              <span className={cn("theme-toggle__opt", dark && "is-active")}>
                <motion.span
                  key="sun"
                  animate={dark ? { rotate: [0, 20, 0], scale: 1 } : { scale: 0.92 }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  className="inline-flex"
                >
                  <Sun size={13} strokeWidth={2.25} />
                </motion.span>
              </span>
            </span>
          </motion.button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {section.subNav?.length ? (
          <motion.div
            key={section.id}
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="nav-sub-bar border-t overflow-hidden"
          >
            <div className="mx-auto flex max-w-full flex-wrap gap-1 px-4 py-2 lg:px-6">
              {section.subNav.map((item) => {
                const active = item.match(pathname);
                return (
                  <motion.div key={item.href} whileHover={{ y: -1 }} transition={deskSpring}>
                    <Link
                      href={item.href}
                      className={cn("nav-sub-pill font-ui", active && "nav-sub-pill-active")}
                    >
                      {item.label}
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
