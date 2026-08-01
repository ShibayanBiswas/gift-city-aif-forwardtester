"""Five-pass forwardtest smoke: default 7300, GBM, MC Excel, stable Path 1."""
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
    DEFAULT_SIMULATION_END_DAYS,
    parse_product_workbook,
    resolved_simulation_end_days,
)


def main() -> None:
    assert DEFAULT_SIMULATION_END_DAYS == 7300
    p = parse_product_workbook(ROOT / "Product_Input_File.xlsx")
    assert resolved_simulation_end_days(p) == 7300, resolved_simulation_end_days(p)
    assert p.simulation_end_days == 7300

    clear_market_cache()
    m = load_market()
    gbm = estimate_gbm_params(m)
    assert str(gbm.first_date).startswith("2001"), gbm.first_date
    assert gbm.asof == m.last_date.isoformat()
    assert gbm.spot0 > 0 and gbm.std_dev > 0
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
    for i in range(5):
        result = run_forwardtest(p, frequency="monthly")
        rows = result["summary"]
        assert len(rows) >= 1
        sim_days = result.get("simulation_end_days")
        assert int(sim_days) == 7300, sim_days
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
            "sim_end",
            result.get("simulation_end"),
        )

    assert max(totals) - min(totals) < 1e-6, totals
    print("PASS 5× monthly e2e; path1 stable", round(totals[0], 6))


if __name__ == "__main__":
    main()
