"""Verify Monte Carlo path atlas: N identical tenure windows (Start=asof, End=Product End).

Run:
  PYTHONPATH=backend .venv/Scripts/python scripts/verify_path_counts.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.engine.market import clear_market_cache, load_market
from app.engine.paths import (
    ALL_FREQUENCIES,
    build_paths,
    count_monte_carlo_paths,
    count_paths_by_frequency,
    forward_asof,
)
from app.engine.product import (
    DEFAULT_N_PATHS,
    parse_product_workbook,
    path_end_calendar,
    resolved_n_paths,
    resolved_simulation_end,
)


def main() -> int:
    clear_market_cache()
    market = load_market()
    product = parse_product_workbook(ROOT / "Product_Input_File.xlsx")
    asof = forward_asof(market)
    horizon = resolved_simulation_end(asof, product)
    expect_end = path_end_calendar(asof, product.tenure_days)
    n = resolved_n_paths(product)

    assert DEFAULT_N_PATHS == 1000
    assert n == count_monte_carlo_paths(product)
    assert n == resolved_n_paths(product)
    assert horizon == expect_end

    counts = count_paths_by_frequency(
        market,
        product.tenure_days,
        observation_months=product.observation_months,
        product=product,
    )
    print(
        f"asof={asof} product_end={horizon} tenure={product.tenure_days} "
        f"n_paths={n} calendar_span={(horizon - asof).days}"
    )

    # Frequency is ignored — every label reports the same N, identical windows.
    for freq in ALL_FREQUENCIES:
        paths, fwd, _, h = build_paths(
            market,
            product.tenure_days,
            freq,
            observation_months=product.observation_months,
            product=product,
            attach_spots=False,
        )
        assert len(paths) == counts[freq] == n, (freq, len(paths), counts[freq], n)
        assert h == horizon
        assert all(p.start == asof for p in paths)
        assert all(p.end == paths[0].end for p in paths)
        assert all(p.path_id == i for i, p in enumerate(paths, start=1))
        assert paths[0].end == horizon or (horizon - paths[0].end).days <= 7
        print(
            f"  {freq:12} paths={len(paths):5} start={paths[0].start} end={paths[0].end}"
        )

    assert all(counts[f] == n for f in ALL_FREQUENCIES)
    # Explicit override
    paths5, _, _, _ = build_paths(
        market,
        product.tenure_days,
        "daily",
        observation_months=product.observation_months,
        product=product,
        n_paths=5,
        attach_spots=False,
    )
    assert len(paths5) == 5 and all(p.start == asof for p in paths5)
    print("PATH COUNTS OK", {"n_paths": n, "override_5": 5})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
