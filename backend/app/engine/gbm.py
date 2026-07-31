"""Geometric Brownian Motion stats + path generation (Excel Monte Carlo parity).

Excel Raw Data / Simulation:
  daily_return_t = Nifty_t / Nifty_{t-1} - 1
  avg_return μ  = mean(daily returns)
  std_dev σ     = stdev(daily returns)
  mean_return   = μ − ½ σ²   (drift in the EXP formula)

  S_t = S_{t-1} * EXP(mean_return + σ * NORM.INV(RAND(), 0, 1))
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
    drift: float  # μ − ½ σ²  (Excel "Mean Return")
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
    """Simulate one GBM spot path of length ``n_dates`` (day-0 = spot0).

    Excel column 1 is the first *future* day; our path includes as-of as index 0
    so Hedging Sheet / Computation see the same spot0 as the live Nifty close.
    """
    if n_dates <= 0:
        return np.zeros(0, dtype=float)
    out = np.empty(n_dates, dtype=float)
    out[0] = float(spot0)
    if n_dates == 1:
        return out
    rng = np.random.default_rng(int(base_seed) + int(path_id) * 1_000_003)
    z = rng.standard_normal(n_dates - 1)
    log_rets = drift + sigma * z
    out[1:] = spot0 * np.exp(np.cumsum(log_rets))
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
    """Vectorized (n_paths × n_dates) GBM matrix — path i uses seed base+i."""
    if n_paths <= 0 or n_dates <= 0:
        return np.zeros((0, 0), dtype=float)
    # Generate path-by-path with the same seed rule as gbm_spots for worker parity.
    mat = np.empty((n_paths, n_dates), dtype=float)
    for i in range(n_paths):
        mat[i] = gbm_spots(
            spot0, n_dates, drift, sigma, path_id=i + 1, base_seed=base_seed
        )
    return mat
