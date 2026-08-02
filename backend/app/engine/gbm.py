"""Geometric Brownian Motion stats + path generation (Excel Monte Carlo parity).

Excel ``Nifty Simulations.xlsx`` / Monte Carlo sheet:

  daily_return_t = Nifty_t / Nifty_{t-1} - 1
  μ              = mean(daily returns)
  σ              = stdev(daily returns)
  drift          = μ − ½ σ²

  S_t = S_{t-1} · exp(drift + σ · Z),   Z ~ N(0,1)

  Matrix layout: rows = path numbers 1,2,3,… ; columns = day indices 1,2,3,…
  Same day index ⇒ different prices across paths (independent Z per path_id).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .market import MarketDB

# Fixed base seed so path_id → spots is reproducible across workers / reloads.
GBM_BASE_SEED = 20260101


@dataclass(frozen=True)
class GbmParams:
    """Daily GBM parameters estimated from historical Nifty closes."""

    spot0: float
    asof: str
    mean_return: float  # raw mean of daily simple returns (μ)
    std_dev: float  # σ of daily simple returns
    drift: float  # μ − ½ σ²  (Excel "Drift" / "Mean Return")
    n_returns: int
    first_date: str
    last_date: str

    def to_dict(self) -> dict:
        return {
            "spot0": self.spot0,
            "asof": self.asof,
            "mean_return": self.mean_return,
            "std_dev": self.std_dev,
            "drift": self.drift,
            "n_returns": self.n_returns,
            "first_date": self.first_date,
            "last_date": self.last_date,
            "mean_return_pct": self.mean_return * 100.0,
            "std_dev_pct": self.std_dev * 100.0,
        }


def estimate_gbm_params(market: MarketDB) -> GbmParams:
    """Estimate daily μ, σ, drift from Nifty history (2001-01-01 → latest close)."""
    closes = np.asarray(market.closes, dtype=float)
    if closes.size < 3:
        raise RuntimeError("Need at least 3 Nifty closes to estimate GBM parameters")
    rets = closes[1:] / closes[:-1] - 1.0
    rets = rets[np.isfinite(rets)]
    if rets.size < 2:
        raise RuntimeError("Insufficient valid daily returns for GBM")
    mu = float(np.mean(rets))
    sigma = float(np.std(rets, ddof=1))  # sample stdev like Excel STDEV
    drift = mu - 0.5 * sigma * sigma
    return GbmParams(
        spot0=float(closes[-1]),
        asof=market.last_date.isoformat(),
        mean_return=mu,
        std_dev=sigma,
        drift=drift,
        n_returns=int(rets.size),
        first_date=market.first_date.isoformat(),
        last_date=market.last_date.isoformat(),
    )


def _steps_per_frequency(frequency: str) -> float:
    """Approximate trading days per GBM step when frequency ≠ daily."""
    if frequency == "daily":
        return 1.0
    if frequency == "weekly":
        return 5.0
    if frequency == "monthly":
        return 21.0
    if frequency == "quarterly":
        return 63.0
    if frequency == "semi_annual":
        return 126.0
    return 1.0


def scaled_step_params(params: GbmParams, frequency: str) -> tuple[float, float]:
    """Scale daily drift/σ to the path-frequency step (Δt in trading days)."""
    dt = _steps_per_frequency(frequency)
    # Simple-return μ scales ≈ linearly; vol scales with √Δt.
    # Drift for EXP uses (μ_step − ½ σ_step²).
    mu_step = params.mean_return * dt
    sigma_step = params.std_dev * np.sqrt(dt)
    drift_step = mu_step - 0.5 * sigma_step * sigma_step
    return float(drift_step), float(sigma_step)


def gbm_spots(
    spot0: float,
    n_dates: int,
    drift: float,
    sigma: float,
    *,
    path_id: int,
    base_seed: int = GBM_BASE_SEED,
) -> np.ndarray:
    """Simulate one GBM spot path of length ``n_dates``.

    Recurrence (matches ``Nifty Simulations.xlsx``)::

        S_t = S_{t-1} · exp(drift + σ · Z),  Z ~ N(0,1)

    Index 0 is as-of ``spot0`` (Hedging / Computation day-0). Excel day columns
    are the *future* steps; our ``out[1:]`` matches those future columns for the
    same path_id seed stream. Independent paths ⇒ different prices on the same
    day index / calendar date.
    """
    if n_dates <= 0:
        return np.zeros(0, dtype=np.float64)
    out = np.empty(n_dates, dtype=np.float64)
    out[0] = float(spot0)
    if n_dates == 1:
        return out
    rng = np.random.default_rng(int(base_seed) + int(path_id) * 1_000_003)
    z = rng.standard_normal(n_dates - 1)
    # Excel / image recurrence: S_t = S_{t-1} * EXP(drift + σ·Z).
    # Cumsum of log-returns is algebraically identical and faster; float64 keeps
    # long horizons (thousands of sessions) numerically stable.
    log_rets = float(drift) + float(sigma) * z
    out[1:] = np.exp(np.log(out[0]) + np.cumsum(log_rets))
    return out


def gbm_spots_matrix(
    spot0: float,
    n_dates: int,
    n_paths: int,
    drift: float,
    sigma: float,
    *,
    base_seed: int = GBM_BASE_SEED,
) -> np.ndarray:
    """(n_paths × n_dates) float32 matrix — rows = paths 1..n, cols = days.

    Same layout as ``Nifty Simulations.xlsx`` (vertical path id, horizontal day).
    Built path-by-path with the same seed rule as ``gbm_spots`` (worker parity),
    casting to float32 to cut peak RAM on deploy hosts.
    """
    if n_paths <= 0 or n_dates <= 0:
        return np.zeros((0, 0), dtype=np.float32)
    mat = np.empty((n_paths, n_dates), dtype=np.float32)
    for i in range(n_paths):
        mat[i] = gbm_spots(
            spot0, n_dates, drift, sigma, path_id=i + 1, base_seed=base_seed
        ).astype(np.float32, copy=False)
    return mat
