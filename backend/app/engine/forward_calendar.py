"""Extend historical MarketDB into the forward simulation horizon.

Forward trading sessions (after last historical Nifty close = as-of):
  - **Mon–Fri only**, minus projected NSE holidays inferred from historical
    weekday gaps in ``nifty_daily.csv`` (month–day pattern of the last years).
  - Month lengths follow the real calendar (28/29/30/31), including leap Februaries.

Forward event calendars (months whose monthly expiry is still after as-of):
  - **Futures shift / roll** = monthly-last Nifty **option expiry** (WF1 / Backtester).
  - **Monthly Nifty option expiry** = last Thursday (pre Sep-2025) or last Tuesday
    (from Sep-2025), snapped to the **previous** trading session when that weekday
    is a holiday (never forward to Wednesday).
  - The as-of month is included when its expiry is still ahead (e.g. as-of early
    August still lists that August monthly expiry; prior month July remains the
    previous shift for roll-cost Δt).

Horizon end is **Product End** = ``path_end_calendar(as-of, tenure_days)``
(not a separate Simulation End Days control). Optional Path-1 GBM fill is
legacy/debug only. Production uses per-path GBM spots and ``path_roll_vector``
for roll points — there is no shared forward price workbook.
Historical expiries / rolls / closes are preserved through as-of unchanged.
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np

from .calendar_build import last_monthly_expiry_on_or_before, month_ends
from .gbm import GBM_BASE_SEED, GbmParams, gbm_spots
from .market import MarketDB, _recompute_roll_costs


def historical_weekday_holidays(dates: list[date]) -> set[date]:
    """Weekdays in [first, last] absent from the Nifty session list (= holidays)."""
    if not dates:
        return set()
    present = set(dates)
    holidays: set[date] = set()
    d = dates[0]
    end = dates[-1]
    while d <= end:
        if d.weekday() < 5 and d not in present:
            holidays.add(d)
        d += timedelta(days=1)
    return holidays


def project_holidays(
    hist_holidays: set[date],
    asof: date,
    end: date,
    *,
    lookback_years: int = 6,
) -> set[date]:
    """Project recent historical holiday month–days onto the forward calendar."""
    if not hist_holidays or end <= asof:
        return set()
    cutoff = date(asof.year - lookback_years, 1, 1)
    md: set[tuple[int, int]] = set()
    for h in hist_holidays:
        if h >= cutoff and h <= asof:
            md.add((h.month, h.day))
    out: set[date] = set()
    y = asof.year
    while y <= end.year + 1:
        for month, day in md:
            try:
                cand = date(y, month, day)
            except ValueError:
                continue
            if asof < cand <= end and cand.weekday() < 5:
                out.add(cand)
        y += 1
    return out


def _weekday_sessions(start: date, end: date, holidays: set[date] | None = None) -> list[date]:
    """Mon–Fri calendar days from ``start`` through ``end``, excluding holidays."""
    hol = holidays or set()
    out: list[date] = []
    d = start
    while d <= end:
        if d.weekday() < 5 and d not in hol:
            out.append(d)
        d += timedelta(days=1)
    return out


def _forward_month_rolls_and_expiries(
    trading_dates: list[date],
    *,
    after: date,
    end: date,
) -> tuple[list[date], list[date]]:
    """Future monthly rolls and expiries from ``after`` through ``end``.

    Both calendars use the Backtester / WF1 rule:
      monthly-last Nifty option expiry (Thu→Tue era) with holiday floor **backward**.
    Futures shift date == that expiry date.

    Includes the **as-of month** when its monthly expiry is still strictly after
    ``after`` (e.g. as-of 03-Aug-2026 still emits 25-Aug-2026). Months whose
    expiry has already passed (≤ as-of) are omitted. Incomplete pad months at
    the horizon are skipped via ``asof=end``.
    """
    trading = set(trading_dates)
    rolls: list[date] = []
    expiries: list[date] = []

    for me in month_ends(after, end):
        # Do NOT skip the as-of calendar month — only skip if the monthly expiry
        # itself is already on/before as-of (handled by exp <= after below).
        exp = last_monthly_expiry_on_or_before(me, trading, asof=end)
        if exp is None or exp <= after or exp > end:
            continue
        expiries.append(exp)
        rolls.append(exp)  # futures shift == monthly option expiry

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
    Future sessions are Mon–Fri minus projected holidays; future rolls and monthly
    expiries are both monthly-last option dates (holiday → previous session).
    """
    if horizon_end <= market.last_date:
        return market

    asof = market.last_date
    hist_holidays = historical_weekday_holidays(market.dates)
    fwd_holidays = project_holidays(hist_holidays, asof, horizon_end)
    future = _weekday_sessions(asof + timedelta(days=1), horizon_end, fwd_holidays)
    if not future:
        return market

    dates = list(market.dates) + future
    hist_closes = np.asarray(market.closes, dtype=float)
    if gbm_params is not None:
        series = gbm_spots(
            gbm_params.spot0,
            1 + len(future),
            gbm_params.drift,
            gbm_params.std_dev,
            path_id=path_id,
            base_seed=base_seed,
        )
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
