"""NAV / Computation engine — Excel Computation sheet parity."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

import numpy as np

from .market import MarketDB
from .product import (
    DEFAULT_BUY_BROKERAGE,
    DEFAULT_CASH_PCT,
    DEFAULT_CASH_RATE,
    DEFAULT_FEE_RATE,
    DEFAULT_GSEC_RATE,
    DEFAULT_SELL_BROKERAGE,
    DEFAULT_TAX_BENEFIT_RATE,
    ROLL_COST_BASE_RATE,
)

# Product Input Buy/Sell Brokerage is the sole futures Tx card (every day including day 0).
BUY_BROKERAGE = DEFAULT_BUY_BROKERAGE
SELL_BROKERAGE = DEFAULT_SELL_BROKERAGE
BUY_RATE = BUY_BROKERAGE
SELL_RATE = SELL_BROKERAGE
BUY_GST = 0.0
SELL_GST = 0.0


@dataclass
class NavResult:
    total: float
    invt: float
    mtm_futures: float
    cash_plus_int: float
    gsec: float
    transaction_cost: float
    fees: float
    irr: float
    tenure_days_used: int
    final_nav: float
    buy_cost: float = 0.0
    sell_cost: float = 0.0
    buy_brokerage: float = 0.0
    buy_gst: float = 0.0
    sell_brokerage: float = 0.0
    sell_gst: float = 0.0
    daily_dates: list[str] | None = None
    daily_nav: list[float] | None = None
    daily_delta: list[float] | None = None
    computation_rows: list[dict[str, Any]] | None = None
    cost_rows: list[dict[str, Any]] | None = None


def run_nav(
    market: MarketDB,
    path_dates: list[date],
    req_delta: np.ndarray,
    principal_cr: float = 100.0,
    cash_buffer_cr: float | None = None,
    gsec_rate: float = DEFAULT_GSEC_RATE,
    cash_rate: float = DEFAULT_CASH_RATE,
    fee_rate: float = DEFAULT_FEE_RATE,
    buy_brokerage: float = DEFAULT_BUY_BROKERAGE,
    sell_brokerage: float = DEFAULT_SELL_BROKERAGE,
    buy_rate: float | None = None,
    sell_rate: float | None = None,
    roll_rate: float = ROLL_COST_BASE_RATE,
    tax_benefit_rate: float = DEFAULT_TAX_BENEFIT_RATE,
    rate_switch_date: date | None = None,  # ignored — brokerage card throughout
    last_observation: date | None = None,
    store_series: bool = False,
    spots: np.ndarray | None = None,
) -> NavResult:
    """Run Computation NAV.

    Futures Tx uses Product Input Buy/Sell Brokerage on every day (including day 0).
    Cash day-0 = cash_buffer_cr (principal × cash_pct); Gsec opening = principal − cash.
    """
    del rate_switch_date  # desk uses one brokerage rate card throughout
    _ = buy_rate, sell_rate  # legacy kwargs accepted but unused for Tx
    n = len(path_dates)
    assert len(req_delta) == n

    if cash_buffer_cr is None:
        cash_buffer_cr = principal_cr * DEFAULT_CASH_PCT

    eff_buy = float(buy_brokerage)
    eff_sell = float(sell_brokerage)

    if spots is None:
        spots = market.spots_for_dates(path_dates)
    else:
        spots = np.asarray(spots, dtype=float)

    roll_on_day = market.rolls_for_dates(path_dates)
    # Scale precomputed roll_costs.csv (built at ROLL_COST_BASE_RATE) to product roll_rate.
    if ROLL_COST_BASE_RATE > 0 and abs(roll_rate - ROLL_COST_BASE_RATE) > 1e-15:
        roll_on_day = roll_on_day * (float(roll_rate) / ROLL_COST_BASE_RATE)
    if last_observation is not None:
        # Zero rolls after the last observation date (Excel Computation behaviour).
        d64 = np.asarray(path_dates, dtype="datetime64[D]")
        roll_on_day = np.where(d64 <= np.datetime64(last_observation), roll_on_day, 0.0)

    delta = np.asarray(req_delta, dtype=float)
    change = np.empty(n, dtype=float)
    change[0] = delta[0]
    change[1:] = delta[1:] - delta[:-1]

    fut_qty = change
    fut_cum = np.cumsum(fut_qty)

    mtm = np.zeros(n, dtype=float)
    mtm[1:] = fut_cum[:-1] * (spots[1:] - spots[:-1]) / 1e7
    roll_cost = -roll_on_day * fut_cum / 1e7
    tax_ben = roll_cost * float(tax_benefit_rate)

    day_gaps = np.zeros(n, dtype=float)
    if n > 1:
        day_gaps[1:] = np.diff(np.asarray(path_dates, dtype="datetime64[D]")).astype(float)

    cash = np.empty(n, dtype=float)
    cash[0] = cash_buffer_cr
    if n > 1:
        cash[1:] = cash_buffer_cr + np.cumsum(mtm[1:] + roll_cost[1:])

    int_cash = np.zeros(n, dtype=float)
    int_cash[1:] = cash[:-1] * cash_rate * day_gaps[1:] / 365.0

    growth = np.ones(n, dtype=float)
    growth[1:] = 1.0 + gsec_rate * day_gaps[1:] / 365.0
    gsec = (principal_cr - cash_buffer_cr) * np.cumprod(growth)
    int_gsec = np.zeros(n, dtype=float)
    int_gsec[1:] = np.maximum(gsec[1:] - gsec[:-1], 0.0)

    fees = np.zeros(n, dtype=float)
    fees[1:] = principal_cr * fee_rate * day_gaps[1:] / 365.0

    notional = np.abs(fut_qty) * spots / 1e7
    buy_mask = fut_qty > 0
    sell_mask = fut_qty < 0
    buy_cost = np.where(buy_mask, notional * eff_buy, 0.0)
    sell_cost = np.where(sell_mask, notional * eff_sell, 0.0)
    tx_fut = buy_cost + sell_cost
    buy_brokerage_amt = buy_cost.copy()
    sell_brokerage_amt = sell_cost.copy()
    buy_gst = np.zeros(n, dtype=float)
    sell_gst = np.zeros(n, dtype=float)

    # Excel Computation NAV: subtract today's tx and prior day's tx each step.
    tx_prev = np.zeros(n, dtype=float)
    tx_prev[1:] = tx_fut[:-1]
    nav_incr = mtm + roll_cost + int_cash + int_gsec - tx_fut - tx_prev - fees
    nav_post_fees = np.empty(n, dtype=float)
    nav_post_fees[0] = cash[0] + gsec[0]
    if n > 1:
        nav_post_fees[1:] = nav_post_fees[0] + np.cumsum(nav_incr[1:])

    sum_mtm = float(mtm.sum() + roll_cost.sum())
    sum_int_cash = float(int_cash.sum())
    cash_plus_int = cash_buffer_cr + sum_int_cash
    gsec_interest = float(gsec[-1] - gsec[0])
    sum_fees = float(fees.sum())
    sum_tx = float(tx_fut.sum())

    total = principal_cr + sum_mtm + cash_plus_int + gsec_interest - sum_tx - sum_fees
    tenure_used = (path_dates[-1] - path_dates[0]).days
    if tenure_used <= 0 or principal_cr <= 0:
        irr = 0.0
    else:
        ratio = total / principal_cr
        if ratio <= 0:
            irr = -1.0
        else:
            irr = float(ratio ** (365.0 / tenure_used) - 1.0)

    rows = None
    cost_rows = None
    if store_series:
        rows = []
        cost_rows = []
        for i in range(n):
            rows.append(
                {
                    "date": path_dates[i].isoformat(),
                    "nifty": float(spots[i]),
                    "req_delta": float(delta[i]),
                    "change_in_delta": float(change[i]),
                    "future_qty": float(fut_qty[i]),
                    "fut_cumulative": float(fut_cum[i]),
                    "mtm_futures": float(mtm[i]),
                    "rollover_cost": float(roll_cost[i]),
                    "tax_benefit": float(tax_ben[i]),
                    "cash_mtm": float(cash[i]),
                    "int_on_cash": float(int_cash[i]),
                    "gsec": float(gsec[i]),
                    "int_gsec": float(int_gsec[i]),
                    "tx_futures": float(tx_fut[i]),
                    "fees": float(fees[i]),
                    "nav": float(nav_post_fees[i]),
                    "tx_rate_card": "brokerage",
                }
            )
            cost_rows.append(
                {
                    "date": path_dates[i].isoformat(),
                    "side": "Buy" if fut_qty[i] > 0 else ("Sell" if fut_qty[i] < 0 else "—"),
                    "futures_qty": float(fut_qty[i]),
                    "nifty": float(spots[i]),
                    "buy_cost": float(buy_cost[i]),
                    "sell_cost": float(sell_cost[i]),
                    "brokerage": float(buy_brokerage_amt[i] + sell_brokerage_amt[i]),
                    "gst": 0.0,
                    "buy_brokerage": float(buy_brokerage_amt[i]),
                    "buy_gst": 0.0,
                    "sell_brokerage": float(sell_brokerage_amt[i]),
                    "sell_gst": 0.0,
                    "total_tx": float(tx_fut[i]),
                    "rate_card": "brokerage",
                    "eff_buy_rate": eff_buy,
                    "eff_sell_rate": eff_sell,
                }
            )

    return NavResult(
        total=total,
        invt=principal_cr,
        mtm_futures=sum_mtm,
        cash_plus_int=cash_plus_int,
        gsec=gsec_interest,
        transaction_cost=-sum_tx,
        fees=-sum_fees,
        irr=irr,
        tenure_days_used=tenure_used,
        final_nav=float(nav_post_fees[-1]),
        buy_cost=float(buy_cost.sum()),
        sell_cost=float(sell_cost.sum()),
        buy_brokerage=float(buy_brokerage_amt.sum()),
        buy_gst=0.0,
        sell_brokerage=float(sell_brokerage_amt.sum()),
        sell_gst=0.0,
        daily_dates=[d.isoformat() for d in path_dates] if store_series else None,
        daily_nav=nav_post_fees.tolist() if store_series else None,
        daily_delta=delta.tolist() if store_series else None,
        computation_rows=rows,
        cost_rows=cost_rows,
    )
