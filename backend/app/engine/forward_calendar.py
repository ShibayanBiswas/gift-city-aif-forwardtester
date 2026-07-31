"""Extend historical MarketDB into the forward simulation horizon.

Forward trading sessions (after last historical Nifty close = as-of):
  - **Mon–Fri only** — Saturday and Sunday are always closed (no prices).
  - Month lengths follow the real calendar (28/29/30/31), including leap Februaries.
  - No NSE holiday calendar in the forward pad (every weekday is a session).

Forward event calendars (months strictly after as-of, complete months only):
  - **Futures shift / roll** = last trading day of each calendar month
    (last Mon–Fri on/before the real month-end).
  - **Monthly Nifty option expiry** = last Tuesday of each calendar month.

Horizon end is **as-of + Simulation End Days** from Product Input (default 3650).
Optional Path-1 GBM fill is legacy/debug only. Production uses per-path GBM spots
and ``path_roll_vector`` for roll points — there is no shared forward price workbook.
Historical expiries / rolls / closes are preserved through as-of unchanged.
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np

from .calendar_build import month_ends
from .gbm import GBM_BASE_SEED, GbmParams, gbm_spots
from .market import MarketDB, _recompute_roll_costs


def _weekday_sessions(start: date, end: date) -> list[date]:
    """Mon–Fri calendar days from ``start`` through ``end`` inclusive.

    Uses real calendar day stepping so Feb 28/29 and 30/31-day months are exact.
    Saturday (5) and Sunday (6) are never emitted.
    """
    out: list[date] = []
    d = start
    while d <= end:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def _last_weekday_of_month(month_end: date) -> date:
    """Last Mon–Fri on/before the real calendar month-end (ignores trading set)."""
    d = month_end
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def _last_tuesday_of_month_calendar(month_end: date) -> date:
    """Last Tuesday on/before the real calendar month-end."""
    d = month_end
    while d.weekday() != 1:  # Tue = 1
        d -= timedelta(days=1)
    return d


def _last_trading_day_of_month(month_end: date, trading: set[date]) -> date | None:
    """Last session on/before month_end that is in ``trading``."""
    d = month_end
    for _ in range(12):
        if d in trading:
            return d
        d -= timedelta(days=1)
    return None


def _forward_month_rolls_and_expiries(
    trading_dates: list[date],
    *,
    after: date,
    end: date,
) -> tuple[list[date], list[date]]:
    """Future month-end rolls and last-Tuesday expiries for complete months after ``after``.

    A month is emitted only when its **true** last weekday (roll) and last Tuesday
    (expiry) both fall on the trading calendar and on/before ``end``. Truncated pad
    months (calendar stops mid-month) are skipped — never invent a fake shift on the
    pad's last day.
    """
    trading = set(trading_dates)
    rolls: list[date] = []
    expiries: list[date] = []

    for me in month_ends(after, end):
        if (me.year, me.month) <= (after.year, after.month):
            continue

        true_roll = _last_weekday_of_month(me)
        true_tue = _last_tuesday_of_month_calendar(me)

        # Incomplete month in the pad: true month-end weekday not yet on the calendar.
        if true_roll not in trading or true_roll > end:
            continue

        roll = _last_trading_day_of_month(me, trading)
        if roll is not None and roll > after and roll <= end and roll == true_roll:
            rolls.append(roll)

        if true_tue in trading and true_tue > after and true_tue <= end:
            expiries.append(true_tue)

    return sorted(set(rolls)), sorted(set(expiries))


def extend_market_forward(
    market: MarketDB,
    horizon_end: date,
    *,
    gbm_params: GbmParams | None = None,
    base_seed: int = GBM_BASE_SEED,
    path_id: int = 1,
) -> MarketDB:
    """Return a MarketDB covering through ``horizon_end`` with forward roll/expiry rules.

    Historical closes / expiries / rolls are preserved through ``market.last_date``.
    Future sessions are Mon–Fri only; future rolls = month-end trading days;
    future monthly expiries = last Tuesdays. Optional Path-1 GBM closes are only
    for legacy fill; production uses per-path GBM spots and ``path_roll_vector``.
    """
    if horizon_end <= market.last_date:
        return market

    asof = market.last_date
    future = _weekday_sessions(asof + timedelta(days=1), horizon_end)
    if not future:
        return market

    dates = list(market.dates) + future
    hist_closes = np.asarray(market.closes, dtype=float)
    if gbm_params is not None:
        # Full series including as-of at index 0, then future steps.
        series = gbm_spots(
            gbm_params.spot0,
            1 + len(future),
            gbm_params.drift,
            gbm_params.std_dev,
            path_id=path_id,
            base_seed=base_seed,
        )
        # Keep exact historical closes; only append the forward portion.
        closes = np.concatenate([hist_closes, np.asarray(series[1:], dtype=float)])
    else:
        closes = np.concatenate(
            [hist_closes, np.full(len(future), float(hist_closes[-1]))]
        )
    date_to_idx = {d: i for i, d in enumerate(dates)}

    fwd_rolls, fwd_expiries = _forward_month_rolls_and_expiries(
        dates, after=asof, end=horizon_end
    )

    hist_expiries = [e for e in market.expiries if e <= asof]
    hist_rolls = [d for d in market.roll_shifts if d <= asof]
    expiries = sorted(set(hist_expiries) | set(fwd_expiries))
    shifts = sorted(set(hist_rolls) | set(fwd_rolls))

    monthly_last = set(expiries)
    hist_all = [e for e in market.all_expiries if e <= asof]
    all_expiries = sorted(set(hist_all) | monthly_last)

    model = _recompute_roll_costs(dates, closes, shifts)
    roll_by_expiry = dict(market.roll_by_expiry)
    for d in shifts:
        if d not in roll_by_expiry or d > asof:
            roll_by_expiry[d] = float(model.get(d, 0.0))

    roll_on_date = np.zeros(len(dates), dtype=float)
    for d, cost in roll_by_expiry.items():
        idx = date_to_idx.get(d)
        if idx is not None:
            roll_on_date[idx] = float(cost)

    expiry_by_month = {(e.year, e.month): e for e in expiries}

    return MarketDB(
        dates=dates,
        closes=closes,
        date_to_idx=date_to_idx,
        expiries=expiries,
        all_expiries=all_expiries,
        roll_shifts=shifts,
        roll_by_expiry=roll_by_expiry,
        roll_on_date=roll_on_date,
        expiry_by_month=expiry_by_month,
        monthly_last_expiries=monthly_last,
    )
