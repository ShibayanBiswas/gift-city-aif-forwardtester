"""Build option legs and compute required delta path (Hedging Sheet)."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np

from .black_scholes import central_delta_book, vol_for_strike_pct
from .market import MarketDB
from .product import ProductSpec


@dataclass
class BuiltLeg:
    raw_qty: float
    strike_pct: float
    strike: float
    expiry: date
    quantity: float
    vol: float
    is_put: bool = True
    forward_rate: float = 0.066
    discount_rate: float = 0.076


@dataclass
class ObservationBuild:
    month: float
    target_date: date
    expiry: date
    nifty: float
    offset_days: float


@dataclass
class PathHedge:
    spot0: float
    observations: list[date]
    obs_spots: list[float]
    obs_builds: list[ObservationBuild]
    legs: list[BuiltLeg]
    req_delta: np.ndarray
    last_observation: date


def resolve_observation_expiry(market: MarketDB, target: date) -> date:
    """
    Excel Hedging Sheet: target = start + month*30.5, then map to the monthly
    Nifty option expiry for that month (last expiry in the target month;
    else first expiry on/after target — VLOOKUP+1 style).
    """
    hit = market.expiry_by_month.get((target.year, target.month))
    if hit is not None:
        return hit
    return market.first_expiry_on_or_after(target)


def build_observations(market: MarketDB, start: date, months: list[float]) -> list[date]:
    return [resolve_observation_expiry(market, start + timedelta(days=m * 30.5)) for m in months]


def _spot_on_or_before(
    path_dates: list[date],
    spots: np.ndarray,
    target: date,
) -> float:
    """Nearest path spot on/before ``target`` (floor); else first path spot."""
    if not path_dates:
        raise ValueError("Empty path dates")
    # Exact hit
    for i, d in enumerate(path_dates):
        if d == target:
            return float(spots[i])
    # Floor to last path date ≤ target
    lo, hi, ans = 0, len(path_dates) - 1, -1
    while lo <= hi:
        mid = (lo + hi) // 2
        if path_dates[mid] <= target:
            ans = mid
            lo = mid + 1
        else:
            hi = mid - 1
    if ans >= 0:
        return float(spots[ans])
    return float(spots[0])


def build_observation_details(
    market: MarketDB,
    start: date,
    months: list[float],
    *,
    path_dates: list[date] | None = None,
    spots: np.ndarray | None = None,
) -> list[ObservationBuild]:
    out: list[ObservationBuild] = []
    for m in months:
        offset = m * 30.5
        target = start + timedelta(days=offset)
        exp = resolve_observation_expiry(market, target)
        if path_dates is not None and spots is not None:
            nifty = _spot_on_or_before(path_dates, spots, exp)
        else:
            try:
                nifty = market.nifty_on(exp)
            except KeyError:
                nifty = float(spots[0]) if spots is not None and len(spots) else 0.0
        out.append(
            ObservationBuild(
                month=m,
                target_date=target,
                expiry=exp,
                nifty=nifty,
                offset_days=offset,
            )
        )
    return out


def build_legs(
    product: ProductSpec,
    spot0: float,
    observations: list[date],
) -> list[BuiltLeg]:
    n_obs = max(len(observations), 1)
    legs: list[BuiltLeg] = []
    # Skip Include=False legs (e.g. qty 0.6 full-hedge kept on Product Input for display only).
    for spec in product.active_legs:
        strike = spot0 * spec.strike_pct / 100.0
        qty = spec.quantity * product.principal / spot0 / n_obs
        is_put = not str(spec.option_type or "P").upper().startswith("C")
        for obs_i, exp in enumerate(observations):
            vol = spec.vol_for_observation(obs_i)
            if vol <= 0:
                vol = vol_for_strike_pct(spec.strike_pct)
            legs.append(
                BuiltLeg(
                    raw_qty=spec.quantity,
                    strike_pct=spec.strike_pct,
                    strike=strike,
                    expiry=exp,
                    quantity=qty,
                    vol=vol,
                    is_put=is_put,
                    forward_rate=float(spec.forward_rate),
                    discount_rate=float(spec.discount_rate),
                )
            )
    return legs


def compute_req_delta(
    market: MarketDB,
    path_dates: list[date],
    legs: list[BuiltLeg],
    spots: np.ndarray | None = None,
) -> np.ndarray:
    n = len(path_dates)
    if spots is None:
        spots = market.spots_for_dates(path_dates)
    asof = np.asarray(path_dates, dtype="datetime64[D]")
    total = np.zeros(n, dtype=float)

    # Group by expiry so tau is built once per observation month.
    by_exp: dict[date, list[BuiltLeg]] = defaultdict(list)
    for leg in legs:
        by_exp[leg.expiry].append(leg)

    for exp, group in by_exp.items():
        tau = (np.datetime64(exp) - asof).astype(float) / 365.0
        strikes = np.array([lg.strike for lg in group], dtype=float)
        vols = np.array([lg.vol for lg in group], dtype=float)
        qtys = np.array([lg.quantity for lg in group], dtype=float)
        fr = group[0].forward_rate
        dr = group[0].discount_rate
        is_put = group[0].is_put
        total += central_delta_book(
            spots,
            tau,
            strikes,
            vols,
            qtys,
            forward_rate=fr,
            discount_rate=dr,
            is_put=is_put,
        )
    return total


def hedge_path(
    market: MarketDB,
    product: ProductSpec,
    path_dates: list[date],
    spots: np.ndarray | None = None,
) -> PathHedge:
    if not product.observation_months:
        raise ValueError("Product has no observation months — cannot build hedge path")
    if not product.active_legs:
        raise ValueError("Product has no active option legs — cannot build hedge path")
    start = path_dates[0]
    if spots is None:
        spots = market.spots_for_dates(path_dates)
    spot0 = float(spots[0])
    builds = build_observation_details(
        market,
        start,
        product.observation_months,
        path_dates=path_dates,
        spots=spots,
    )
    observations = [b.expiry for b in builds]
    legs = build_legs(product, spot0, observations)
    req = compute_req_delta(market, path_dates, legs, spots=spots)
    return PathHedge(
        spot0=spot0,
        observations=observations,
        obs_spots=[b.nifty for b in builds],
        obs_builds=builds,
        legs=legs,
        req_delta=req,
        last_observation=max(observations) if observations else start,
    )
