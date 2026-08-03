#!/usr/bin/env python3
"""Product-variety tests for Forwardtester: observation count ∈ {1…7}.

Desk catalogue supports min 1 and max 7 observations. Exercises prefixes/suffixes,
alternate schedules, frequencies, and rejects 0 / 8+ observations.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.engine.forwardtest import compute_single_path_detail, run_forwardtest
from app.engine.market import clear_market_cache, load_market
from app.engine.paths import build_paths, observation_fits_market
from app.engine.product import (
    MAX_OBSERVATION_COUNT,
    MIN_OBSERVATION_COUNT,
    ProductSpec,
    normalize_observation_months,
    parse_product_workbook,
)

SAMPLE_OBS = [38.0, 41.0, 44.0, 47.0, 50.0, 53.0, 56.0]


def _clone(
    base: ProductSpec,
    *,
    obs: list[float],
    tenure: int | None = None,
    name: str = "Alt",
    n_paths: int = 3,
) -> ProductSpec:
    return ProductSpec(
        name=name,
        principal=base.principal,
        tenure_days=tenure if tenure is not None else base.tenure_days,
        observation_months=obs,
        legs=list(base.legs),
        source_file="verify_dynamic_products",
        n_paths=n_paths,
        roll_rate=base.roll_rate,
        cash_pct=base.cash_pct,
        gsec_pct=base.gsec_pct,
        cash_rate=base.cash_rate,
        gsec_rate=base.gsec_rate,
        fee_rate=base.fee_rate,
        buy_rate=base.buy_rate,
        buy_brokerage=base.buy_brokerage,
        sell_rate=base.sell_rate,
        sell_brokerage=base.sell_brokerage,
    )


def _assert_every_path(label: str, product: ProductSpec, market, *, freq: str = "semi_annual") -> dict:
    """Build forward paths, gate-check, detail-check ends, then full run_forwardtest."""
    t0 = time.time()
    paths, fwd, params, horizon = build_paths(
        market,
        product.tenure_days,
        freq,  # type: ignore[arg-type]
        observation_months=product.observation_months,
        product=product,
        n_paths=product.n_paths,
        attach_spots=False,
    )
    assert paths, f"{label}: expected ≥1 path"
    assert MIN_OBSERVATION_COUNT <= product.n_obs <= MAX_OBSERVATION_COUNT

    last_expiry = fwd.expiries[-1] if fwd.expiries else fwd.last_date
    for path in paths:
        assert observation_fits_market(path.start, product.last_observation_month, last_expiry), (
            f"{label}: path {path.path_id} start={path.start} fails obs gate"
        )

    for path in (paths[0], paths[-1]):
        detail = compute_single_path_detail(
            product,
            path,
            fwd,
            params=params,
            frequency=freq,  # type: ignore[arg-type]
        )
        assert len(detail["obs_builds"]) == product.n_obs
        assert len(detail["legs"]) == len(product.active_legs) * product.n_obs
        assert len(detail["computation_rows"]) == len(path.dates)
        assert len(detail["observations"]) == product.n_obs
        assert all(b["expiry"] for b in detail["obs_builds"])

    out = run_forwardtest(product, freq, market, n_paths=product.n_paths)  # type: ignore[arg-type]
    assert out["path_count"] == len(paths) == len(out["summary"])
    assert abs(float(out["summary"][0]["total"])) < 1e6

    elapsed = time.time() - t0
    return {
        "n_obs": product.n_obs,
        "obs": product.observation_months,
        "paths": len(paths),
        "frontier": f"{paths[-1].path_id}:{paths[-1].start}→{paths[-1].end}",
        "horizon": horizon.isoformat(),
        "mean_total": round(out["kpis"]["mean_total"], 4),
        "hit_rate": round(out["kpis"]["hit_rate_gt_100"], 4),
        "elapsed_s": round(elapsed, 2),
    }


def _reject(label: str, fn) -> str:
    try:
        fn()
    except ValueError as e:
        return str(e).split("\n")[0][:100]
    raise AssertionError(f"{label}: expected ValueError")


def main() -> None:
    clear_market_cache()
    market = load_market()
    base = parse_product_workbook(ROOT / "Product_Input_File.xlsx")
    assert base.n_obs == 7
    assert base.observation_months == SAMPLE_OBS
    assert MIN_OBSERVATION_COUNT == 1 and MAX_OBSERVATION_COUNT == 7

    checks: list[tuple[str, str]] = []

    def ok(label: str, detail: str) -> None:
        checks.append((label, detail))
        print(f"PASS  {label:28}  {detail}")

    assert normalize_observation_months([56, 38, 38, 44]) == [56.0, 38.0, 44.0]
    ok("reject_empty", _reject("empty", lambda: normalize_observation_months([])))
    ok(
        "reject_8_obs",
        _reject(
            "8obs",
            lambda: normalize_observation_months([10, 20, 30, 40, 50, 60, 70, 80]),
        ),
    )
    ok(
        "reject_product_8",
        _reject("p8", lambda: _clone(base, obs=[10, 20, 30, 40, 50, 60, 70, 80], name="8")),
    )

    print("\n── Observation count matrix (prefix of 38…56) ──")
    for n in range(MIN_OBSERVATION_COUNT, MAX_OBSERVATION_COUNT + 1):
        obs = SAMPLE_OBS[:n]
        info = _assert_every_path(f"prefix_{n}", _clone(base, obs=obs, name=f"prefix{n}"), market)
        ok(f"n_obs={n}_prefix", str(info))

    print("\n── Late schedules (suffix of 38…56) ──")
    for n in range(MIN_OBSERVATION_COUNT, MAX_OBSERVATION_COUNT + 1):
        obs = SAMPLE_OBS[-n:]
        info = _assert_every_path(f"suffix_{n}", _clone(base, obs=obs, name=f"suffix{n}"), market)
        ok(f"n_obs={n}_suffix", str(info))

    early = _assert_every_path("early3", _clone(base, obs=[12, 24, 36], name="early3"), market)
    late = _assert_every_path("late3", _clone(base, obs=[38, 47, 56], name="late3"), market)
    assert early["paths"] == late["paths"], (early["paths"], late["paths"])
    ok("early_vs_late_same_n", f"early_paths={early['paths']} late_paths={late['paths']}")

    deduped = _clone(base, obs=[56, 38, 38, 44, 50], name="dedupe")
    assert deduped.n_obs == 4
    assert deduped.observation_months == [56.0, 38.0, 44.0, 50.0]
    ok("unsorted_dedupe_4", str(_assert_every_path("dedupe", deduped, market)))

    ok(
        "short_tenure_3obs",
        str(
            _assert_every_path(
                "3y",
                _clone(base, obs=[12, 24, 30], tenure=1095, name="3y"),
                market,
            )
        ),
    )

    ok(
        "quarterly_5obs",
        str(
            _assert_every_path(
                "quarterly",
                _clone(base, obs=SAMPLE_OBS[:5], name="quarterly"),
                market,
                freq="quarterly",
            )
        ),
    )
    ok(
        "semi_annual_2obs",
        str(
            _assert_every_path(
                "semi",
                _clone(base, obs=[36, 48], name="semi"),
                market,
                freq="semi_annual",
            )
        ),
    )

    one_leg = next(lg for lg in base.legs if lg.include and lg.quantity != 0)
    for n, obs in ((1, [48.0]), (7, SAMPLE_OBS)):
        p = ProductSpec(
            name=f"1leg_{n}",
            principal=base.principal,
            tenure_days=base.tenure_days,
            observation_months=obs,
            legs=[one_leg],
            source_file="verify_dynamic_products",
            n_paths=3,
        )
        assert len(p.active_legs) == 1
        info = _assert_every_path(f"1leg_{n}", p, market)
        paths, fwd, params, _ = build_paths(
            market,
            p.tenure_days,
            "semi_annual",
            observation_months=p.observation_months,
            product=p,
            n_paths=3,
            attach_spots=False,
        )
        detail = compute_single_path_detail(
            p, paths[0], fwd, params=params, frequency="semi_annual"
        )
        assert len(detail["legs"]) == n
        ok(f"one_leg_n_obs={n}", str(info))

    # Baseline book: Path 1 stable across two MC runs (small N)
    r1 = run_forwardtest(base, "monthly", market, n_paths=5)
    r2 = run_forwardtest(base, "monthly", market, n_paths=5)
    assert r1["path_count"] == r2["path_count"] == 5
    t1 = float(r1["summary"][0]["total"])
    t2 = float(r2["summary"][0]["total"])
    assert abs(t1 - t2) < 1e-9
    ok("mc_path1_stable", f"paths={r1['path_count']} path1={t1:.6f}")

    custom = _clone(base, obs=[18.0, 30.0, 42.0, 54.0], tenure=1461, name="custom4y")
    assert custom.n_obs == 4 and custom.tenure_days == 1461
    ok("custom_tenure_4obs", str(_assert_every_path("custom4y", custom, market)))

    print(
        f"\nOK — {len(checks)} checks passed "
        f"(observation count band {MIN_OBSERVATION_COUNT}…{MAX_OBSERVATION_COUNT})"
    )


if __name__ == "__main__":
    main()
