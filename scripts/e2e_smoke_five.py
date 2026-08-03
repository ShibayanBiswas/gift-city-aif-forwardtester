"""Five-pass forwardtest smoke: tenure Product End, GBM, MC Excel, stable Path 1."""
from __future__ import annotations

import sys
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.engine.forwardtest import run_forwardtest
from app.engine.gbm import estimate_gbm_params
from app.engine.market import clear_market_cache, load_market
from app.engine.mc_matrix import build_mc_matrix, load_mc_matrix, save_mc_matrix, write_mc_matrix_xlsx
from app.engine.product import (
    DEFAULT_N_PATHS,
    parse_product_workbook,
    path_end_calendar,
    resolved_n_paths,
    resolved_simulation_end,
    resolved_simulation_end_days,
)


def main() -> None:
    assert DEFAULT_N_PATHS == 100
    p = parse_product_workbook(ROOT / "Product_Input_File.xlsx")
    assert resolved_n_paths(p) == DEFAULT_N_PATHS
    assert resolved_simulation_end_days(p) == p.tenure_days == 1930

    clear_market_cache()
    m = load_market()
    gbm = estimate_gbm_params(m)
    assert str(gbm.first_date).startswith("2001"), gbm.first_date
    assert gbm.asof == m.last_date.isoformat()
    assert gbm.spot0 > 0 and gbm.std_dev > 0
    product_end = resolved_simulation_end(m.last_date, p)
    assert product_end == path_end_calendar(m.last_date, p.tenure_days)
    print(
        "GBM",
        gbm.first_date,
        "→",
        gbm.asof,
        "S0",
        round(gbm.spot0, 2),
        "mu%",
        round(gbm.mean_return * 100, 4),
        "sig%",
        round(gbm.std_dev * 100, 2),
        "product_end",
        product_end,
    )

    dates = [m.last_date]
    d = m.last_date
    for _ in range(9):
        d = d + timedelta(days=1)
        while d.weekday() >= 5:
            d += timedelta(days=1)
        dates.append(d)
    mat = build_mc_matrix(gbm, dates, 3)
    out = ROOT / "data" / "jobs" / "_smoke_xlsx"
    out.mkdir(parents=True, exist_ok=True)
    save_mc_matrix(out, dates=dates, matrix=mat, params=gbm, base_seed=20260101)
    loaded = load_mc_matrix(out)
    assert loaded is not None
    xlsx = write_mc_matrix_xlsx(loaded, out / "Simulated_Nifty_Paths.xlsx")
    assert xlsx.exists() and xlsx.stat().st_size > 1000
    print("xlsx ok", xlsx.stat().st_size, "bytes")

    totals: list[float] = []
    smoke_n = 5
    for i in range(5):
        result = run_forwardtest(p, frequency="monthly", n_paths=smoke_n)
        rows = result["summary"]
        assert len(rows) == smoke_n
        assert all(row["start"] == rows[0]["start"] and row["end"] == rows[0]["end"] for row in rows)
        assert result.get("product_end") == result.get("simulation_end") == product_end.isoformat()
        assert int(result.get("simulation_end_days")) == 1930
        g = result.get("gbm") or {}
        assert abs(float(g["spot0"]) - gbm.spot0) < 1e-6
        t1 = float(rows[0]["total"])
        totals.append(t1)
        mc = result.get("mc_matrix") or {}
        assert int(mc.get("n_paths", 0)) == len(rows)
        assert int(mc.get("n_dates", 0)) > 100
        print(
            f"run{i + 1}",
            "paths",
            len(rows),
            "n_dates",
            mc.get("n_dates"),
            "path1_total",
            round(t1, 4),
            "product_end",
            result.get("product_end"),
        )

    assert max(totals) - min(totals) < 1e-6, totals
    print("PASS 5× MC e2e; path1 stable", round(totals[0], 6), f"default_N={DEFAULT_N_PATHS}")


if __name__ == "__main__":
    main()
