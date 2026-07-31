"""Verify forward calendar desk rules (Mon–Fri, last-Tuesday expiry, month-end rolls).

Run from repo root:
  PYTHONPATH=backend .venv/Scripts/python scripts/verify_forward_calendar.py
"""
from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.engine.forward_calendar import (  # noqa: E402
    _last_tuesday_of_month_calendar,
    _last_weekday_of_month,
    _weekday_sessions,
)
from app.engine.market import clear_market_cache, load_market  # noqa: E402
from app.engine.paths import build_forward_market, build_paths, forward_asof  # noqa: E402
from app.engine.product import (  # noqa: E402
    DEFAULT_SIMULATION_END_DAYS,
    parse_product_workbook,
    resolved_simulation_end,
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

    assert DEFAULT_SIMULATION_END_DAYS == 3650
    assert (horizon - asof).days == int(
        prod.simulation_end_days or DEFAULT_SIMULATION_END_DAYS
    )

    fwd, _ = build_forward_market(
        m,
        horizon,
        prod.tenure_days,
        observation_months=prod.observation_months,
        fill_gbm=True,
    )

    span = [d for d in fwd.dates if asof <= d <= horizon]
    assert all(d.weekday() < 5 for d in span), "weekend session in forward pad"
    assert not [d for d in _weekday_sessions(asof, horizon) if d not in fwd.date_to_idx]

    # Leap February must be on the pad when it falls inside the horizon.
    if asof < date(2028, 2, 29) <= horizon:
        assert date(2028, 2, 29) in fwd.date_to_idx

    fwd_rolls = [d for d in fwd.roll_shifts if asof < d <= horizon]
    fwd_exps = [e for e in fwd.expiries if asof < e <= horizon]
    for r in fwd_rolls:
        assert r == _last_weekday_of_month(_month_end(r)), r
        assert abs(float(fwd.roll_by_expiry.get(r, 0.0))) > 0
    for e in fwd_exps:
        assert e.weekday() == 1
        assert e == _last_tuesday_of_month_calendar(_month_end(e)), e

    paths, fm, _, h = build_paths(
        m,
        prod.tenure_days,
        "monthly",
        observation_months=prod.observation_months,
        product=prod,
        attach_spots=True,
    )
    assert paths[0].start == asof
    assert h == horizon
    last_td = [d for d in fm.dates if paths[-1].start <= d <= horizon][-1]
    assert paths[-1].end == last_td
    for path in paths:
        assert all(d.weekday() < 5 for d in path.dates)
        assert path.spots is not None and len(path.spots) == len(path.dates)

    print(
        "OK forward calendar",
        f"asof={asof} horizon={horizon} days={(horizon - asof).days}",
        f"sessions={len(span)} rolls={len(fwd_rolls)} expiries={len(fwd_exps)} paths={len(paths)}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
