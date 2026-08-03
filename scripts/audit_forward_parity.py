"""Thorough Forwardtester logic audit vs Excel Monte Carlo + Backtester rules."""
from __future__ import annotations

import json
import sys
from calendar import monthrange
from datetime import date, timedelta
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.engine.black_scholes import _bs_price, central_delta  # noqa: E402
from app.engine.forward_calendar import (  # noqa: E402
    _last_tuesday_of_month_calendar,
    _snap_to_prior_session,
)
from app.engine.forwardtest import compute_single_path_detail, run_forwardtest  # noqa: E402
from app.engine.gbm import GBM_BASE_SEED, estimate_gbm_params, gbm_spots  # noqa: E402
from app.engine.market import load_market, path_roll_vector  # noqa: E402
from app.engine.mc_matrix import (  # noqa: E402
    build_mc_matrix,
    horizon_trading_dates,
    slice_path_spots,
)
from app.engine.paths import build_paths  # noqa: E402
from app.engine.product import (  # noqa: E402
    parse_product_workbook,
    resolved_simulation_end_days,
)
from app.engine.runtime import forwardtest_parallelism  # noqa: E402

results: list[dict] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    results.append({"name": name, "ok": bool(cond), "detail": detail})
    print(("PASS" if cond else "FAIL"), name, detail)


