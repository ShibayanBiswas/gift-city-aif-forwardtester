"""Forward Monte Carlo path windows — as-of → product tenure end.

Every path shares the same calendar window (Path 1 start = live as-of,
end = tenure calendar end). Path identity is the GBM seed (path_id 1…N).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Literal

import numpy as np

from .forward_calendar import extend_market_forward
from .gbm import (
    GBM_BASE_SEED,
    GbmParams,
    estimate_gbm_params,
    gbm_spots,
)
from .market import MarketDB
from .mc_matrix import spots_aligned_to_horizon
from .product import (
    ProductSpec,
    path_end_calendar,
    resolved_n_paths,
    resolved_simulation_end,
)

# Kept for API / script compatibility — frequency no longer selects starts.
Frequency = Literal["monthly", "weekly", "daily", "quarterly", "semi_annual"]

ALL_FREQUENCIES: tuple[Frequency, ...] = (
    "daily",
    "weekly",
    "monthly",
    "quarterly",
    "semi_annual",
)


@dataclass
class PathSpec:
    path_id: int
    start: date
    end: date
    dates: list[date]
    spots: np.ndarray | None = field(default=None, repr=False)


def path_start_for_end(target_end: date, tenure_days: int) -> date:
    """Invert path_end_calendar so the tenure window ends on target_end."""
    if tenure_days is not None and not (1700 <= tenure_days <= 2000):
        return target_end - timedelta(days=tenure_days)
    first_next = date(target_end.year, target_end.month, 1) + timedelta(days=32)
    first_next = first_next.replace(day=1)
    try:
        return first_next.replace(year=first_next.year - 5)
    except ValueError:
        return first_next.replace(year=first_next.year - 5, month=2, day=28)


def last_observation_target(start: date, observation_month: float) -> date:
    return start + timedelta(days=float(observation_month) * 30.5)


def observation_fits_market(
    start: date,
    last_observation_month: float | None,
    last_expiry: date,
) -> bool:
    """True when the last observation target is on/before the last known monthly expiry."""
    if last_observation_month is None:
        return True
    return last_observation_target(start, last_observation_month) <= last_expiry


def forward_asof(market: MarketDB) -> date:
    """Path start = latest Nifty session (dynamic present date)."""
    return market.last_date


def _build_tenure_window(
    market: MarketDB,
    pid: int,
    start: date,
    end_cal: date,
) -> PathSpec | None:
    """Single as-of → product-end trading-day window for ``pid``."""
    if end_cal > market.last_date:
        return None
    days = market.trading_days_between(start, end_cal)
    if not days:
        return None
    if days[-1] < end_cal - timedelta(days=14):
        return None
    return PathSpec(path_id=pid, start=days[0], end=days[-1], dates=days)


def simulate_path_spots(
    dates: list[date],
    params: GbmParams,
    path_id: int,
    *,
    base_seed: int = GBM_BASE_SEED,
    frequency: Frequency = "daily",
    horizon_dates: list[date] | None = None,
) -> np.ndarray:
    """GBM spots for ``dates``.

    When ``horizon_dates`` is provided (as-of → product end), generate the full
    Monte Carlo row for ``path_id`` then slice — same calendar date shares one price
    with the MC matrix (Excel Nifty Simulations layout).
    """
    del frequency  # sessions stay daily GBM steps
    if not dates:
        return np.zeros(0, dtype=float)
    if horizon_dates:
        return spots_aligned_to_horizon(
            dates, params, path_id, horizon_dates, base_seed=base_seed
        )
    return gbm_spots(
        params.spot0,
        len(dates),
        params.drift,
        params.std_dev,
        path_id=path_id,
        base_seed=base_seed,
    )


def build_forward_market(
    market: MarketDB,
    horizon_end: date,
    tenure_days: int,
    *,
    observation_months: list[float] | None = None,
    fill_gbm: bool = True,
    base_seed: int = GBM_BASE_SEED,
) -> tuple[MarketDB, GbmParams]:
    """Extend market through product tenure end with forward calendars.

    When ``fill_gbm`` is True, Path-1 GBM closes fill the pad (legacy / debug).
    Production desk meta and path evaluation use ``fill_gbm=False``: calendars
    only. Each path carries its own GBM spots and path-local roll points.
    """
    asof = market.last_date
    pad_end = max(horizon_end, path_end_calendar(asof, tenure_days)) + timedelta(days=60)
    if observation_months:
        obs_m = max(float(m) for m in observation_months)
        pad_end = max(pad_end, last_observation_target(asof, obs_m) + timedelta(days=60))
    params = estimate_gbm_params(market)
    fwd = extend_market_forward(
        market,
        pad_end,
        gbm_params=params if fill_gbm else None,
        base_seed=base_seed,
        path_id=1,
    )
    return fwd, params


def build_paths(
    market: MarketDB,
    tenure_days: int,
    frequency: Frequency = "daily",
    *,
    observation_months: list[float] | None = None,
    product: ProductSpec | None = None,
    simulation_end: date | None = None,
    n_paths: int | None = None,
    base_seed: int = GBM_BASE_SEED,
    attach_spots: bool = True,
) -> tuple[list[PathSpec], MarketDB, GbmParams, date]:
    """
    Build N Monte Carlo paths over one window: as-of → product tenure end.

    ``frequency`` is accepted for API compatibility but ignored — every path
    starts on as-of and ends on the product tenure calendar end.
    Returns (paths, forward_market, gbm_params, product_end).
    """
    del frequency
    asof = forward_asof(market)
    horizon = simulation_end or resolved_simulation_end(asof, product)
    if horizon <= asof:
        raise RuntimeError(
            f"Product end {horizon.isoformat()} must be after as-of {asof.isoformat()}"
        )

    count = resolved_n_paths(product, explicit=n_paths)

    fwd_market, params = build_forward_market(
        market,
        horizon,
        tenure_days,
        observation_months=observation_months,
        fill_gbm=False,
        base_seed=base_seed,
    )

    need = horizon + timedelta(days=60)
    if observation_months:
        obs_m = max(float(m) for m in observation_months)
        need = max(need, last_observation_target(asof, obs_m) + timedelta(days=60))
    if need > fwd_market.last_date:
        fwd_market = extend_market_forward(
            fwd_market,
            need,
            gbm_params=None,
            base_seed=base_seed,
            path_id=1,
        )

    # Full MC axis: as-of → product tenure end (Excel columns = these dates).
    horizon_dates = fwd_market.trading_days_between(asof, horizon)
    if not horizon_dates and asof in fwd_market.date_to_idx:
        horizon_dates = [asof]

    template = _build_tenure_window(fwd_market, 1, asof, horizon)
    if template is None:
        if horizon > fwd_market.last_date:
            fwd_market = extend_market_forward(
                fwd_market,
                horizon + timedelta(days=60),
                gbm_params=None,
                base_seed=base_seed,
                path_id=1,
            )
            horizon_dates = fwd_market.trading_days_between(asof, horizon)
            template = _build_tenure_window(fwd_market, 1, asof, horizon)
    if template is None:
        raise RuntimeError(
            "No complete forward tenure window for "
            f"as-of={asof.isoformat()}, product_end={horizon.isoformat()}, "
            f"tenure_days={tenure_days}"
        )

    paths: list[PathSpec] = []
    # Share one date list across all PathSpecs — dates are never mutated (only spots
    # are attached/cleared). Copying N times wasted ~11–110 MB on free hosts.
    shared_dates = template.dates
    for pid in range(1, count + 1):
        spec = PathSpec(
            path_id=pid,
            start=template.start,
            end=template.end,
            dates=shared_dates,
        )
        if attach_spots:
            spec.spots = simulate_path_spots(
                spec.dates,
                params,
                pid,
                base_seed=base_seed,
                horizon_dates=horizon_dates,
            )
        paths.append(spec)

    return paths, fwd_market, params, horizon


def count_monte_carlo_paths(
    product: ProductSpec | None = None,
    *,
    n_paths: int | None = None,
) -> int:
    """Resolved Monte Carlo path count for the single tenure window."""
    return resolved_n_paths(product, explicit=n_paths)


def count_paths_by_frequency(
    market: MarketDB,
    tenure_days: int,
    *,
    observation_months: list[float] | None = None,
    product: ProductSpec | None = None,
    simulation_end: date | None = None,
    frequencies: tuple[Frequency, ...] = ALL_FREQUENCIES,
    n_paths: int | None = None,
) -> dict[str, int]:
    """Compat shim — every frequency reports the same MC path count."""
    del market, tenure_days, observation_months, simulation_end
    n = resolved_n_paths(product, explicit=n_paths)
    return {freq: n for freq in frequencies}


def path_from_window(
    market: MarketDB,
    path_id: int,
    start: date | str,
    end: date | str,
    *,
    dates: list[date] | None = None,
    params: GbmParams | None = None,
    frequency: Frequency = "daily",
    base_seed: int = GBM_BASE_SEED,
    horizon_dates: list[date] | None = None,
) -> PathSpec | None:
    """Rebuild one path from summary start/end (GBM from path_id seed)."""
    start_d = date.fromisoformat(start) if isinstance(start, str) else start
    end_d = date.fromisoformat(end) if isinstance(end, str) else end
    if dates is None:
        dates = market.trading_days_between(start_d, end_d)
    if not dates:
        return None
    spots = None
    if params is not None:
        spots = simulate_path_spots(
            dates,
            params,
            path_id,
            base_seed=base_seed,
            frequency=frequency,
            horizon_dates=horizon_dates,
        )
    return PathSpec(path_id=path_id, start=dates[0], end=dates[-1], dates=dates, spots=spots)
