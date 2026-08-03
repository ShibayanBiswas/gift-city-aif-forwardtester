"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { client, formatDeskDate, formatNum } from "@/lib/api";
import { easeOut } from "@/lib/motion";

type ChartPayload = Awaited<ReturnType<typeof client.mcMatrixChart>>;

const PAD = { top: 28, right: 22, bottom: 56, left: 72 };

function lerpColor(t: number): string {
  // Maroon → gold, matching Backtester chart accents.
  const a = { r: 122, g: 30, b: 44 };
  const b = { r: 212, g: 178, b: 76 };
  const u = Math.min(1, Math.max(0, t));
  const r = Math.round(a.r + (b.r - a.r) * u);
  const g = Math.round(a.g + (b.g - a.g) * u);
  const bl = Math.round(a.b + (b.b - a.b) * u);
  return `rgb(${r},${g},${bl})`;
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function niceTicks(min: number, max: number, count = 6): number[] {
  if (!(Number.isFinite(min) && Number.isFinite(max)) || min === max) {
    const c = Number.isFinite(min) ? min : 0;
    return [c - 1, c, c + 1];
  }
  const span = max - min;
  const raw = span / Math.max(1, count - 1);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const steps = [1, 2, 2.5, 5, 10];
  let step = steps[0] * pow;
  for (const s of steps) {
    const cand = s * pow;
    if (cand >= raw) {
      step = cand;
      break;
    }
    step = cand;
  }
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step * 0.5; v += step) {
    ticks.push(Number(v.toPrecision(12)));
  }
  return ticks;
}