def main() -> int:
    m = load_market()
    p = estimate_gbm_params(m)
    closes = np.asarray(m.closes, dtype=float)
    rets = closes[1:] / closes[:-1] - 1.0
    mu = float(np.mean(rets))
    sig = float(np.std(rets, ddof=1))
    drift = mu - 0.5 * sig * sig

    check(
        "excel_raw_mu_sigma_drift",
        abs(mu - p.mean_return) < 1e-15
        and abs(sig - p.std_dev) < 1e-15
        and abs(drift - p.drift) < 1e-15,
        f"mu={mu * 100:.4f}% sig={sig * 100:.2f}% drift={drift:.6f}",
    )
    check(
        "excel_s0_asof",
        abs(p.spot0 - float(closes[-1])) < 1e-9 and p.asof == m.last_date.isoformat(),
        f"S0={p.spot0:.2f} asof={p.asof}",
    )

    # Excel day-1: S0*EXP(drift+sig*Z); multi-step cumsum
    s = gbm_spots(p.spot0, 5, p.drift, p.std_dev, path_id=7)
    rng = np.random.default_rng(GBM_BASE_SEED + 7 * 1_000_003)
    z = rng.standard_normal(4)
    manual = np.empty(5)
    manual[0] = p.spot0
    manual[1:] = p.spot0 * np.exp(np.cumsum(p.drift + p.std_dev * z))
    check("excel_gbm_multistep", np.allclose(s, manual), f"day1={s[1]:.4f}")

    prod = parse_product_workbook(ROOT / "Product_Input_File.xlsx", name="Sample")
    check("product_tenure_1930", prod.tenure_days == 1930, str(prod.tenure_days))
    check(
        "product_sim_days_tenure",
        resolved_simulation_end_days(prod) == prod.tenure_days == 1930,
        str(resolved_simulation_end_days(prod)),
    )
    check("product_legs_6", len(prod.active_legs) == 6, str(len(prod.active_legs)))

    paths, fwd, params, horizon = build_paths(
        m,
        prod.tenure_days,
        "semi_annual",
        observation_months=prod.observation_months,
        product=prod,
        n_paths=5,
        attach_spots=False,
    )
    n_paths = len(paths)
    asof = date.fromisoformat(params.asof)
    hdates = horizon_trading_dates(fwd.dates, asof, horizon)
    mat = build_mc_matrix(params, hdates, max(x.path_id for x in paths))

    check("mc_matrix_shape", mat.shape == (n_paths, len(hdates)), str(mat.shape))
    check("mc_col0_is_s0", abs(float(mat[0, 0]) - params.spot0) < 1e-6, "")
    check(
        "mc_same_date_diff_paths",
        abs(float(mat[0, 50]) - float(mat[1, 50])) > 1e-6,
        f"{mat[0, 50]:.2f} vs {mat[1, 50]:.2f}",
    )
    check("calendar_no_weekends", all(d.weekday() < 5 for d in hdates), f"n={len(hdates)}")

    for path in paths[:4]:
        sliced = slice_path_spots(mat, hdates, path.dates, path.path_id)
        full = gbm_spots(
            params.spot0, len(hdates), params.drift, params.std_dev, path_id=path.path_id
        )
        idx = {d: i for i, d in enumerate(hdates)}
        expect = np.array([full[idx[d]] for d in path.dates])
        assert np.allclose(sliced, expect)
    check("slice_parity_horizon_row", True, "4 paths")

    ml = [e for e in sorted(fwd.monthly_last_expiries) if asof <= e <= horizon]
    check("monthly_last_tuesday_count", len(ml) >= 40, f"n={len(ml)}")
    trading = set(fwd.dates)
    snap_ok = True
    for y in range(asof.year, min(asof.year + 2, horizon.year + 1)):
        for mo in range(1, 13):
            me = date(y, mo, monthrange(y, mo)[1])
            # Forward expiries are emitted for complete months after as-of only.
            if date(y, mo, 1) <= asof or me > horizon:
                continue
            tue = _last_tuesday_of_month_calendar(me)
            snap = _snap_to_prior_session(tue, trading)
            if snap is None:
                continue
            if snap not in fwd.monthly_last_expiries and tue not in fwd.monthly_last_expiries:
                snap_ok = False
    check("monthly_expiry_snap_present", snap_ok and len(ml) > 0, f"first={ml[0] if ml else None}")

    # First in-path roll must use calendar Δt from prior global shift (not seed N)
    p1 = paths[0]
    spots1 = slice_path_spots(mat, hdates, p1.dates, p1.path_id)
    _, by1 = path_roll_vector(p1.dates, spots1, fwd.roll_shifts)
    first_shift = min(by1)
    prior = max((d for d in fwd.roll_shifts if d < first_shift), default=None)
    check("first_roll_has_prior_global", prior is not None, f"first={first_shift} prior={prior}")
    if prior is not None:
        mask = np.array([(d > prior and d <= first_shift) for d in p1.dates])
        avg = float(np.asarray(spots1)[mask].mean()) if mask.any() else 0.0
        expect = avg * 0.07 * (first_shift - prior).days / 365.0
        check(
            "first_inpath_roll_calendar_dt",
            abs(by1[first_shift] - expect) < 1e-6,
            f"got={by1[first_shift]:.4f} expect={expect:.4f} dt={(first_shift - prior).days}",
        )

    p2 = paths[1]
    spots2 = slice_path_spots(mat, hdates, p2.dates, p2.path_id)
    _, by2 = path_roll_vector(p2.dates, spots2, fwd.roll_shifts)
    shared = sorted(set(by1) & set(by2))
    check(
        "rolls_differ_across_paths",
        any(abs(by1[d] - by2[d]) > 1e-6 for d in shared[:30]),
        f"shared={len(shared)}",
    )

    mode, workers = forwardtest_parallelism(1)
    check("runtime_one_path_serial", mode == "serial" and workers == 1, f"{mode}/{workers}")
    mode12, w12 = forwardtest_parallelism(12)
    check("runtime_workers_le_paths", w12 <= 12, f"{mode12}/{w12}")

    px = float(_bs_price(25000.0, 25000.0 * 0.95, 0.06, 0.05, 1.0, 0.15, "P"))
    dlt = float(central_delta(25000.0, 25000.0 * 0.95, 0.06, 0.05, 1.0, 0.15, "P"))
    check("bs_put_positive", px > 0 and dlt < 0, f"px={px:.4f} delta={dlt:.4f}")

    check("final_path_near_horizon", all((horizon - p.end).days <= 7 for p in paths), str(paths[0].end))
    check(
        "all_paths_same_window",
        all(p.start == paths[0].start and p.end == paths[0].end for p in paths),
        f"start={paths[0].start} end={paths[0].end}",
    )

    r = run_forwardtest(prod, "semi_annual", n_paths=5)
    check(
        "run_mc_meta",
        r["path_count"] == n_paths and r["mc_matrix"]["n_paths"] == n_paths,
        f"paths={r['path_count']} mean_total={r['kpis']['mean_total']:.4f} dates={r['mc_matrix']['n_dates']}",
    )
    check(
        "run_product_end",
        r.get("product_end") == r.get("simulation_end") == horizon.isoformat(),
        str(r.get("product_end")),
    )

    detail = compute_single_path_detail(
        prod,
        paths[0],
        fwd,
        params=params,
        frequency="semi_annual",
        horizon_dates=hdates,
    )
    check("detail_rolls_expiries", len(detail["rolls"]) > 0 and len(detail["monthly_expiries"]) > 0, "")

    fails = [x for x in results if not x["ok"]]
    print(f"==== {len(results) - len(fails)} pass / {len(fails)} fail ====")
    print(json.dumps({"fails": fails, "n": len(results)}, indent=2))
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
