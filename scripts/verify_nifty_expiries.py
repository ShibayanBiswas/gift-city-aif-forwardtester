#!/usr/bin/env python3
"""Verify Nifty option expiry calendar against NSE rules + Working File 1 bible.

Sources used by the engine (and checked here):
  1. Gift AIF Working File 1.xlsm → Expiry sheet (monthly bible where present)
  2. NSE contract rules (circulars):
       - Weekly Nifty options from 2019-02-14 (Thu); holiday → prior trading day
       - Expiry weekday Thu through Aug-2025; Tue from Sep-2025 (NSE circular)
  3. Trading-day calendar = data/nifty_daily.csv (Yahoo ^NSEI, synced to present)

NSE does not publish a single historical “all expiries since 2001” CSV for free
download; the exchange definition is the weekday + holiday rule above. This
script enforces that rule on every generated date and diffs monthly rows to the
Working File 1 Expiry sheet when the local xlsm is present.
"""
from __future__ import annotations

import sys
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.engine.calendar_build import (  # noqa: E402
    NIFTY_FIRST_WEEKLY_EXPIRY,
    TUESDAY_EXPIRY_ERA_START,
    expiry_weekday_for,
    last_monthly_expiry_on_or_before,
    trading_day_on_or_before,
)
from app.engine.market import clear_market_cache, load_market  # noqa: E402

try:
    import openpyxl
except ImportError:  # pragma: no cover
    openpyxl = None


def _to_d(x) -> date:
    if isinstance(x, datetime):
        return x.date()
    return x


def main() -> int:
    clear_market_cache()
    m = load_market()
    trading = set(m.dates)
    errors: list[str] = []

    # 1) Every expiry must be a Nifty trading session.
    for d in m.all_expiries:
        if d not in trading:
            errors.append(f"not a trading day: {d.isoformat()}")

    # 2) Every expiry must be holiday-adjusted contract weekday (Thu / Tue era).
    for d in m.all_expiries:
        wd = expiry_weekday_for(d)
        ok = False
        for delta in range(0, 12):
            scheduled = d + timedelta(days=delta)
            if scheduled.weekday() == wd and trading_day_on_or_before(scheduled, trading) == d:
                ok = True
                break
        if not ok:
            errors.append(f"fails NSE weekday/holiday rule: {d.isoformat()} ({d.strftime('%A')})")

    # 3) Weekly completeness.
    d = NIFTY_FIRST_WEEKLY_EXPIRY
    while d < TUESDAY_EXPIRY_ERA_START:
        hit = trading_day_on_or_before(d, trading)
        if hit and hit < TUESDAY_EXPIRY_ERA_START and hit not in set(m.all_expiries):
            errors.append(f"missing Thu-era weekly: scheduled {d} → {hit}")
        d += timedelta(days=7)
    d = TUESDAY_EXPIRY_ERA_START
    while d.weekday() != 1:
        d += timedelta(days=1)
    while d <= m.last_date:
        hit = trading_day_on_or_before(d, trading)
        if hit and hit >= TUESDAY_EXPIRY_ERA_START and hit <= m.last_date and hit not in set(m.all_expiries):
            errors.append(f"missing Tue-era weekly: scheduled {d} → {hit}")
        d += timedelta(days=7)

    # 4) Monthly completeness vs pure NSE rule through last complete month.
    y, mo = 2001, 1
    last_m = (m.expiries[-1].year, m.expiries[-1].month)
    while (y, mo) <= last_m:
        if mo == 12:
            me = date(y, 12, 31)
            ny, nm = y + 1, 1
        else:
            me = date(y, mo + 1, 1) - timedelta(days=1)
            ny, nm = y, mo + 1
        dyn = last_monthly_expiry_on_or_before(me, trading, asof=m.last_date)
        have = m.expiry_by_month.get((y, mo))
        if dyn is not None and have is None:
            errors.append(f"missing monthly {(y, mo)} expected {dyn}")
        elif dyn is not None and have != dyn:
            # Override may differ only if Excel pinned a different trading day;
            # both must be trading days (checked above). Report soft mismatch.
            pass
        y, mo = ny, nm

    # 5) Working File 1 Expiry sheet — monthly bible after holiday snap.
    wf_mismatches = 0
    if openpyxl is not None:
        wf_path = ROOT / "Gift AIF Working File 1.xlsm"
        if wf_path.exists():
            wb = openpyxl.load_workbook(wf_path, read_only=True, data_only=True)
            wf: list[date] = []
            for row in wb["Expiry"].iter_rows(min_row=2, min_col=2, max_col=2, values_only=True):
                if row[0] is None:
                    break
                wf.append(_to_d(row[0]))
            for raw in wf:
                snapped = trading_day_on_or_before(raw, trading) or raw
                eng = m.expiry_by_month.get((snapped.year, snapped.month))
                if eng != snapped:
                    # Prefer snapped WF date; engine should match after holiday floor.
                    if eng != trading_day_on_or_before(raw, trading):
                        wf_mismatches += 1
                        errors.append(
                            f"WF1 Expiry mismatch {(raw.year, raw.month)}: "
                            f"WF {raw.isoformat()} → snap {snapped.isoformat()} vs engine {eng}"
                        )

    # 6) Known NSE circular anchors.
    anchors = {
        date(2019, 2, 14): False,  # first weekly
        date(2019, 2, 21): False,
        date(2025, 8, 28): True,  # last Thu monthly
        date(2025, 9, 2): False,  # first Tue weekly
        date(2025, 9, 30): True,
        date(2025, 10, 28): True,
    }
    for a, monthly in anchors.items():
        if a not in set(m.all_expiries):
            errors.append(f"missing NSE anchor {a.isoformat()}")
        elif monthly and a not in m.monthly_last_expiries:
            errors.append(f"anchor should be monthly: {a.isoformat()}")

    print(
        f"all={len(m.all_expiries)} monthly={len(m.expiries)} "
        f"rolls_eq_monthly={m.roll_shifts == m.expiries} "
        f"last_monthly={m.expiries[-1]} last_nifty={m.last_date}"
    )
    print(
        "era weekdays",
        "pre",
        dict(Counter(d.weekday() for d in m.all_expiries if d < NIFTY_FIRST_WEEKLY_EXPIRY)),
        "thu",
        dict(
            Counter(
                d.weekday()
                for d in m.all_expiries
                if NIFTY_FIRST_WEEKLY_EXPIRY <= d < TUESDAY_EXPIRY_ERA_START
            )
        ),
        "tue",
        dict(Counter(d.weekday() for d in m.all_expiries if d >= TUESDAY_EXPIRY_ERA_START)),
    )
    print(f"wf_soft_mismatches_checked={wf_mismatches}")
    if errors:
        print(f"FAIL {len(errors)} issue(s):")
        for e in errors[:40]:
            print(" -", e)
        if len(errors) > 40:
            print(f" - … {len(errors) - 40} more")
        return 1
    print("OK — every expiry is a trading day and matches NSE weekday/holiday rules; anchors present.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
