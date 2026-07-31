"use client";

import { useMemo } from "react";
import { cn } from "@/lib/api";

export function PathCalendar({
  dates,
  observations,
}: {
  dates: string[];
  observations: string[];
}) {
  const obs = useMemo(() => new Set(observations), [observations]);
  const byMonth = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const d of dates) {
      const key = d.slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return Array.from(map.entries());
  }, [dates]);

  return (
    <div className="ar-band space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ar-subtle)] font-ui">Path Calendar</p>
          <h3 className="font-serif text-xl text-[var(--ar-maroon)]">Trading Days</h3>
        </div>
        <p className="text-sm text-[var(--ar-muted)] font-ui">
          {dates.length} sessions · {observations.length} observations
        </p>
      </div>
      <div className="max-h-[520px] overflow-auto rounded-xl border border-[var(--ar-border)] p-3">
        <div className="space-y-5">
          {byMonth.map(([month, days]) => (
            <div key={month}>
              <div className="mb-2 flex items-center gap-3">
                <span className="text-sm font-medium tracking-wide font-ui">{month}</span>
                <div className="ar-gold-rule flex-1" />
                <span className="text-xs text-[var(--ar-subtle)]">{days.length}d</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {days.map((d) => {
                  const isObs = obs.has(d);
                  return (
                    <span
                      key={d}
                      title={d}
                      className={cn(
                        "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-xs tabular-nums font-ui",
                        isObs
                          ? "bg-[var(--ar-maroon)] text-white shadow"
                          : "bg-[var(--ar-panel)] text-[var(--ar-muted)] ring-1 ring-[var(--ar-border)]",
                      )}
                    >
                      {d.slice(8)}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-[var(--ar-subtle)] font-ui">
        Maroon chips = observation / Nifty monthly option expiry dates.
      </p>
    </div>
  );
}
