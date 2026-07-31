"""Market data store: Nifty closes, monthly expiries (from 2001), roll costs."""
from __future__ import annotations

from bisect import bisect_left
from dataclasses import dataclass, field
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

from .calendar_build import (
    build_all_option_expiries,
    build_monthly_expiries,
    pin_current_month_roll_to_latest,
    read_dates_csv,
    write_expiries_csv,
)

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "data"
OVERRIDES = DATA / "expiry_overrides.csv"  # optional Excel Expiry sheet dump (clean)


def _to_date(x) -> date:
    if isinstance(x, date) and not isinstance(x, datetime):
        return x
    return pd.Timestamp(x).date()


@dataclass
class MarketDB:
    dates: list[date]
    closes: np.ndarray
    date_to_idx: dict[date, int]
    expiries: list[date]  # monthly-last calendar from 2001 (HS observation mapping)
    all_expiries: list[date]  # full weekly + monthly option expiries from 2001
    roll_shifts: list[date]  # futures monthly shifts (= monthly option expiry; Notes / NSE)
    roll_by_expiry: dict[date, float]
    # Parallel to dates — roll cost on shift days, else 0 (built once at load).
    roll_on_date: np.ndarray = field(default_factory=lambda: np.zeros(0))
    # Last expiry in each (year, month) — O(1) Hedging Sheet observation map.
    expiry_by_month: dict[tuple[int, int], date] = field(default_factory=dict)
    # Monthly-last dates within all_expiries (same membership as expiries).
    monthly_last_expiries: set[date] = field(default_factory=set)

    def nifty_on(self, d: date) -> float:
        if d in self.date_to_idx:
            return float(self.closes[self.date_to_idx[d]])
        idx = self._floor_idx(d)
        if idx < 0:
            raise KeyError(f"No Nifty on/before {d}")
        return float(self.closes[idx])

    def spots_for_dates(self, path_dates: list[date]) -> np.ndarray:
        """Fast spot vector for a contiguous trading-day path (or arbitrary dates)."""
        if not path_dates:
            return np.zeros(0, dtype=float)
        i0 = self.date_to_idx.get(path_dates[0])
        i1 = self.date_to_idx.get(path_dates[-1])
        if (
            i0 is not None
            and i1 is not None
            and i1 - i0 + 1 == len(path_dates)
            and self.dates[i0] == path_dates[0]
            and self.dates[i1] == path_dates[-1]
        ):
            return self.closes[i0 : i1 + 1].astype(float, copy=False)
        return np.array([self.nifty_on(d) for d in path_dates], dtype=float)

    def rolls_for_dates(self, path_dates: list[date]) -> np.ndarray:
        """Roll cost on each path date (0 when not a futures shift)."""
        if not path_dates or self.roll_on_date.size == 0:
            out = np.zeros(len(path_dates), dtype=float)
            for i, d in enumerate(path_dates):
                out[i] = self.roll_by_expiry.get(d, 0.0)
            return out
        i0 = self.date_to_idx.get(path_dates[0])
        i1 = self.date_to_idx.get(path_dates[-1])
        if (
            i0 is not None
            and i1 is not None
            and i1 - i0 + 1 == len(path_dates)
        ):
            return self.roll_on_date[i0 : i1 + 1].astype(float, copy=False)
        out = np.zeros(len(path_dates), dtype=float)
        for i, d in enumerate(path_dates):
            idx = self.date_to_idx.get(d)
            out[i] = float(self.roll_on_date[idx]) if idx is not None else self.roll_by_expiry.get(d, 0.0)
        return out

    def _floor_idx(self, d: date) -> int:
        lo, hi = 0, len(self.dates) - 1
        ans = -1
        while lo <= hi:
            mid = (lo + hi) // 2
            if self.dates[mid] <= d:
                ans = mid
                lo = mid + 1
            else:
                hi = mid - 1
        return ans

    def trading_days_between(self, start: date, end: date) -> list[date]:
        i0 = self._floor_idx(start)
        if i0 < 0:
            i0 = 0
        if self.dates[i0] < start:
            i0 += 1
        i1 = self._floor_idx(end)
        if i1 < 0:
            return []
        return self.dates[i0 : i1 + 1]

    def first_expiry_on_or_after(self, target: date) -> date:
        i = bisect_left(self.expiries, target)
        if i >= len(self.expiries):
            raise ValueError(
                f"No Nifty expiry on or after {target.isoformat()} "
                f"(calendar ends {self.expiries[-1].isoformat() if self.expiries else 'empty'})"
            )
        return self.expiries[i]

    @property
    def first_date(self) -> date:
        return self.dates[0]

    @property
    def last_date(self) -> date:
        return self.dates[-1]


