#!/usr/bin/env python3
"""Thorough product-variety tests: observation count ∈ {1…7}.

Desk catalogue supports min 1 and max 7 observations (any float month offsets).
This script exercises every count, alternate month schedules, tenures, frequencies,
full-path forward tests, and rejects 0 / 8+ observations.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.engine.forwardtest import _evaluate_path, run_forwardtest
from app.engine.market import clear_market_cache, load_market
from app.engine.paths import build_paths, observation_fits_market
from app.engine.product import (
    MAX_OBSERVATION_COUNT,
    MIN_OBSERVATION_COUNT,
    ProductSpec,
    normalize_observation_months,
    parse_product_workbook,
)

# WF1 sample schedule — take prefixes / suffixes for 1…7 variety.
SAMPLE_OBS = [38.0, 41.0, 44.0, 47.0, 50.0, 53.0, 56.0]
PATH1_GOLD = 180.78505147144745
PATH10_GOLD = 216.47711650487614


def _clone(
    base: ProductSpec,
    *,
    obs: list[float],
    tenure: int | None = None,
    name: str = "Alt",
) -> ProductSpec:
    return ProductSpec(
        name=name,
        principal=base.principal,
        tenure_days=tenure if tenure is not None else base.tenure_days,
        observation_months=obs,
        legs=list(base.legs),
        source_file="verify_dynamic_products",
    )


def _assert_every_path(label: str, product: ProductSpec, market, *, freq: str = "monthly") -> dict:
    """Build paths, gate-check all, evaluate every path (store off), then full run_forwardtest."""
    t0 = time.time()
    paths = build_paths(
        market,
        product.tenure_days,
        freq,  # type: ignore[arg-type]
        observation_months=product.observation_months,
    )
    assert paths, f"{label}: expected ≥1 path"
    assert MIN_OBSERVATION_COUNT <= product.n_obs <= MAX_OBSERVATION_COUNT

    last_expiry = market.expiries[-1]
    for path in paths:
        assert observation_fits_market(path.start, product.last_observation_month, last_expiry), (
            f"{label}: path {path.path_id} start={path.start} fails obs gate"
        )

    # Evaluate *every* path — catches late-pin missing-expiry bugs.
    totals: list[float] = []
    for path in paths:
        summary, _ = _evaluate_path(path, product, market, store=False)
        assert abs(summary.total) < 1e6, (label, path.path_id, summary.total)
        totals.append(summary.total)

    # Spot-check detail shape on first + frontier
    for path in (paths[0], paths[-1]):
        summary, detail = _evaluate_path(path, product, market, store=True)
        assert detail is not None
        assert len(detail["obs_builds"]) == product.n_obs
        assert len(detail["legs"]) == len(product.active_legs) * product.n_obs
        assert len(detail["computation_rows"]) == len(path.dates)
        assert len(detail["observations"]) == product.n_obs
        # Near vol on obs index 0; remaining use far — legs exist per obs
        assert all(b["expiry"] for b in detail["obs_builds"])

    out = run_forwardtest(product, freq, market)  # type: ignore[arg-type]
    assert out["path_count"] == len(paths) == len(out["summary"])
    assert abs(out["kpis"]["mean_total"] - (sum(totals) / len(totals))) < 1e-6

    elapsed = time.time() - t0
    return {
        "n_obs": product.n_obs,
        "obs": product.observation_months,
        "paths": len(paths),
        "frontier": f"{paths[-1].path_id}:{paths[-1].start}→{paths[-1].end}",
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

    # ── helpers / bounds ──────────────────────────────────────────────
    assert normalize_observation_months([56, 38, 38, 44]) == [56.0, 38.0, 44.0]
    ok(
        "reject_empty",
        _reject("empty", lambda: normalize_observation_months([])),
    )
    ok(
        "reject_8_obs",
        _reject(
            "8obs",
            lambda: normalize_observation_months([10, 20, 30, 40, 50, 60, 70, 80]),
        ),
    )
    ok(
        "reject_product_8",
        _reject(
            "p8",
            lambda: _clone(base, obs=[10, 20, 30, 40, 50, 60, 70, 80], name="8"),
        ),
    )

    # ── full matrix: n_obs = 1…7 (WF1 prefix schedules) ───────────────
    print("\n── Observation count matrix (prefix of 38…56) ──")
    for n in range(MIN_OBSERVATION_COUNT, MAX_OBSERVATION_COUNT + 1):
        obs = SAMPLE_OBS[:n]
        info = _assert_every_path(f"prefix_{n}", _clone(base, obs=obs, name=f"prefix{n}"), market)
        ok(f"n_obs={n}_prefix", str(info))

    # ── same counts, late-ending schedules (suffix of sample) ─────────
    print("\n── Late schedules (suffix of 38…56) ──")
    for n in range(MIN_OBSERVATION_COUNT, MAX_OBSERVATION_COUNT + 1):
        obs = SAMPLE_OBS[-n:]
        info = _assert_every_path(f"suffix_{n}", _clone(base, obs=obs, name=f"suffix{n}"), market)
        ok(f"n_obs={n}_suffix", str(info))

    # ── early-ending 3-obs vs late-ending 3-obs (path count must differ) ─
    early = _assert_every_path("early3", _clone(base, obs=[12, 24, 36], name="early3"), market)
    late = _assert_every_path("late3", _clone(base, obs=[38, 47, 56], name="late3"), market)
    assert early["paths"] >= late["paths"], (early["paths"], late["paths"])
    ok("early_vs_late_3obs", f"early_paths={early['paths']} late_paths={late['paths']}")

    # ── unsorted + dupes within 1…7 ───────────────────────────────────
    deduped = _clone(base, obs=[56, 38, 38, 44, 50], name="dedupe")
    assert deduped.n_obs == 4
    assert deduped.observation_months == [56.0, 38.0, 44.0, 50.0]
    ok("unsorted_dedupe_4", str(_assert_every_path("dedupe", deduped, market)))

    # ── short tenure + 3 obs (no Excel pins) ──────────────────────────
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

    # ── weekly / quarterly with mid counts ────────────────────────────
    ok(
        "weekly_5obs",
        str(
            _assert_every_path(
                "weekly",
                _clone(base, obs=SAMPLE_OBS[:5], name="weekly"),
                market,
                freq="weekly",
            )
        ),
    )
    ok(
        "quarterly_2obs",
        str(
            _assert_every_path(
                "quarterly",
                _clone(base, obs=[36, 48], name="q"),
                market,
                freq="quarterly",
            )
        ),
    )

    # ── one active leg × each n_obs 1 and 7 ───────────────────────────
    one_leg = next(lg for lg in base.legs if lg.include and lg.quantity != 0)
    for n, obs in ((1, [48.0]), (7, SAMPLE_OBS)):
        p = ProductSpec(
            name=f"1leg_{n}",
            principal=base.principal,
            tenure_days=base.tenure_days,
            observation_months=obs,
            legs=[one_leg],
            source_file="verify_dynamic_products",
        )
        assert len(p.active_legs) == 1
        info = _assert_every_path(f"1leg_{n}", p, market)
        # Detail leg count = 1 × n_obs
        paths = build_paths(market, p.tenure_days, "monthly", observation_months=p.observation_months)
        _, detail = _evaluate_path(paths[0], p, market, store=True)
        assert len(detail["legs"]) == n
        ok(f"one_leg_n_obs={n}", str(info))

    # ── gold pins on live 7-obs book ──────────────────────────────────
    paths = build_paths(market, base.tenure_days, "monthly", observation_months=base.observation_months)
    assert len(paths) >= 235, len(paths)
    s1, _ = _evaluate_path(paths[0], base, market, store=False)
    s10, _ = _evaluate_path(next(p for p in paths if p.path_id == 10), base, market, store=False)
    assert abs(s1.total - PATH1_GOLD) < 1e-4, s1.total
    assert abs(s10.total - PATH10_GOLD) < 1e-4, s10.total
    assert paths[-1].end == market.last_date
    ok(
        "gold_path1_path10",
        f"P1={s1.total:.10f} P10={s10.total:.10f} monthly={len(paths)} frontier→{paths[-1].end}",
    )

    # ── custom tenure outside 1700–2000 + non-sample obs months ───────
    custom = _clone(base, obs=[18.0, 30.0, 42.0, 54.0], tenure=1461, name="custom4y")
    assert custom.n_obs == 4 and custom.tenure_days == 1461
    ok("custom_tenure_4obs", str(_assert_every_path("custom4y", custom, market)))

    print(f"\nOK — {len(checks)} checks passed (observation count band {MIN_OBSERVATION_COUNT}…{MAX_OBSERVATION_COUNT})")


if __name__ == "__main__":
    main()
