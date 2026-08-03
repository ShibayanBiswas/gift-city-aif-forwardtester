"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { LayoutDashboard, BarChart3, Calculator, Sparkles, Moon, Sun, Upload, Play, Download } from "lucide-react";
import { mainSections, resolveNav } from "@/lib/navigation";
import { cn, client, clampNPaths, DEFAULT_N_PATHS, MAX_N_PATHS, MIN_N_PATHS } from "@/lib/api";
import { useForwardTest } from "@/lib/store";
import { deskSpring } from "@/lib/motion";

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
    nPaths,
    setNPaths,
    sinceYear,
    setSinceYear,
    years,
    running,
    run,
    upload,
    product,
    setError,
  } = useForwardTest();

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
                <motion.span className="relative inline-flex" whileHover={{ scale: 1.1, rotate: -4 }}>
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
          <label
            className="inline-flex items-center gap-1.5 text-xs text-[var(--ar-muted)]"
            title={`Monte Carlo paths over the tenure window (${MIN_N_PATHS}–${MAX_N_PATHS})`}
          >
            <span className="hidden sm:inline">MC Paths</span>
            <input
              type="number"
              min={MIN_N_PATHS}
              max={MAX_N_PATHS}
              step={1}
              value={nPaths}
              disabled={running}
              onChange={(e) => {
                const raw = Number(e.target.value);
                if (!Number.isFinite(raw)) return;
                setNPaths(clampNPaths(raw || DEFAULT_N_PATHS));
              }}
              className="desk-select w-[4.5rem] disabled:opacity-50"
            />
          </label>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ar-border)] px-3 py-1.5 text-xs hover:border-[var(--ar-gold)]"
            onClick={() => {
              void client.downloadSample().catch((e) => {
                setError(e instanceof Error ? e.message : String(e));
              });
            }}
          >
            <Download size={14} />
            <span className="hidden md:inline">Sample Input</span>
          </button>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--ar-border)] px-3 py-1.5 text-xs hover:border-[var(--ar-gold)]">
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
          </label>
          <button
            type="button"
            disabled={running || !product}
            onClick={() => void run()}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ar-maroon)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
          >
            <Play size={14} /> Run
          </button>
          <button
            type="button"
            aria-label="Toggle theme"
            onClick={() => setDark(!dark)}
            className="rounded-full border border-[var(--ar-border)] p-2"
          >
            {dark ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {section.subNav?.length ? (
          <motion.div
            key={section.id}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="nav-sub-bar border-t"
          >
            <div className="mx-auto flex max-w-full flex-wrap gap-1 px-4 py-2 lg:px-6">
              {section.subNav.map((item) => {
                const active = item.match(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn("nav-sub-pill font-ui", active && "nav-sub-pill-active")}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
