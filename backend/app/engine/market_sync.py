"""Daily market refresh: Nifty closes + roll/expiry calendars through present."""
from __future__ import annotations

import logging
import threading
from datetime import date, datetime, timedelta

import pandas as pd

from .calendar_build import (
    build_all_option_expiries,
    build_monthly_expiries,
    read_dates_csv,
    write_expiries_csv,
)
from .market import (
    DATA,
    OVERRIDES,
    _extend_shifts_through,
    _recompute_roll_costs,
    _to_date,
    clear_market_cache,
    market_meta,
)

log = logging.getLogger(__name__)

NIFTY_CSV = DATA / "nifty_daily.csv"
ROLL_CSV = DATA / "roll_costs.csv"


def _fetch_nifty_yahoo(start: date, end: date) -> pd.DataFrame:
    """Download ^NSEI closes for [start, end]. Empty frame if unavailable.

    Hard-capped so a hung Yahoo call cannot freeze ``/api/sync`` (and thus Vercel).
    """
    try:
        import yfinance as yf
    except ImportError as e:
        raise RuntimeError("yfinance is required for daily Nifty sync") from e

    # yfinance end is exclusive
    end_exclusive = end + timedelta(days=1)

    result: dict[str, pd.DataFrame] = {}
    error: dict[str, BaseException] = {}

    def _run() -> None:
        try:
            raw = yf.download(
                "^NSEI",
                start=start.isoformat(),
                end=end_exclusive.isoformat(),
                progress=False,
                auto_adjust=True,
                threads=False,
            )
            if raw is None or len(raw) == 0:
                result["df"] = pd.DataFrame(columns=["date", "close"])
                return
            if isinstance(raw.columns, pd.MultiIndex):
                raw.columns = raw.columns.get_level_values(0)
            out = raw.reset_index()[["Date", "Close"]].rename(
                columns={"Date": "date", "Close": "close"}
            )
            out["date"] = pd.to_datetime(out["date"]).dt.date
            out["close"] = out["close"].astype(float)
            result["df"] = out.dropna()
        except BaseException as exc:  # noqa: BLE001 — surface into caller
            error["e"] = exc

    t = threading.Thread(target=_run, name="yahoo-nifty", daemon=True)
    t.start()
    t.join(timeout=20.0)
    if t.is_alive():
        log.warning("Nifty Yahoo fetch timed out after 20s (%s → %s)", start, end)
        return pd.DataFrame(columns=["date", "close"])
    if "e" in error:
        raise error["e"]
    return result.get("df", pd.DataFrame(columns=["date", "close"]))


def refresh_nifty_daily(*, today: date | None = None) -> dict:
    """Append missing Nifty closes through `today` (default: local today)."""
    today = today or date.today()
    DATA.mkdir(parents=True, exist_ok=True)
    if NIFTY_CSV.exists():
        existing = pd.read_csv(NIFTY_CSV, parse_dates=["date"]).dropna().sort_values("date")
        existing["date"] = existing["date"].map(_to_date)
        last = existing["date"].iloc[-1] if len(existing) else date(2001, 1, 1)
    else:
        existing = pd.DataFrame(columns=["date", "close"])
        last = date(2000, 12, 31)

    start = last + timedelta(days=1)
    added = 0
    if start <= today:
        try:
            fresh = _fetch_nifty_yahoo(start, today)
        except Exception as e:
            log.warning("Nifty Yahoo fetch failed: %s", e)
            fresh = pd.DataFrame(columns=["date", "close"])
        if len(fresh):
            # Drop any overlap / weekends already present
            have = set(existing["date"].tolist()) if len(existing) else set()
            fresh = fresh[~fresh["date"].isin(have)]
            if len(fresh):
                combined = pd.concat([existing, fresh], ignore_index=True)
                combined = combined.drop_duplicates("date").sort_values("date")
                combined.to_csv(NIFTY_CSV, index=False)
                added = len(fresh)
                existing = combined
    return {
        "added": added,
        "first_date": existing["date"].iloc[0].isoformat() if len(existing) else None,
        "last_date": existing["date"].iloc[-1].isoformat() if len(existing) else None,
        "trading_days": int(len(existing)),
    }


