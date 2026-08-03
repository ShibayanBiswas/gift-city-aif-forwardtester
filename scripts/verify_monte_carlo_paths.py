"""Edge-case checks for Monte Carlo path count + single-window engine smoke."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.engine.forwardtest import run_forwardtest
from app.engine.market import clear_market_cache, load_market
from app.engine.paths import build_paths
from app.engine.product import (
    DEFAULT_N_PATHS,
    MAX_N_PATHS,
    MIN_N_PATHS,
    parse_product_workbook,
    resolved_n_paths,
)
from app.engine.runtime import is_constrained_host, max_n_paths_for_host


def main() -> int:
    assert DEFAULT_N_PATHS == 1000
    assert MIN_N_PATHS == 1
    assert MAX_N_PATHS == 10000
    assert resolved_n_paths(explicit=0) == 1
    assert resolved_n_paths(explicit=-5) == 1
    assert resolved_n_paths(explicit=10001) == min(10000, max_n_paths_for_host())
    assert resolved_n_paths(explicit=250) == 250
    assert resolved_n_paths(explicit=None) == 1000

    # Host-aware ceiling (local fat box keeps 10000; constrained → 2000).
    host_max = max_n_paths_for_host()
    assert resolved_n_paths(explicit=99999) == min(MAX_N_PATHS, host_max)

    os.environ["FORWARDTEST_CONSTRAINED"] = "1"
    is_constrained_host.cache_clear()
    assert max_n_paths_for_host() == 2000
    assert resolved_n_paths(explicit=10000) == 2000
    del os.environ["FORWARDTEST_CONSTRAINED"]
    is_constrained_host.cache_clear()

    clear_market_cache()
    product = parse_product_workbook(ROOT / "Product_Input_File.xlsx")
    assert resolved_n_paths(product) == 1000

    market = load_market()
    paths, _fwd, _params, horizon = build_paths(
        market,
        int(product.tenure_days),
        product=product,
        n_paths=5,
        attach_spots=False,
    )
    assert len(paths) == 5
    # Shared date list — all PathSpecs must reference the same object.
    assert all(p.dates is paths[0].dates for p in paths)

    result = run_forwardtest(product, market=market, n_paths=3)
    rows = result["summary"]
    assert len(rows) == 3 == result["n_paths"] == result["path_count"]
    assert result["frequency"] == "monte_carlo"
    assert all(r["start"] == rows[0]["start"] and r["end"] == rows[0]["end"] for r in rows)
    assert result["product_end"] == result["simulation_end"] == rows[0]["end"] == horizon.isoformat()
    print(
        "OK monte_carlo_paths",
        f"default={DEFAULT_N_PATHS} max={MAX_N_PATHS} host_max={max_n_paths_for_host()}",
        f"asof={rows[0]['start']} end={rows[0]['end']} n=3 shared_dates=yes",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
