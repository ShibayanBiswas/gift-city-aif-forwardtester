"""Verify forward calendar desk rules (Mon–Fri, monthly option expiry = futures shift).

Horizon = Product End = path_end_calendar(as-of, tenure) — not Simulation End Days.

Run from repo root:
  PYTHONPATH=backend .venv/Scripts/python scripts/verify_forward_calendar.py
"""
from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.engine.calendar_build import (  # noqa: E402
    TUESDAY_EXPIRY_ERA_START,
    expiry_weekday_for,
    last_monthly_expiry_on_or_before,
)
from app.engine.forward_calendar import _weekday_sessions  # noqa: E402
from app.engine.market import clear_market_cache, load_market  # noqa: E402
from app.engine.paths import build_forward_market, build_paths, forward_asof  # noqa: E402
from app.engine.product import (  # noqa: E402
    DEFAULT_N_PATHS,
    parse_product_workbook,
    path_end_calendar,
    resolved_simulation_end,
    resolved_simulation_end_days,
)


def _month_end(d: date) -> date:
    if d.month == 12:
        return date(d.year + 1, 1, 1) - timedelta(days=1)
    return date(d.year, d.month + 1, 1) - timedelta(days=1)


def main() -> int:
    clear_market_cache()
    sample = ROOT / "Product_Input_File.xlsx"
    prod = parse_product_workbook(sample, name="Sample")
    m = load_market()
    asof = forward_asof(m)
    horizon = resolved_simulation_end(asof, prod)
    sim_days = resolved_simulation_end_days(prod)

    assert DEFAULT_N_PATHS == 1000
    assert sim_days == prod.tenure_days == 1930
    assert horizon == path_end_calendar(asof, prod.tenure_days)

    # Historical: futures shifts == monthly option expiries (WF1 / Backtester).
    assert m.roll_shifts == m.expiries, (
        f"hist rolls≠expiries first_diff={next((a,b) for a,b in zip(m.roll_shifts,m.expiries) if a!=b)}"
        if len(m.roll_shifts) == len(m.expiries)
        else f"len rolls={len(m.roll_shifts)} exp={len(m.expiries)}"
    )

    fwd, _ = build_forward_market(
        m,
        horizon,
        prod.tenure_days,
        observation_months=prod.observation_months,
        fill_gbm=False,
    )

    span = [d for d in fwd.dates if asof <= d <= horizon]
    assert all(d.weekday() < 5 for d in span), "weekend session in forward pad"
    # Tenure ~5Y ≈ 1200+ sessions (not the old 7300d ≈ 5000+).
    assert len(span) > 800, len(span)
    assert set(span).issubset(set(_weekday_sessions(asof, horizon)))

    if asof < date(2028, 2, 29) <= horizon:
        assert date(2028, 2, 29) in fwd.date_to_idx

    trading = set(fwd.dates)
    # After as-of: futures shift == monthly option expiry (never month-end TD).
    # As-of month is included when its expiry is still ahead (e.g. Aug expiry
    # after an early-August as-of).
    fwd_rolls = [d for d in fwd.roll_shifts if asof < d <= horizon]
    fwd_exps = [e for e in fwd.expiries if asof < e <= horizon]
    assert fwd_rolls == fwd_exps, (fwd_rolls[:3], fwd_exps[:3])
    assert fwd_rolls, "expected at least one forward monthly expiry"
    # Prior hist shift (July when as-of is early August) must precede first forward.
    hist_prior = [d for d in m.roll_shifts if d <= asof]
    assert hist_prior, "expected historical roll calendar through as-of"
    assert hist_prior[-1] < fwd_rolls[0], (hist_prior[-1], fwd_rolls[0])
    # Current month: if scheduled monthly expiry is still after as-of, it must appear.
    from calendar import monthrange

    asof_me = date(asof.year, asof.month, monthrange(asof.year, asof.month)[1])
    asof_month_exp = last_monthly_expiry_on_or_before(asof_me, trading, asof=horizon)
    if asof_month_exp is not None and asof_month_exp > asof:
        assert asof_month_exp == fwd_rolls[0], (asof_month_exp, fwd_rolls[0])
    for e in fwd_exps:
        assert e in trading, e
        me = _month_end(e)
        expect = last_monthly_expiry_on_or_before(me, trading, asof=horizon)
        assert e == expect, (e, expect, me)
        # Holiday floor is backward only: scheduled weekday ≥ expiry date.
        weekday = expiry_weekday_for(me)
        scheduled = me
        while scheduled.weekday() != weekday:
            scheduled -= timedelta(days=1)
        assert e <= scheduled and (scheduled - e).days <= 10, (e, scheduled)
        # Tue-era monthly expiries land on Tue, or Mon/Fri after a holiday snap —
        # never Wed/Thu (that was the over-projected-holiday bug, e.g. 24-Mar-2027).
        if e >= TUESDAY_EXPIRY_ERA_START:
            assert e.weekday() in (0, 1, 4), (
                f"Tue-era monthly expiry on invalid weekday: {e.isoformat()} "
                f"{e.strftime('%A')} (scheduled last Tue={scheduled.isoformat()})"
            )
        else:
            # Thu-era: Thu, or Wed/Tue/Mon/Fri after snap — not after a forward move.
            assert e.weekday() <= weekday or e < scheduled, (e, weekday)

    paths, fm, params, h = build_paths(
        m,
        prod.tenure_days,
        "monthly",
        observation_months=prod.observation_months,
        product=prod,
        n_paths=5,
        attach_spots=True,
    )
    assert len(paths) == 5
    assert all(p.start == asof for p in paths)
    assert all(p.end == paths[0].end for p in paths)
    assert h == horizon
    assert params.asof == asof.isoformat()
    last_td = [d for d in fm.dates if paths[0].start <= d <= horizon][-1]
    assert paths[0].end == last_td
    for path in paths:
        assert all(d.weekday() < 5 for d in path.dates)
        assert path.spots is not None and len(path.spots) == len(path.dates)

    print(
        "OK forward calendar",
        f"asof={asof} product_end={horizon} days={(horizon - asof).days}",
        f"sessions={len(span)} rolls={len(fwd_rolls)} expiries={len(fwd_exps)} "
        f"rolls_eq_expiries={fwd_rolls == fwd_exps} paths={len(paths)}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