def extend_roll_and_expiry_calendars() -> dict:
    """Extend futures shifts + option expiries through last Nifty date; persist CSVs."""
    if not NIFTY_CSV.exists():
        return {"ok": False, "reason": "nifty_daily.csv missing"}

    nifty = pd.read_csv(NIFTY_CSV, parse_dates=["date"]).dropna().sort_values("date")
    dates = [_to_date(d) for d in nifty["date"]]
    closes = nifty["close"].to_numpy(dtype=float)
    end = dates[-1]

    # Seed shifts from existing roll CSV (Working File / prior sync)
    shifts: list[date] = []
    roll_seed: dict[date, float] = {}
    if ROLL_CSV.exists():
        rdf = pd.read_csv(ROLL_CSV, parse_dates=["expiry_date"]).sort_values("expiry_date")
        for _, row in rdf.iterrows():
            d = _to_date(row["expiry_date"])
            shifts.append(d)
            roll_seed[d] = float(row["roll_cost"])

    # Full monthly calendar to present (option expiry = futures shift).
    extended_shifts = _extend_shifts_through(dates, shifts)

    # Rebuild clean monthly + full expiry calendars first, then align rolls to it.
    option_overrides: list[date] = []
    if OVERRIDES.exists():
        option_overrides = read_dates_csv(OVERRIDES, "expiry_date")
    expiries = build_monthly_expiries(
        dates,
        option_overrides=option_overrides,
        shift_overrides=extended_shifts,
        start=date(2001, 1, 1),
        end=end,
    )
    # Notes / NSE: roll on monthly option expiry — not WF1 Roll-col quirks.
    extended_shifts = list(expiries)

    model = _recompute_roll_costs(dates, closes, extended_shifts)
    roll_by = {d: roll_seed.get(d, model.get(d, 0.0)) for d in extended_shifts}

    # Persist roll costs through present
    with ROLL_CSV.open("w") as f:
        f.write("expiry_date,roll_cost\n")
        for d in extended_shifts:
            f.write(f"{d.isoformat()},{roll_by[d]}\n")

    write_expiries_csv(DATA / "nifty_expiries.csv", expiries)
    all_expiries = build_all_option_expiries(
        dates,
        monthly_expiries=expiries,
        start=date(2001, 1, 1),
        end=end,
    )
    write_expiries_csv(DATA / "nifty_all_expiries.csv", sorted(set(all_expiries) | set(expiries)))

    return {
        "ok": True,
        "roll_shifts": len(extended_shifts),
        "first_roll": extended_shifts[0].isoformat() if extended_shifts else None,
        "last_roll": extended_shifts[-1].isoformat() if extended_shifts else None,
        "expiries": len(expiries),
        "all_expiries": len(all_expiries),
        "last_expiry": expiries[-1].isoformat() if expiries else None,
    }


def sync_market_to_present(*, force: bool = False) -> dict:
    """
    Daily desk sync:
      1) Append Nifty closes through today
      2) Extend roll + expiry calendars through last Nifty date
      3) Clear market cache so API reads fresh CSVs
    """
    nifty_info = refresh_nifty_daily()
    added = int(nifty_info.get("added") or 0)

    # Fast path on free hosts: if Nifty is already current, skip calendar rewrite + cache bust
    # unless force=True (manual sync script).
    if not force and added == 0 and ROLL_CSV.exists() and NIFTY_CSV.exists():
        try:
            last_nifty = nifty_info.get("last_date")
            rdf = pd.read_csv(ROLL_CSV, parse_dates=["expiry_date"])
            last_roll = _to_date(rdf["expiry_date"].iloc[-1]) if len(rdf) else None
            if last_nifty and last_roll:
                ln = date.fromisoformat(last_nifty) if isinstance(last_nifty, str) else last_nifty
                # Calendars are month-granular; same year-month ⇒ nothing to rebuild.
                if (last_roll.year, last_roll.month) >= (ln.year, ln.month):
                    meta = market_meta()
                    return {
                        "ok": True,
                        "synced_at": datetime.utcnow().isoformat() + "Z",
                        "nifty": nifty_info,
                        "calendars": {"ok": True, "skipped": True, "reason": "already current"},
                        "market": meta,
                        "force": force,
                        "skipped_heavy": True,
                    }
        except Exception:
            pass

    cal_info = extend_roll_and_expiry_calendars()
    clear_market_cache()
    meta = market_meta()
    return {
        "ok": True,
        "synced_at": datetime.utcnow().isoformat() + "Z",
        "nifty": nifty_info,
        "calendars": cal_info,
        "market": meta,
        "force": force,
        "skipped_heavy": False,
    }