def _recompute_roll_costs(dates: list[date], closes: np.ndarray, shifts: list[date]) -> dict[date, float]:
    """WF1 / Notes 7% futures carry on monthly shift dates.

    ``dates`` / ``closes`` are the **trading-day** series only (Sat/Sun and other
    non-sessions are absent — never averaged, never counted as trading days).

    First shift (seed month)::

        avg = mean(Nifty closes on trading days with date ≤ first_shift)
        N   = count of those trading days   (e.g. 19 for 2001-01-01…2001-01-25)
        roll = avg × 7% × N / 365

    Later shifts::

        avg = mean(Nifty closes on trading days in (prev_shift, shift])
        Δt  = calendar days between shifts  (includes Sat/Sun — Excel (B_k−B_{k-1}))
        roll = avg × 7% × Δt / 365

    So weekends are excluded from the spot average always; they are excluded from
    the *first* day-count (trading days) and included in later day-counts
    (calendar span), matching Working File 1.
    """
    date_arr = np.array(dates, dtype="datetime64[D]")
    close_arr = closes.astype(float)
    roll: dict[date, float] = {}
    prev = None
    for exp in shifts:
        if prev is None:
            mask = date_arr <= np.datetime64(exp)
            if not mask.any():
                prev = exp
                continue
            avg = float(close_arr[mask].mean())
            trading_days = int(mask.sum())
            roll[exp] = avg * 0.07 * trading_days / 365.0
        else:
            mask = (date_arr > np.datetime64(prev)) & (date_arr <= np.datetime64(exp))
            if not mask.any():
                roll[exp] = 0.0
            else:
                avg = float(close_arr[mask].mean())
                days = (exp - prev).days  # calendar Δt (Sat/Sun included)
                roll[exp] = avg * 0.07 * days / 365.0
        prev = exp
    return roll


def path_roll_vector(
    path_dates: list[date],
    spots: np.ndarray,
    roll_shifts: list[date],
) -> tuple[np.ndarray, dict[date, float]]:
    """Roll *points* for one GBM path from that path's simulated Nifty.

    Calendar shift *dates* come from the shared forward calendar (month-end
    trading days). Spot averages — and therefore roll points — use only this
    path's dates/spots. There is no shared Path-1 price database for forward
    rolls: each Monte Carlo path has its own Nifty path and its own roll costs.
    """
    if not path_dates:
        return np.zeros(0, dtype=float), {}
    start, end = path_dates[0], path_dates[-1]
    shifts = [d for d in roll_shifts if start <= d <= end]
    model = _recompute_roll_costs(path_dates, np.asarray(spots, dtype=float), shifts)
    out = np.zeros(len(path_dates), dtype=float)
    idx = {d: i for i, d in enumerate(path_dates)}
    for d, cost in model.items():
        i = idx.get(d)
        if i is not None:
            out[i] = float(cost)
    return out, model


def path_nifty_on(path_dates: list[date], spots: np.ndarray, d: date) -> float | None:
    """Last simulated close on or before ``d`` within the path window."""
    if not path_dates:
        return None
    spots_arr = np.asarray(spots, dtype=float)
    best: float | None = None
    for i, pd in enumerate(path_dates):
        if pd <= d:
            best = float(spots_arr[i])
        else:
            break
    return best


def clear_market_cache() -> None:
    load_market.cache_clear()


def _load_roll_shifts() -> tuple[list[date], dict[date, float]]:
    roll_path = DATA / "roll_costs.csv"
    roll_by: dict[date, float] = {}
    shifts: list[date] = []
    if roll_path.exists():
        rdf = pd.read_csv(roll_path, parse_dates=["expiry_date"]).sort_values("expiry_date")
        for _, row in rdf.iterrows():
            d = _to_date(row["expiry_date"])
            shifts.append(d)
            roll_by[d] = float(row["roll_cost"])
    return shifts, roll_by


def _extend_shifts_through(dates: list[date], shifts: list[date]) -> list[date]:
    """Ensure one futures-shift month through last Nifty date (dynamic extension).

    Futures shift = monthly option expiry (Notes / NSE last-Thu / last-Tue).
    """
    if not dates:
        return list(shifts)
    return build_monthly_expiries(
        dates,
        start=date(2001, 1, 1),
        end=dates[-1],
    )


def _persist_roll_costs(shifts: list[date], roll_by: dict[date, float]) -> None:
    path = DATA / "roll_costs.csv"
    with path.open("w") as f:
        f.write("expiry_date,roll_cost\n")
        for d in shifts:
            f.write(f"{d.isoformat()},{roll_by[d]}\n")