function FanCanvas({
  dates,
  series,
}: {
  dates: string[];
  series: number[][];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 960, h: 420 });
  const [hover, setHover] = useState<{ pathId: number; x: number; y: number } | null>(null);

  const bounds = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const row of series) {
      for (const v of row) {
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      return { lo: 0, hi: 1 };
    }
    const pad = (hi - lo) * 0.04 || Math.abs(hi) * 0.02 || 1;
    return { lo: lo - pad, hi: hi + pad };
  }, [series]);

  const yTicks = useMemo(() => niceTicks(bounds.lo, bounds.hi, 7), [bounds]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setSize({
        w: Math.max(320, Math.floor(cr.width)),
        h: Math.max(320, Math.floor(cr.height)),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(
    (hoverPath: number | null) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const { w, h } = size;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const plotW = w - PAD.left - PAD.right;
      const plotH = h - PAD.top - PAD.bottom;
      const nDates = dates.length;
      const nPaths = series.length;
      if (nDates < 2 || nPaths < 1 || plotW <= 0 || plotH <= 0) return;

      const tick = readCssVar("--ar-chart-tick", "#5c534c");
      const label = readCssVar("--ar-chart-label", "#3f3832");
      const grid = readCssVar("--ar-chart-grid-strong", "rgba(122,30,44,0.2)");
      const border = readCssVar("--ar-chart-border", "rgba(184,134,11,0.22)");
      const surface = readCssVar("--ar-surface", "#fffcf7");

      const xAt = (i: number) => PAD.left + (i / (nDates - 1)) * plotW;
      const yAt = (v: number) => {
        const t = (v - bounds.lo) / (bounds.hi - bounds.lo || 1);
        return PAD.top + (1 - t) * plotH;
      };

      // Plot backdrop
      ctx.fillStyle = readCssVar("--ar-chart-plot", "#faf6ef");
      ctx.fillRect(PAD.left, PAD.top, plotW, plotH);

      // Grid — Backtester-style dashed crosses
      ctx.save();
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      for (const yv of yTicks) {
        const y = yAt(yv);
        if (y < PAD.top - 1 || y > PAD.top + plotH + 1) continue;
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(PAD.left + plotW, y);
        ctx.stroke();
      }
      const xTickCount = Math.min(8, nDates);
      for (let t = 0; t < xTickCount; t++) {
        const i = Math.round((t / Math.max(1, xTickCount - 1)) * (nDates - 1));
        const x = xAt(i);
        ctx.beginPath();
        ctx.moveTo(x, PAD.top);
        ctx.lineTo(x, PAD.top + plotH);
        ctx.stroke();
      }
      ctx.restore();

      // Frame
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.strokeRect(PAD.left + 0.5, PAD.top + 0.5, plotW - 1, plotH - 1);

      // Paths
      const baseAlpha = nPaths > 400 ? 0.18 : nPaths > 150 ? 0.28 : 0.42;
      for (let p = 0; p < nPaths; p++) {
        if (hoverPath != null && p + 1 === hoverPath) continue;
        const row = series[p];
        if (!row?.length) continue;
        ctx.beginPath();
        ctx.strokeStyle = lerpColor(nPaths <= 1 ? 0.35 : p / (nPaths - 1));
        ctx.globalAlpha = baseAlpha;
        ctx.lineWidth = nPaths > 300 ? 0.9 : 1.15;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        for (let i = 0; i < Math.min(row.length, nDates); i++) {
          const x = xAt(i);
          const y = yAt(row[i]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (hoverPath != null && hoverPath >= 1 && hoverPath <= nPaths) {
        const row = series[hoverPath - 1];
        if (row?.length) {
          ctx.beginPath();
          ctx.strokeStyle = "#7a1e2c";
          ctx.lineWidth = 2.6;
          ctx.shadowColor = "rgba(122, 30, 44, 0.35)";
          ctx.shadowBlur = 8;
          for (let i = 0; i < Math.min(row.length, nDates); i++) {
            const x = xAt(i);
            const y = yAt(row[i]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.shadowBlur = 0;

          // End cap
          const lastI = Math.min(row.length, nDates) - 1;
          ctx.beginPath();
          ctx.fillStyle = "#d4b24c";
          ctx.strokeStyle = surface;
          ctx.lineWidth = 2;
          ctx.arc(xAt(lastI), yAt(row[lastI]), 4.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      // Y labels
      ctx.fillStyle = tick;
      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (const yv of yTicks) {
        const y = yAt(yv);
        if (y < PAD.top - 4 || y > PAD.top + plotH + 4) continue;
        ctx.fillText(formatNum(yv, 0), PAD.left - 10, y);
      }

      // X labels
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let t = 0; t < xTickCount; t++) {
        const i = Math.round((t / Math.max(1, xTickCount - 1)) * (nDates - 1));
        const x = xAt(i);
        ctx.fillText(formatDeskDate(dates[i]), x, PAD.top + plotH + 10);
      }

      // Axis titles — no brackets
      ctx.fillStyle = label;
      ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("Trading Date", PAD.left + plotW / 2, h - 8);

      ctx.save();
      ctx.translate(16, PAD.top + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Nifty Level", 0, 0);
      ctx.restore();
    },
    [bounds, dates, series, size, yTicks],
  );

  useEffect(() => {
    draw(hover?.pathId ?? null);
  }, [draw, hover]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || dates.length < 2 || !series.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const plotW = size.w - PAD.left - PAD.right;
    const plotH = size.h - PAD.top - PAD.bottom;
    if (x < PAD.left || x > PAD.left + plotW || y < PAD.top || y > PAD.top + plotH) {
      setHover(null);
      return;
    }
    const nDates = dates.length;
    const xi = Math.round(((x - PAD.left) / plotW) * (nDates - 1));
    const idx = Math.min(nDates - 1, Math.max(0, xi));
    const yAt = (v: number) => {
      const t = (v - bounds.lo) / (bounds.hi - bounds.lo || 1);
      return PAD.top + (1 - t) * plotH;
    };
    let best = -1;
    let bestDist = Infinity;
    for (let p = 0; p < series.length; p++) {
      const v = series[p]?.[idx];
      if (!Number.isFinite(v)) continue;
      const dy = Math.abs(yAt(v) - y);
      if (dy < bestDist) {
        bestDist = dy;
        best = p;
      }
    }
    if (best < 0 || bestDist > 28) {
      setHover(null);
      return;
    }
    setHover({ pathId: best + 1, x, y });
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full min-h-[20rem]">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-crosshair"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        aria-label="Simulated Nifty path fan chart"
      />
      {hover ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[120%] rounded-full border border-[var(--ar-chart-border)] bg-[var(--ar-surface)] px-3 py-1 font-display text-sm text-[var(--ar-maroon)] shadow-md"
          style={{ left: hover.x, top: hover.y }}
        >
          Path {hover.pathId}
        </div>
      ) : null}
    </div>
  );
}

export function SimulatedNiftyPathsChart({ jobId }: { jobId: string }) {
  const [payload, setPayload] = useState<ChartPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void client
      .mcMatrixChart(jobId, 220)
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
      })
      .catch((e) => {
        if (cancelled) return;
        setPayload(null);
        setError(e instanceof Error ? e.message : "Failed to load path chart");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  return (
    <motion.div
      className="border-t border-[var(--ar-border)] px-5 py-5"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={easeOut}
    >
      <div className="mb-3">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ar-subtle)] font-ui">Simulated Paths</p>
        <h4 className="font-display text-lg text-[var(--ar-maroon)] md:text-xl">Nifty Levels Across Paths</h4>
        <p className="mt-1 text-sm text-[var(--ar-muted)] font-ui">
          Hover a line to highlight that path number.
        </p>
      </div>
      {error ? <p className="mb-3 text-sm text-[var(--ar-maroon)] font-ui">{error}</p> : null}
      <div className="chart-shell h-[26rem] overflow-visible md:h-[28rem]">
        {loading && !payload ? (
          <div className="flex h-full items-center justify-center font-ui text-sm text-[var(--ar-muted)]">
            Loading path lines…
          </div>
        ) : payload?.dates?.length && payload.series?.length ? (
          <FanCanvas dates={payload.dates} series={payload.series} />
        ) : (
          <div className="flex h-full items-center justify-center font-ui text-sm text-[var(--ar-muted)]">
            No path lines to display
          </div>
        )}
      </div>
    </motion.div>
  );
}
