#!/usr/bin/env python3
"""Verify monthly forward path atlas + Path-1 stability (Forwardtester, not historical WF1 pins)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.engine.forwardtest import run_forwardtest
from app.engine.market import clear_market_cache, load_market
from app.engine.paths import build_paths, forward_asof
from app.engine.product import (
    DEFAULT_SIMULATION_END_DAYS,
    parse_product_workbook,
    resolved_simulation_end_days,
)


def main() -> None:
    clear_market_cache()
    market = load_market()
    product = parse_product_workbook(ROOT / "Product_Input_File.xlsx")
    assert len(product.active_legs) == 6, product.active_legs
    assert all(lg.include for lg in product.legs), "sample product has no excluded legs"
    assert resolved_simulation_end_days(product) == DEFAULT_SIMULATION_END_DAYS == 7300

    asof = forward_asof(market)
    paths, fwd, params, horizon = build_paths(
        market,
        product.tenure_days,
        "monthly",
        observation_months=product.observation_months,
        product=product,
        attach_spots=False,
    )
    assert len(paths) >= 50, f"expected ≥50 monthly paths for 7300d horizon, got {len(paths)}"
    assert paths[0].start == asof, (paths[0].start, asof)
    assert paths[0].path_id == 1
    assert (horizon - paths[-1].end).days <= 7
    assert all(d.weekday() < 5 for p in paths for d in p.dates)
    assert params.asof == asof.isoformat()
    assert abs(params.spot0 - float(market.closes[-1])) < 1e-9

    r1 = run_forwardtest(product, "monthly")
    r2 = run_forwardtest(product, "monthly")
    assert r1["path_count"] == len(paths) == r2["path_count"]
    t1a = float(r1["summary"][0]["total"])
    t1b = float(r2["summary"][0]["total"])
    assert abs(t1a - t1b) < 1e-9, (t1a, t1b)
    assert int(r1["simulation_end_days"]) == 7300
    assert int(r1["mc_matrix"]["n_paths"]) == len(paths)
    assert int(r1["mc_matrix"]["n_dates"]) > 1000

    # Path totals must differ across paths (independent GBM streams)
    totals = [float(row["total"]) for row in r1["summary"][:10]]
    assert len(set(round(t, 6) for t in totals)) >= 2, totals

    print(
        f"OK monthly={len(paths)} asof={asof} horizon={horizon} "
        f"path1_total={t1a:.6f} mc_dates={r1['mc_matrix']['n_dates']} "
        f"fwd_sessions={len([d for d in fwd.dates if asof <= d <= horizon])}"
    )


if __name__ == "__main__":
    main()
