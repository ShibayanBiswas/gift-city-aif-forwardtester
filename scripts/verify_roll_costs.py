"""Verify WF1 roll-cost day-count rules (first month = trading days; later = calendar Δt).

Run from repo root:
  PYTHONPATH=backend .venv/Scripts/python scripts/verify_roll_costs.py
"""
from __future__ import annotations

import sys
from datetime import timedelta
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.engine.market import _recompute_roll_costs, clear_market_cache, load_market  # noqa: E402
from app.engine.paths import build_forward_market, forward_asof  # noqa: E402
from app.engine.product import parse_product_workbook, resolved_simulation_end  # noqa: E402


def main() -> int:
    clear_market_cache()
    m = load_market()
    dates = list(m.dates)
    closes = np.asarray(m.closes, dtype=float)
    shifts = list(m.roll_shifts)

    first = shifts[0]
    assert all(d.weekday() < 5 for d in dates if d <= first)

    idx = [i for i, d in enumerate(dates) if d <= first]
    n_td = len(idx)
    avg = float(closes[idx].mean())
    first_cost = avg * 0.07 * n_td / 365.0
    stored = float(m.roll_by_expiry[first])
    assert n_td == 19, n_td
    assert abs(first_cost - stored) < 1e-9
    assert abs(stored - 4.771334) < 1e-5

    s0, s1 = shifts[0], shifts[1]
    cal = (s1 - s0).days
    idx2 = [i for i, d in enumerate(dates) if s0 < d <= s1]
    assert all(dates[i].weekday() < 5 for i in idx2)
    # Calendar span must include weekends (Sat/Sun) — WF1 uses calendar Δt, not TD count.
    span = [s0 + timedelta(days=i) for i in range(1, cal + 1)]
    assert any(d.weekday() >= 5 for d in span)
    later = float(closes[idx2].mean()) * 0.07 * cal / 365.0
    assert abs(later - float(m.roll_by_expiry[s1])) < 1e-6

    model = _recompute_roll_costs(dates, closes, shifts)
    assert abs(model[first] - stored) < 1e-12

    prod = parse_product_workbook(ROOT / "Product_Input_File.xlsx")
    asof = forward_asof(m)
    horizon = resolved_simulation_end(asof, prod)
    fwd, _ = build_forward_market(
        m,
        horizon,
        prod.tenure_days,
        observation_months=prod.observation_months,
        fill_gbm=True,
    )
    hist_last = [d for d in fwd.roll_shifts if d <= asof][-1]
    fwd0 = next(d for d in fwd.roll_shifts if d > asof)
    cal_f = (fwd0 - hist_last).days
    idx_f = [i for i, d in enumerate(fwd.dates) if hist_last < d <= fwd0]
    assert all(fwd.dates[i].weekday() < 5 for i in idx_f)
    manual_f = float(np.asarray(fwd.closes, float)[idx_f].mean()) * 0.07 * cal_f / 365.0
    assert abs(manual_f - float(fwd.roll_by_expiry[fwd0])) < 1e-6

    print(
        "OK roll costs",
        f"first_td={n_td} first_cost={stored:.6f}",
        f"later_cal={cal} weekends_in_span=yes",
        f"forward {hist_last}->{fwd0} cal={cal_f}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
