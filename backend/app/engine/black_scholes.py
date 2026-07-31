"""Black–Scholes helpers matching Excel NORMDIST central-difference delta."""
from __future__ import annotations

import numpy as np
from scipy.special import erf

# Fallback moneyness vol surface (far-obs vols) from Working File 1 As-per-HS.
# Prefer per-leg Vol Near / Vol Far from Product Input when present.
_VOL_KNOTS = np.array([70.0, 84.0, 85.0, 125.0, 136.0, 137.0, 150.0], dtype=float)
_VOL_VALUES = np.array(
    [
        0.2319842472882776,
        0.20774616738378116,
        0.2061305717267251,
        0.15619717745743442,
        0.14848846191959258,
        0.14793275750723667,
        0.14000,
    ],
    dtype=float,
)

_INV_SQRT2 = 1.0 / np.sqrt(2.0)
_BUMP = 0.5


def norm_cdf(x: np.ndarray) -> np.ndarray:
    """Standard normal CDF via erf — matches scipy.stats.norm.cdf to ~1e-15."""
    return 0.5 * (1.0 + erf(x * _INV_SQRT2))


def _bs_price_valid(
    spot: np.ndarray,
    strike: float,
    tau: np.ndarray,
    forward_rate: float,
    discount_rate: float,
    vol: float,
    is_put: bool,
) -> np.ndarray:
    """BS price on a pre-filtered valid (spot, tau) set — no mask overhead."""
    fwd = spot * np.exp(forward_rate * tau)
    disc = np.exp(-discount_rate * tau)
    vol_sqrt = vol * np.sqrt(tau)
    d1 = (np.log(fwd / strike) + 0.5 * vol * vol * tau) / vol_sqrt
    d2 = d1 - vol_sqrt
    if is_put:
        return disc * (strike * norm_cdf(-d2) - fwd * norm_cdf(-d1))
    return disc * (fwd * norm_cdf(d1) - strike * norm_cdf(d2))


def _bs_price_grid(
    spot: np.ndarray,
    strikes: np.ndarray,
    tau: np.ndarray,
    vols: np.ndarray,
    forward_rate: float,
    discount_rate: float,
    is_put: bool,
) -> np.ndarray:
    """
    Vectorized BS over many strikes.
    spot/tau: (n,), strikes/vols: (L,) → price grid (L, n).
    """
    s = spot[None, :]
    t = tau[None, :]
    k = strikes[:, None]
    v = vols[:, None]
    fwd = s * np.exp(forward_rate * t)
    disc = np.exp(-discount_rate * t)
    vol_sqrt = v * np.sqrt(t)
    d1 = (np.log(fwd / k) + 0.5 * v * v * t) / vol_sqrt
    d2 = d1 - vol_sqrt
    if is_put:
        return disc * (k * norm_cdf(-d2) - fwd * norm_cdf(-d1))
    return disc * (fwd * norm_cdf(d1) - k * norm_cdf(d2))


def _bs_price(
    spot: np.ndarray,
    strike: float,
    tau: np.ndarray,
    forward_rate: float,
    discount_rate: float,
    vol: float,
    is_put: bool,
) -> np.ndarray:
    """Excel-parity BS price; tau in years; invalid/expired → 0."""
    spot = np.asarray(spot, dtype=float)
    tau = np.asarray(tau, dtype=float)
    out = np.zeros(spot.shape, dtype=float)
    valid = (tau > 1e-12) & (spot > 0) & (strike > 0) & (vol > 0)
    if not np.any(valid):
        return out
    out[valid] = _bs_price_valid(
        spot[valid], strike, tau[valid], forward_rate, discount_rate, vol, is_put
    )
    return out


def central_delta(
    spot: np.ndarray,
    strike: float,
    tau: np.ndarray,
    forward_rate: float,
    discount_rate: float,
    vol: float,
    is_put: bool,
    bump: float = _BUMP,
) -> np.ndarray:
    """(P(S+bump) - P(S-bump)) — Excel does not divide by 2*bump; raw difference × qty."""
    spot = np.asarray(spot, dtype=float)
    tau = np.asarray(tau, dtype=float)
    out = np.zeros(spot.shape, dtype=float)
    valid = (tau > 1e-12) & (spot > bump) & (strike > 0) & (vol > 0)
    if not np.any(valid):
        return out
    s = spot[valid]
    t = tau[valid]
    up = _bs_price_valid(s + bump, strike, t, forward_rate, discount_rate, vol, is_put)
    dn = _bs_price_valid(s - bump, strike, t, forward_rate, discount_rate, vol, is_put)
    out[valid] = up - dn
    return out


def central_delta_book(
    spots: np.ndarray,
    tau: np.ndarray,
    strikes: np.ndarray,
    vols: np.ndarray,
    quantities: np.ndarray,
    *,
    forward_rate: float = 0.066,
    discount_rate: float = 0.076,
    is_put: bool = True,
    bump: float = _BUMP,
) -> np.ndarray:
    """
    Sum of central deltas × qty for many strikes sharing the same tau path.
    strikes/vols/quantities shape (L,); spots/tau shape (n,).
    Fully vectorized across the strike book (critical on 1-CPU free tiers).
    """
    spots = np.asarray(spots, dtype=float)
    tau = np.asarray(tau, dtype=float)
    strikes = np.asarray(strikes, dtype=float)
    vols = np.asarray(vols, dtype=float)
    quantities = np.asarray(quantities, dtype=float)
    n = spots.shape[0]
    total = np.zeros(n, dtype=float)

    leg_ok = (strikes > 0) & (vols > 0) & (quantities != 0)
    if not np.any(leg_ok):
        return total
    strikes = strikes[leg_ok]
    vols = vols[leg_ok]
    quantities = quantities[leg_ok]

    valid = (tau > 1e-12) & (spots > bump)
    if not np.any(valid):
        return total

    s = spots[valid]
    t = tau[valid]
    up = _bs_price_grid(s + bump, strikes, t, vols, forward_rate, discount_rate, is_put)
    dn = _bs_price_grid(s - bump, strikes, t, vols, forward_rate, discount_rate, is_put)
    # (L, n_valid) → weight by qty and sum legs
    total[valid] = ((up - dn) * quantities[:, None]).sum(axis=0)
    return total


def vol_for_strike_pct(strike_pct: float) -> float:
    """Moneyness vol surface pinned to Working File As-per-HS hard-coded vols."""
    return float(np.interp(strike_pct, _VOL_KNOTS, _VOL_VALUES))
