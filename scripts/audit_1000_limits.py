"""Assert default 1000-path runs stay under host ceilings and share contract qty."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.engine.forwardtest import run_forwardtest
from app.engine.hedge import hedge_path
from app.engine.market import clear_market_cache, load_market
from app.engine.mc_matrix import excel_export_path_cap
from app.engine.paths import build_paths, forward_asof
from app.engine.product import (
    DEFAULT_N_PATHS,
    parse_product_workbook,
    resolved_n_paths,
    resolved_simulation_end,
)
from app.engine.runtime import is_constrained_host, max_n_paths_for_host


def main() -> int:
    clear_market_cache()
    product = parse_product_workbook(ROOT / "Product_Input_File.xlsx")
    market = load_market()
    asof = forward_asof(market)
    product_end = resolved_simulation_end(asof, product)
    n = resolved_n_paths(product)
    host_max = max_n_paths_for_host()

    assert n == DEFAULT_N_PATHS == 1000, (n, DEFAULT_N_PATHS)
    assert n <= host_max, f"default {n} exceeds host ceiling {host_max}"

    # Constrained Excel must not truncate a 1000-path desk export.
    os.environ["FORWARDTEST_CONSTRAINED"] = "1"
    is_constrained_host.cache_clear()
    paths5, _fwd, _p, _h = build_paths(
        market, int(product.tenure_days), product=product, n_paths=5, attach_spots=True
    )
    n_dates = len(paths5[0].dates)
    cap = excel_export_path_cap(n_dates=n_dates, n_paths=1000)
    assert cap is None, f"1000-path Excel must not be capped; got {cap} for {n_dates} dates"
    del os.environ["FORWARDTEST_CONSTRAINED"]
    is_constrained_host.cache_clear()

    # Shared calendar + identical contract quantities; spots diverge after S0.
    sample_n = 25
    paths, fwd, _params, horizon = build_paths(
        market,
        int(product.tenure_days),
        product=product,
        n_paths=sample_n,
        attach_spots=True,
    )
    assert horizon == product_end
    assert all(p.start == paths[0].start and p.end == paths[0].end for p in paths)
    assert all(p.dates is paths[0].dates for p in paths)
    spot0 = float(paths[0].spots[0])
    qty_keys = []
    for path in paths:
        assert abs(float(path.spots[0]) - spot0) < 1e-9
        hedge = hedge_path(fwd, product, path.dates, spots=path.spots)
        qty_keys.append(
            tuple(
                (round(lg.quantity, 8), round(lg.strike, 6), lg.expiry.isoformat())
                for lg in hedge.legs
            )
        )
    assert len(set(qty_keys)) == 1, "contract qty/strike/expiry must match across paths"
    assert abs(float(paths[0].spots[40]) - float(paths[1].spots[40])) > 0.5

    t0 = time.time()
    out = run_forwardtest(product, market=market, n_paths=1000)
    elapsed = time.time() - t0
    assert int(out["path_count"]) == 1000
    assert int(out["mc_matrix"]["n_paths"]) == 1000
    rows = out["summary"]
    assert all(r["start"] == rows[0]["start"] and r["end"] == rows[0]["end"] for r in rows)
    assert rows[0]["start"] == asof.isoformat()
    assert rows[0]["end"] == product_end.isoformat()

    print(
        "OK audit_1000_limits",
        f"asof={asof} end={product_end} n_dates={n_dates}",
        f"host_max={host_max} excel_cap_1000=none",
        f"qty_identical=yes legs={len(qty_keys[0])}",
        f"run_1000 mean_total={out['kpis']['mean_total']:.4f} elapsed_s={elapsed:.2f}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
