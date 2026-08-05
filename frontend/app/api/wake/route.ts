import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
/** Allow Render cold start + Yahoo sync when cron / desk wake hits this route. */
export const maxDuration = 60;

/**
 * Server-side wake for the Render API (avoids browser hanging on cold proxy).
 * Used by Vercel Cron and optional desk preflight.
 *
 * Prefer /api/sync so As Of / Product End advance with the latest Nifty close;
 * fall back to ping/health if sync is unavailable.
 */
export async function GET() {
  const backend = (process.env.BACKEND_URL || "").replace(/\/$/, "");
  if (!backend) {
    return NextResponse.json(
      { ok: false, reason: "BACKEND_URL not configured" },
      { status: 503 },
    );
  }

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55_000);
  try {
    const syncRes = await fetch(`${backend}/api/sync`, {
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (syncRes.ok) {
      const body = await syncRes.json().catch(() => ({}));
      return NextResponse.json({
        ok: true,
        upstream: body,
        ms: Date.now() - started,
        backend,
        via: "sync",
        asof: (body as { asof?: string })?.asof ?? null,
        simulation_end:
          (body as { simulation_end?: string })?.simulation_end ?? null,
      });
    }

    const pingRes = await fetch(`${backend}/api/ping`, {
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (pingRes.ok) {
      const body = await pingRes.json().catch(() => ({}));
      return NextResponse.json({
        ok: true,
        upstream: body,
        ms: Date.now() - started,
        backend,
        via: "ping",
      });
    }

    const healthRes = await fetch(`${backend}/api/health`, {
      cache: "no-store",
      signal: ctrl.signal,
    });
    const body = await healthRes.json().catch(() => ({}));
    return NextResponse.json({
      ok: healthRes.ok,
      upstream: body,
      ms: Date.now() - started,
      backend,
      via: "health-fallback",
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        ms: Date.now() - started,
        backend,
      },
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}
