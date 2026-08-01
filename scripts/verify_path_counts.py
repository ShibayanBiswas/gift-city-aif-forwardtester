"""Verify forward path counts for every desk frequency.

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
    count_paths_by_frequency,
    enumerate_path_starts,
    forward_asof,
)
from app.engine.product import parse_product_workbook, resolved_simulation_end


def main() -> int:
    clear_market_cache()
    market = load_market()
    product = parse_product_workbook(ROOT / "Product_Input_File.xlsx")
    asof = forward_asof(market)
    horizon = resolved_simulation_end(asof, product)

    counts = count_paths_by_frequency(
        market,
        product.tenure_days,
        observation_months=product.observation_months,
        product=product,
    )
    print(
        f"asof={asof} horizon={horizon} tenure={product.tenure_days} "
        f"sim_days={(horizon - asof).days}"
    )

    for freq in ALL_FREQUENCIES:
        paths, fwd, _, h = build_paths(
            market,
            product.tenure_days,
            freq,
            observation_months=product.observation_months,
            product=product,
            attach_spots=False,
        )
        starts = enumerate_path_starts(
            fwd,
            asof,
            h,
            product.tenure_days,
            freq,
            observation_months=product.observation_months,
        )
        n = len(paths)
        assert n == counts[freq] == len(starts), (freq, n, counts[freq], len(starts))
        assert paths[0].start == asof and paths[0].path_id == 1
        assert [p.start for p in paths] == starts
        assert (h - paths[-1].end).days <= 7
        assert all(p.path_id == i for i, p in enumerate(paths, start=1))
        print(f"  {freq:12} paths={n:5} first={paths[0].start} last_start={paths[-1].start}")

    assert counts["daily"] > counts["weekly"] > counts["monthly"]
    assert counts["monthly"] > counts["quarterly"] > counts["semi_annual"]
    print("PATH COUNTS OK", counts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
