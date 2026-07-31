"""Forward path windows — staggered tenure starts ending at Simulation End.

Path 1: as-of → path_end(tenure)
…
Final path: S_last → Simulation End, where Simulation End = as-of + Simulation End Days
and path_end_calendar(S_last, tenure) = Simulation End.
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
from .product import ProductSpec, resolved_simulation_end

Frequency = Literal["monthly", "weekly", "daily", "quarterly", "semi_annual"]


@dataclass
class PathSpec:
    path_id: int
    start: date
    end: date
    dates: list[date]
    spots: np.ndarray | None = field(default=None, repr=False)


def _add_years(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:
        return d.replace(year=d.year + years, month=2, day=28)


def path_end_calendar(start: date, tenure_days: int | None = None) -> date:
    """Excel / backtester tenure end rule (verbatim)."""
    if tenure_days is not None and not (1700 <= tenure_days <= 2000):
        return start + timedelta(days=tenure_days)
    anniversary = _add_years(start, 5)
    return anniversary.replace(day=1) - timedelta(days=1)


def path_start_for_end(target_end: date, tenure_days: int) -> date:
    """Invert path_end_calendar so the tenure window ends on target_end."""
    if tenure_days is not None and not (1700 <= tenure_days <= 2000):
        return target_end - timedelta(days=tenure_days)
    # Anniversary rule: end = (start + 5Y).replace(day=1) - 1 day
    # ⇒ first of month after end = start + 5Y ⇒ start ≈ first_of_next_month(end) - 5Y
    first_next = date(target_end.year, target_end.month, 1) + timedelta(days=32)
    first_next = first_next.replace(day=1)
    return _add_years(first_next, -5)


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


def _month_starts(dates: list[date]) -> list[date]:
    out: list[date] = []
    prev = None
    for d in dates:
        key = (d.year, d.month)
        if key != prev:
            out.append(d)
            prev = key
    return out


def _week_starts(dates: list[date]) -> list[date]:
    out: list[date] = []
    prev = None
    for d in dates:
        iso = d.isocalendar()[:2]
        if iso != prev:
            out.append(d)
            prev = iso
    return out


def _quarter_starts(dates: list[date]) -> list[date]:
    out: list[date] = []
    prev = None
    for d in dates:
        q = (d.year, (d.month - 1) // 3)
        if q != prev:
            out.append(d)
            prev = q
    return out


def _semi_annual_starts(dates: list[date]) -> list[date]:
    out: list[date] = []
    prev = None
    for d in dates:
        half = (d.year, 0 if d.month <= 6 else 1)
        if half != prev:
            out.append(d)
            prev = half
    return out


def generate_path_starts(dates: list[date], frequency: Frequency) -> list[date]:
    """Start grid by frequency — same helpers as Gift AIF Backtester."""
    if frequency == "monthly":
        return _month_starts(dates)
    if frequency == "weekly":
        return _week_starts(dates)
    if frequency == "daily":
        return list(dates)
    if frequency == "quarterly":
        return _quarter_starts(dates)
    if frequency == "semi_annual":
        return _semi_annual_starts(dates)
    raise ValueError(f"Unknown frequency {frequency}")


def forward_asof(market: MarketDB) -> date:
    """Path-1 start = latest Nifty session (dynamic present date)."""
    return market.last_date


def _snap_start(market: MarketDB, target: date, asof: date, last_start_cap: date) -> date:
    """Nearest trading day on/after target within [asof, last_start_cap]."""
    if target < asof:
        target = asof
    if target > last_start_cap:
        target = last_start_cap
    days = market.trading_days_between(target, last_start_cap)
    if days:
        return days[0]
    before = market.trading_days_between(asof, target)
    if before:
        return before[-1]
    return asof


def _calendar_need(
    starts: list[date],
    tenure_days: int,
    observation_months: list[float] | None,
    simulation_end: date,
) -> date:
    """Furthest date the market calendar must cover."""
    need = simulation_end + timedelta(days=60)
    if starts:
        last_start = starts[-1]
        need = max(need, path_end_calendar(last_start, tenure_days) + timedelta(days=60))
        if observation_months:
            obs_m = max(float(m) for m in observation_months)
            need = max(need, last_observation_target(last_start, obs_m) + timedelta(days=60))
    return need


def _build_one(
    market: MarketDB,
    pid: int,
    start: date,
    tenure_days: int,
    *,
    max_end: date | None = None,
) -> PathSpec | None:
    """Mirror backtester ``_build_one`` for a complete tenure window.

    ``max_end`` (Simulation End) caps the calendar end so the final path never
    overshoots the product horizon.
    """
    end_cal = path_end_calendar(start, tenure_days)
    if max_end is not None and end_cal > max_end:
        end_cal = max_end
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
) -> np.ndarray:
    """Daily GBM along the path trading calendar (S0 = live as-of Nifty)."""
    del frequency
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
    """Extend market through Simulation End with forward calendars.

    When ``fill_gbm`` is True, Path-1 GBM closes fill the pad (legacy / debug).
    Production desk meta and path evaluation use ``fill_gbm=False``: calendars
    only. Each path carries its own GBM spots and path-local roll points.
    """
    pad_end = horizon_end + timedelta(days=60)
    # Also cover a start placed on as-of whose tenure may extend past horizon only
    # for intermediate paths; final path ends on horizon_end.
    asof = market.last_date
    pad_end = max(pad_end, path_end_calendar(asof, tenure_days) + timedelta(days=60))
    if observation_months:
        obs_m = max(float(m) for m in observation_months)
        pad_end = max(pad_end, last_observation_target(asof, obs_m) + timedelta(days=60))
        # Last start near horizon also needs obs coverage.
        s_guess = path_start_for_end(horizon_end, tenure_days)
        pad_end = max(pad_end, last_observation_target(s_guess, obs_m) + timedelta(days=60))
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
    base_seed: int = GBM_BASE_SEED,
    attach_spots: bool = True,
) -> tuple[list[PathSpec], MarketDB, GbmParams, date]:
    """
    Build staggered forward tenure windows.

    Simulation End is the final path's calendar end.
    Returns (paths, forward_market, gbm_params, simulation_end).
    """
    asof = forward_asof(market)
    horizon = simulation_end or resolved_simulation_end(asof, product)
    if horizon <= asof:
        raise RuntimeError(
            f"Simulation end {horizon.isoformat()} must be after as-of {asof.isoformat()}"
        )

    # Last start such that tenure ends on Simulation End.
    s_last_raw = path_start_for_end(horizon, tenure_days)
    if s_last_raw < asof:
        raise RuntimeError(
            f"Simulation End Days too short for tenure_days={tenure_days}: "
            f"implied last start {s_last_raw.isoformat()} is before as-of {asof.isoformat()}"
        )

    fwd_market, params = build_forward_market(
        market,
        horizon,
        tenure_days,
        observation_months=observation_months,
        fill_gbm=True,
        base_seed=base_seed,
    )
    s_last = _snap_start(fwd_market, s_last_raw, asof, s_last_raw if s_last_raw >= asof else asof)
    # Latest start whose tenure calendar end is on/before Simulation End (no overshoot).
    pool_probe = fwd_market.trading_days_between(asof, horizon)
    candidates = [
        d for d in pool_probe if path_end_calendar(d, tenure_days) <= horizon
    ]
    if candidates:
        s_last = candidates[-1]
    elif path_end_calendar(s_last, tenure_days) > horizon:
        # Anniversary inversion landed past horizon — walk back to a feasible start.
        back = [
            d
            for d in fwd_market.trading_days_between(asof, s_last)
            if path_end_calendar(d, tenure_days) <= horizon
        ]
        if back:
            s_last = back[-1]

    pool = fwd_market.trading_days_between(asof, s_last)
    if not pool:
        pool = [asof]

    starts = generate_path_starts(pool, frequency)
    if asof in fwd_market.date_to_idx:
        starts = [asof] + [s for s in starts if asof < s <= s_last]
    starts = [s for s in dict.fromkeys(starts) if asof <= s <= s_last]
    if not starts:
        starts = [asof]
    if s_last not in starts and s_last >= asof:
        starts.append(s_last)
        starts = sorted(set(starts))

    need = _calendar_need(starts, tenure_days, observation_months, horizon)
    if need > fwd_market.last_date:
        fwd_market = extend_market_forward(
            fwd_market,
            need,
            gbm_params=params,
            base_seed=base_seed,
            path_id=1,
        )

    last_expiry = fwd_market.expiries[-1] if fwd_market.expiries else fwd_market.last_date
    last_obs_m = max(observation_months) if observation_months else None

    paths: list[PathSpec] = []
    pid = 1
    for start in starts:
        if not observation_fits_market(start, last_obs_m, last_expiry):
            break
        spec = _build_one(fwd_market, pid, start, tenure_days, max_end=horizon)
        if spec is None:
            end_cal = min(path_end_calendar(start, tenure_days), horizon)
            if end_cal > fwd_market.last_date:
                fwd_market = extend_market_forward(
                    fwd_market,
                    end_cal + timedelta(days=60),
                    gbm_params=params,
                    base_seed=base_seed,
                    path_id=1,
                )
                last_expiry = (
                    fwd_market.expiries[-1] if fwd_market.expiries else fwd_market.last_date
                )
                spec = _build_one(fwd_market, pid, start, tenure_days, max_end=horizon)
            if spec is None:
                continue
        if attach_spots:
            spec.spots = simulate_path_spots(
                spec.dates, params, pid, base_seed=base_seed, frequency=frequency
            )
        paths.append(spec)
        pid += 1

    if not paths:
        raise RuntimeError(
            "No complete forward tenure windows for "
            f"as-of={asof.isoformat()}, simulation_end={horizon.isoformat()}, "
            f"tenure_days={tenure_days}, frequency={frequency}"
        )

    # Desk rule: Simulation End = final path's calendar end (last TD on/before horizon).
    last = paths[-1]
    horizon_days = fwd_market.trading_days_between(last.start, horizon)
    if horizon_days and horizon_days[-1] != last.end:
        last.end = horizon_days[-1]
        last.dates = horizon_days
        if attach_spots:
            last.spots = simulate_path_spots(
                last.dates, params, last.path_id, base_seed=base_seed, frequency=frequency
            )

    return paths, fwd_market, params, horizon


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
            dates, params, path_id, base_seed=base_seed, frequency=frequency
        )
    return PathSpec(path_id=path_id, start=dates[0], end=dates[-1], dates=dates, spots=spots)