def _persist_roll_costs_if_changed(shifts: list[date], roll_by: dict[date, float]) -> None:
    """Avoid rewriting roll_costs.csv on every cold load (slow on free disks)."""
    path = DATA / "roll_costs.csv"
    lines = ["expiry_date,roll_cost\n"] + [f"{d.isoformat()},{roll_by[d]}\n" for d in shifts]
    new_text = "".join(lines)
    if path.exists():
        try:
            if path.read_text() == new_text:
                return
        except Exception:
            pass
    path.write_text(new_text)


def _resolve_expiries(
    dates: list[date], shifts: list[date]
) -> tuple[list[date], list[date], set[date]]:
    """Monthly-last + full weekly/monthly calendars from 2001 → last Nifty month."""
    # Optional authoritative Excel Expiry dump (no duplicate cols)
    option_path = OVERRIDES if OVERRIDES.exists() else DATA / "nifty_expiries.csv"
    raw = read_dates_csv(option_path, "expiry_date")
    # If legacy CSV still has junk / starts at 2004 only, treat as option overrides
    option_overrides = [d for d in raw if d.year >= 2004] if raw else []
    # Prefer dedicated overrides file if present
    if OVERRIDES.exists():
        option_overrides = read_dates_csv(OVERRIDES, "expiry_date")

    # Monthly last = Hedging Sheet / roll-cost calendar (Notes: monthly expiries).
    expiries = build_monthly_expiries(
        dates,
        option_overrides=option_overrides,
        shift_overrides=shifts,
        start=date(2001, 1, 1),
        end=dates[-1],
    )
    all_expiries = build_all_option_expiries(
        dates,
        monthly_expiries=expiries,
        start=date(2001, 1, 1),
        end=dates[-1],
    )
    # Hedging Sheet / rolls use the authoritative monthly list (Excel overrides win).
    monthly_last = set(expiries)
    all_expiries = sorted(set(all_expiries) | monthly_last)

    # Persist monthly calendar (HS / rolls) only when content changes.
    out = DATA / "nifty_expiries.csv"
    new_text = "expiry_date\n" + "".join(f"{d.isoformat()}\n" for d in expiries)
    try:
        if not out.exists() or out.read_text() != new_text:
            out.write_text(new_text)
    except Exception:
        write_expiries_csv(out, expiries)

    all_out = DATA / "nifty_all_expiries.csv"
    all_text = "expiry_date\n" + "".join(f"{d.isoformat()}\n" for d in all_expiries)
    try:
        if not all_out.exists() or all_out.read_text() != all_text:
            all_out.write_text(all_text)
    except Exception:
        write_expiries_csv(all_out, all_expiries)

    return expiries, all_expiries, monthly_last


@lru_cache(maxsize=1)
def load_market() -> MarketDB:
    nifty = pd.read_csv(DATA / "nifty_daily.csv", parse_dates=["date"])
    nifty = nifty.dropna().sort_values("date").drop_duplicates("date")
    dates = [_to_date(d) for d in nifty["date"]]
    closes = nifty["close"].to_numpy(dtype=float)
    # Drop Excel-epoch / junk rows outside the desk trading era (UI also filters).
    keep = [i for i, d in enumerate(dates) if 2001 <= d.year <= 2100]
    if len(keep) != len(dates):
        dates = [dates[i] for i in keep]
        closes = closes[np.asarray(keep, dtype=int)]

    shifts, roll_seed = _load_roll_shifts()
    shifts = _extend_shifts_through(dates, shifts)
    expiries, all_expiries, monthly_last = _resolve_expiries(dates, shifts)

    # Finished months: futures shift = monthly option expiry (Notes / NSE).
    # Open terminal month: pin roll date to latest Nifty session (Backtester parity).
    # Hedging Sheet keeps `expiries` on true monthly-last option dates.
    shifts = pin_current_month_roll_to_latest(list(expiries), dates)

    model = _recompute_roll_costs(dates, closes, shifts)
    roll_by_expiry = {d: roll_seed.get(d, model.get(d, 0.0)) for d in shifts}
    _persist_roll_costs_if_changed(shifts, roll_by_expiry)

    date_to_idx = {d: i for i, d in enumerate(dates)}
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


def market_meta() -> dict:
    m = load_market()
    return {
        "first_date": m.first_date.isoformat(),
        "last_date": m.last_date.isoformat(),
        "trading_days": len(m.dates),
        "expiries": len(m.expiries),
        "all_expiries": len(m.all_expiries),
        "first_expiry": m.expiries[0].isoformat() if m.expiries else None,
        "last_expiry": m.expiries[-1].isoformat() if m.expiries else None,
        "roll_shifts": len(m.roll_shifts),
        "first_roll_shift": m.roll_shifts[0].isoformat() if m.roll_shifts else None,
        "last_roll_shift": m.roll_shifts[-1].isoformat() if m.roll_shifts else None,
        "first_roll_cost": m.roll_by_expiry.get(m.roll_shifts[0]) if m.roll_shifts else None,
    }
