#!/usr/bin/env python3
"""Verify tenure-window MC path atlas + Path-1 stability (Forwardtester)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.engine.forwardtest import run_forwardtest
from app.engine.market import clear_market_cache, load_market
from app.engine.paths import build_paths, forward_asof
from app.engine.product import (
    DEFAULT_N_PATHS,
    parse_product_workbook,
    path_end_calendar,
    resolved_n_paths,
    resolved_simulation_end,
    resolved_simulation_end_days,
)


def main() -> None:
    clear_market_cache()
    market = load_market()
    product = parse_product_workbook(ROOT / "Product_Input_File.xlsx")
    assert len(product.active_legs) == 6, product.active_legs
    assert all(lg.include for lg in product.legs), "sample product has no excluded legs"
    assert DEFAULT_N_PATHS == 1000
    assert resolved_n_paths(product) == DEFAULT_N_PATHS
    assert resolved_simulation_end_days(product) == product.tenure_days == 1930

    asof = forward_asof(market)
    product_end = resolved_simulation_end(asof, product)
    assert product_end == path_end_calendar(asof, product.tenure_days)

    paths, fwd, params, horizon = build_paths(
        market,
        product.tenure_days,
        "monthly",
        observation_months=product.observation_months,
        product=product,
        attach_spots=False,
    )
    assert len(paths) == DEFAULT_N_PATHS, f"expected {DEFAULT_N_PATHS} MC paths, got {len(paths)}"
    assert all(p.start == asof for p in paths)
    assert all(p.end == paths[0].end for p in paths)
    assert paths[0].path_id == 1
    assert horizon == product_end
    assert (horizon - paths[0].end).days <= 7
    assert all(d.weekday() < 5 for p in paths for d in p.dates)
    assert params.asof == asof.isoformat()
    assert abs(params.spot0 - float(market.closes[-1])) < 1e-9

    # Small N for speed; seeds still deterministic.
    r1 = run_forwardtest(product, "monthly", n_paths=5)
    r2 = run_forwardtest(product, "monthly", n_paths=5)
    assert r1["path_count"] == r2["path_count"] == 5
    t1a = float(r1["summary"][0]["total"])
    t1b = float(r2["summary"][0]["total"])
    assert abs(t1a - t1b) < 1e-9, (t1a, t1b)
    assert r1["product_end"] == r1["simulation_end"] == horizon.isoformat()
    assert int(r1["simulation_end_days"]) == 1930
    assert int(r1["mc_matrix"]["n_paths"]) == 5
    assert int(r1["mc_matrix"]["n_dates"]) > 100
    windows = r1["mc_matrix"]["path_windows"]
    assert all(w["start"] == windows[0]["start"] and w["end"] == windows[0]["end"] for w in windows)

    totals = [float(row["total"]) for row in r1["summary"]]
    assert len(set(round(t, 6) for t in totals)) >= 2, totals

    print(
        f"OK n_default={len(paths)} smoke_n=5 asof={asof} product_end={horizon} "
        f"path1_total={t1a:.6f} mc_dates={r1['mc_matrix']['n_dates']} "
        f"fwd_sessions={len([d for d in fwd.dates if asof <= d <= horizon])}"
    )


if __name__ == "__main__":
    main()
