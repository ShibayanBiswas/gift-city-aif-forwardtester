"""Nifty option expiry calendars — modular from 2001, dynamically extendable.

Excel / Notes keep two related calendars:
  - Roll Cost + Paths col B: **monthly** futures shifts (= last monthly Nifty option expiry)
  - Expiry sheet: **monthly** option expiries from Feb-2004 (cols B & D are duplicates)

NSE schedule (Nifty):
  - **Before 14-Feb-2019:** monthly only — last Thursday of the expiry month
    (holiday → previous trading day). No weeklies existed.
  - **14-Feb-2019 → Aug-2025:** weekly + monthly on **Thursday**
    (holiday → previous trading day). First weekly expiry 2019-02-14
    (trading from 2019-02-11; NSE/FAOP circular).
  - **From Sep-2025:** weekly + monthly on **Tuesday**
    (NSE circular; holiday → previous trading day).

Hedging Sheet / Computation still map observations onto the **monthly last**
expiry. Intel shows the full weekly + monthly series with a Contract column.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd

# NSE: first Nifty weekly options trading day / first weekly expiry Thursday.
NIFTY_WEEKLY_START = date(2019, 2, 11)
NIFTY_FIRST_WEEKLY_EXPIRY = date(2019, 2, 14)
# NSE: Nifty weekly + monthly expiry day moves Thursday → Tuesday.
TUESDAY_EXPIRY_ERA_START = date(2025, 9, 1)


def _to_date(x) -> date:
    if isinstance(x, date) and not isinstance(x, datetime):
        return x
    return pd.Timestamp(x).date()


def expiry_weekday_for(d: date) -> int:
    """Contract weekday for a calendar date: Tue=1 from Sep-2025, else Thu=3."""
    return 1 if d >= TUESDAY_EXPIRY_ERA_START else 3


def trading_day_on_or_before(day: date, trading: set[date], *, limit: int = 12) -> date | None:
    d = day
    for _ in range(limit):
        if d in trading:
            return d
        d -= timedelta(days=1)
    return None


def last_weekday_on_or_before(month_end: date, weekday: int, trading: set[date]) -> date | None:
    """Last `weekday` (Mon=0 … Sun=6) on/before month_end, floored to a trading day."""
    d = month_end
    while d.weekday() != weekday:
        d -= timedelta(days=1)
    return trading_day_on_or_before(d, trading)


def last_thursday_on_or_before(month_end: date, trading: set[date]) -> date | None:
    """NSE monthly style through Aug-2025: last Thursday floored to a trading day."""
    return last_weekday_on_or_before(month_end, 3, trading)


def last_monthly_expiry_on_or_before(
    month_end: date,
    trading: set[date],
    *,
    asof: date | None = None,
) -> date | None:
    """Last monthly Nifty option expiry in that month (Thu era → Tue era).

    If `asof` is set (usually last Nifty date), skip months whose scheduled
    expiry weekday is still in the future — do not floor a future Tuesday onto
    today's spot date.
    """
    weekday = expiry_weekday_for(month_end)
    d = month_end
    while d.weekday() != weekday:
        d -= timedelta(days=1)
    if asof is not None and d > asof:
        return None
    return trading_day_on_or_before(d, trading)


def month_ends(start: date, end: date) -> list[date]:
    out: list[date] = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        if m == 12:
            nxt = date(y + 1, 1, 1)
        else:
            nxt = date(y, m + 1, 1)
        out.append(nxt - timedelta(days=1))
        y, m = nxt.year, nxt.month
    return out


def build_monthly_expiries(
    trading_dates: list[date],
    *,
    option_overrides: list[date] | None = None,
    shift_overrides: list[date] | None = None,
    start: date | None = None,
    end: date | None = None,
) -> list[date]:
    """
    One expiry per calendar month from `start` through `end` (monthly last).

    Priority per month:
      1. Excel option expiry if present (authoritative historical)
      2. Futures shift date if present (same monthly calendar in Notes)
      3. Dynamic last Thu / last Tue trading day for that month

    Every date is snapped onto the Nifty trading calendar (NSE: if the
    scheduled weekday is a holiday, expiry is the previous trading day).
    """
    if not trading_dates:
        return []
    start = start or date(2001, 1, 1)
    end = end or trading_dates[-1]
    trading = set(trading_dates)

    def snap(d: date) -> date | None:
        hit = trading_day_on_or_before(d, trading)
        if hit is None or hit < start or hit > end:
            return None
        return hit

    by_ym: dict[tuple[int, int], date] = {}

    def put(raw: date, *, allow_stale_thursday: bool) -> None:
        # Drop pre-era Thursday seeds that leaked into the Tuesday era.
        if raw >= TUESDAY_EXPIRY_ERA_START and raw.weekday() == 3 and not allow_stale_thursday:
            return
        hit = snap(raw)
        if hit is None:
            return
        by_ym[(hit.year, hit.month)] = hit

    for d in shift_overrides or []:
        put(d, allow_stale_thursday=False)
    for d in option_overrides or []:
        put(d, allow_stale_thursday=False)

    for me in month_ends(start, end):
        key = (me.year, me.month)
        if key in by_ym:
            if by_ym[key] > end:
                del by_ym[key]
            else:
                continue
        dyn = last_monthly_expiry_on_or_before(me, trading, asof=end)
        if dyn is not None and dyn >= start:
            by_ym[key] = dyn

    return [by_ym[k] for k in sorted(by_ym)]


def pin_current_month_roll_to_latest(
    shifts: list[date],
    trading_dates: list[date],
) -> list[date]:
    """Set the open/terminal month's futures roll date to its latest Nifty session.

    Desk rule for Futures Roll Cost (same as Backtester):
      - Finished months keep monthly option-expiry shifts (WF1 Roll Cost col B /
        NSE last-Thu / last-Tue) so history stays WF1-aligned.
      - The current (terminal) month uses the **last / current trading date**
        present in nifty_daily.csv for that month — not an earlier monthly
        option expiry while later sessions already exist.

    First-row Excel gap (Jan-2001): trading-day count on/before first shift is
    **19** (2001-01-01 … 2001-01-25 inclusive) → C3 = avg×7%×19/365 ≈ 4.7713.

    Hedging Sheet monthly expiries are separate — do not use this helper for them.
    """
    if not trading_dates:
        return list(shifts)
    end = trading_dates[-1]
    out = [d for d in shifts if (d.year, d.month) != (end.year, end.month)]
    out.append(end)
    return sorted(out)


def build_all_option_expiries(
    trading_dates: list[date],
    *,
    monthly_expiries: list[date] | None = None,
    start: date | None = None,
    end: date | None = None,
) -> list[date]:
    """
    Full Nifty option expiry list since 2001:
      - Monthly-only before weekly options (pre 2019-02-14)
      - Every weekly Thursday (floored) from first weekly through Aug-2025
      - Every weekly Tuesday (floored) from Sep-2025 through `end`
      - Always includes the monthly-last set (Hedging Sheet / roll calendar)
    """
    if not trading_dates:
        return []
    start = start or date(2001, 1, 1)
    end = end or trading_dates[-1]
    trading = set(trading_dates)
    monthly = monthly_expiries or build_monthly_expiries(
        trading_dates, start=start, end=end
    )
    out: set[date] = set()
    for d in monthly:
        if start <= d <= end and d in trading:
            out.add(d)
        else:
            hit = trading_day_on_or_before(d, trading)
            if hit is not None and start <= hit <= end:
                out.add(hit)

    # Thursday weeklies: first weekly expiry → last Thursday-era day.
    thu_end = min(end, TUESDAY_EXPIRY_ERA_START - timedelta(days=1))
    if thu_end >= NIFTY_FIRST_WEEKLY_EXPIRY:
        d = NIFTY_FIRST_WEEKLY_EXPIRY
        # Align to Thursday.
        while d.weekday() != 3:
            d += timedelta(days=1)
        while d <= thu_end:
            hit = trading_day_on_or_before(d, trading)
            if hit is not None and hit >= NIFTY_FIRST_WEEKLY_EXPIRY and hit <= thu_end:
                out.add(hit)
            d += timedelta(days=7)

    # Tuesday weeklies: Sep-2025 onward.
    if end >= TUESDAY_EXPIRY_ERA_START:
        d = TUESDAY_EXPIRY_ERA_START
        while d.weekday() != 1:
            d += timedelta(days=1)
        while d <= end:
            hit = trading_day_on_or_before(d, trading)
            if hit is not None and hit >= TUESDAY_EXPIRY_ERA_START and hit <= end:
                out.add(hit)
            d += timedelta(days=7)

    return sorted(out)


def monthly_last_set(all_expiries: list[date]) -> set[date]:
    """Last option expiry date in each calendar month (monthly contract)."""
    by_ym: dict[tuple[int, int], date] = {}
    for d in all_expiries:
        key = (d.year, d.month)
        prev = by_ym.get(key)
        if prev is None or d > prev:
            by_ym[key] = d
    return set(by_ym.values())


def write_expiries_csv(path: Path, expiries: list[date]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        f.write("expiry_date\n")
        for d in expiries:
            f.write(f"{d.isoformat()}\n")


def read_dates_csv(path: Path, column: str | None = None) -> list[date]:
    if not path.exists():
        return []
    df = pd.read_csv(path)
    col = column or df.columns[0]
    if col not in df.columns:
        col = df.columns[0]
    return sorted({_to_date(x) for x in df[col].dropna()})
