"""Gift AIF Forward Test orchestrator — GBM paths + hedge + NAV (desk parity)."""
from __future__ import annotations

import logging
from collections import defaultdict
from concurrent.futures import (
    CancelledError,
    ProcessPoolExecutor,
    ThreadPoolExecutor,
    as_completed,
)
from concurrent.futures.process import BrokenProcessPool
from dataclasses import asdict, dataclass
from datetime import date
from typing import Any, Callable

import numpy as np

from .gbm import GBM_BASE_SEED, GbmParams
from .hedge import hedge_path
from .market import MarketDB, path_nifty_on, path_roll_vector, load_market
from .mc_matrix import (
    build_mc_matrix,
    horizon_trading_dates,
    slice_path_spots,
)
from .nav import run_nav
from .paths import (
    Frequency,
    PathSpec,
    build_forward_market,
    build_paths,
    path_from_window,
    simulate_path_spots,
)
from .product import ProductSpec, resolved_simulation_end, resolved_simulation_end_days
from .runtime import forwardtest_parallelism

log = logging.getLogger(__name__)

ProgressCb = Callable[[float, str], None]
CancelCb = Callable[[], bool]


class ForwardTestCancelled(Exception):
    """Raised when a newer forward test supersedes this run."""


_WORKER_PRODUCT: ProductSpec | None = None
_WORKER_MARKET: MarketDB | None = None
_WORKER_PARAMS: GbmParams | None = None
_WORKER_FREQUENCY: Frequency = "daily"
_WORKER_DATES: list[date] | None = None
_WORKER_SEED: int = GBM_BASE_SEED


def _emit(on_progress: ProgressCb | None, pct: float, msg: str) -> None:
    if not on_progress:
        return
    try:
        on_progress(pct, msg)
    except Exception:
        log.debug("progress callback failed", exc_info=True)


@dataclass
class PathSummary:
    path_id: int
    start: str
    end: str
    invt: float
    mtm_futures: float
    cash_plus_int: float
    gsec: float
    transaction_cost: float
    fees: float
    total: float
    irr: float
    start_nifty: float
    end_nifty: float
    avg_obs_nifty: float
    abs_nifty_ret: float
    year: int
    n_trading_days: int
    buy_cost: float = 0.0
    sell_cost: float = 0.0
    buy_brokerage: float = 0.0
    buy_gst: float = 0.0
    sell_brokerage: float = 0.0
    sell_gst: float = 0.0


def _leg_dict(lg) -> dict:
    return {
        "raw_qty": lg.raw_qty,
        "strike_pct": lg.strike_pct,
        "strike": lg.strike,
        "expiry": lg.expiry.isoformat(),
        "option": "P" if lg.is_put else "C",
        "forward": lg.forward_rate,
        "discount": lg.discount_rate,
        "vol": lg.vol,
        "quantity": lg.quantity,
    }


def _obs_dict(b) -> dict:
    return {
        "month": b.month,
        "offset_days": b.offset_days,
        "target_date": b.target_date.isoformat(),
        "expiry": b.expiry.isoformat(),
        "nifty": b.nifty,
    }


def _resolve_spots(
    path: PathSpec,
    params: GbmParams | None,
    frequency: Frequency,
    *,
    horizon_dates: list[date] | None = None,
    base_seed: int = GBM_BASE_SEED,
) -> np.ndarray:
    if path.spots is not None and len(path.spots) == len(path.dates):
        return np.asarray(path.spots, dtype=float)
    if params is None:
        raise RuntimeError(f"Path {path.path_id} has no GBM spots and no params to regenerate")
    return simulate_path_spots(
        path.dates,
        params,
        path.path_id,
        frequency=frequency,
        horizon_dates=horizon_dates,
        base_seed=base_seed,
    )


def _evaluate_path(
    path: PathSpec,
    product: ProductSpec,
    market: MarketDB,
    store: bool,
    *,
    params: GbmParams | None = None,
    frequency: Frequency = "daily",
    horizon_dates: list[date] | None = None,
    base_seed: int = GBM_BASE_SEED,
) -> tuple[PathSummary, dict | None]:
    if not path.dates:
        raise RuntimeError(f"Path {path.path_id} has no trading days ({path.start} → {path.end})")
    spots = _resolve_spots(
        path, params, frequency, horizon_dates=horizon_dates, base_seed=base_seed
    )
    if len(spots) != len(path.dates):
        raise RuntimeError(f"Path {path.path_id}: spot series length mismatch")
    # Roll *dates* from shared forward calendar; roll *points* from this path's GBM spots.
    roll_vec, roll_by = path_roll_vector(path.dates, spots, market.roll_shifts)
    hedge = hedge_path(market, product, path.dates, spots=spots)
    nav = run_nav(
        market,
        path.dates,
        hedge.req_delta,
        principal_cr=product.principal_cr,
        cash_buffer_cr=product.cash_buffer_cr,
        gsec_rate=product.gsec_rate,
        cash_rate=product.cash_rate,
        fee_rate=product.fee_rate,
        buy_rate=product.buy_rate,
        buy_brokerage=product.buy_brokerage,
        sell_rate=product.sell_rate,
        sell_brokerage=product.sell_brokerage,
        roll_rate=product.roll_rate,
        tax_benefit_rate=product.tax_benefit_rate,
        rate_switch_date=product.rate_switch_date,
        last_observation=hedge.last_observation,
        store_series=store,
        spots=spots,
        roll_on_day=roll_vec,
    )
    start_nifty = hedge.spot0
    end_nifty = float(spots[-1])
    avg_obs = float(np.mean(hedge.obs_spots)) if hedge.obs_spots else start_nifty
    abs_ret = avg_obs / start_nifty - 1.0 if start_nifty else 0.0
    summary = PathSummary(
        path_id=path.path_id,
        start=path.start.isoformat(),
        end=path.end.isoformat(),
        invt=nav.invt,
        mtm_futures=nav.mtm_futures,
        cash_plus_int=nav.cash_plus_int,
        gsec=nav.gsec,
        transaction_cost=nav.transaction_cost,
        fees=nav.fees,
        total=nav.total,
        irr=nav.irr,
        start_nifty=start_nifty,
        end_nifty=end_nifty,
        avg_obs_nifty=avg_obs,
        abs_nifty_ret=abs_ret,
        year=path.start.year,
        n_trading_days=len(path.dates),
        buy_cost=nav.buy_cost,
        sell_cost=nav.sell_cost,
        buy_brokerage=nav.buy_brokerage,
        buy_gst=nav.buy_gst,
        sell_brokerage=nav.sell_brokerage,
        sell_gst=nav.sell_gst,
    )
    detail = (
        _detail_payload(path, hedge, nav, summary, spots, market, roll_by)
        if store
        else None
    )
    return summary, detail


def _init_worker(payload: dict[str, Any]) -> None:
    global _WORKER_PRODUCT, _WORKER_MARKET, _WORKER_PARAMS, _WORKER_FREQUENCY, _WORKER_DATES, _WORKER_SEED

    _WORKER_PRODUCT = ProductSpec.from_dict(payload["product"])
    base = load_market()
    frequency = payload["frequency"]
    _WORKER_FREQUENCY = frequency
    _WORKER_SEED = int(payload.get("base_seed", GBM_BASE_SEED))
    sim_end_raw = payload.get("simulation_end") or resolved_simulation_end(
        base.last_date, _WORKER_PRODUCT
    )
    if isinstance(sim_end_raw, str):
        sim_end = date.fromisoformat(sim_end_raw[:10])
    else:
        sim_end = sim_end_raw
    fwd, params = build_forward_market(
        base,
        sim_end,
        _WORKER_PRODUCT.tenure_days,
        observation_months=_WORKER_PRODUCT.observation_months,
    )
    _WORKER_MARKET = fwd
    raw_dates = payload.get("horizon_dates") or []
    _WORKER_DATES = [date.fromisoformat(str(x)[:10]) for x in raw_dates] or None
    if _WORKER_DATES is None:
        asof = base.last_date
        _WORKER_DATES = fwd.trading_days_between(asof, sim_end)
    _WORKER_PARAMS = params
    raw = payload.get("gbm")
    if raw:
        _WORKER_PARAMS = GbmParams(
            spot0=float(raw["spot0"]),
            asof=str(raw["asof"]),
            mean_return=float(raw["mean_return"]),
            std_dev=float(raw["std_dev"]),
            drift=float(raw["drift"]),
            n_returns=int(raw["n_returns"]),
            first_date=str(raw["first_date"]),
            last_date=str(raw["last_date"]),
        )


def _eval_chunk(windows: list[tuple[int, str, str]]) -> list[dict[str, Any]]:
    """Evaluate a batch of (path_id, start, end) staggered tenure windows."""
    assert _WORKER_PRODUCT is not None and _WORKER_MARKET is not None
    assert _WORKER_PARAMS is not None
    product = _WORKER_PRODUCT
    market = _WORKER_MARKET
    out: list[dict[str, Any]] = []
    for path_id, start_s, end_s in windows:
        path = path_from_window(
            market,
            path_id,
            start_s,
            end_s,
            params=_WORKER_PARAMS,
            frequency=_WORKER_FREQUENCY,
            base_seed=_WORKER_SEED,
            horizon_dates=_WORKER_DATES,
        )
        if path is None:
            raise RuntimeError(f"Could not rebuild path {path_id} ({start_s} → {end_s})")
        summary, _ = _evaluate_path(
            path,
            product,
            market,
            store=False,
            params=_WORKER_PARAMS,
            frequency=_WORKER_FREQUENCY,
            horizon_dates=_WORKER_DATES,
            base_seed=_WORKER_SEED,
        )
        out.append(asdict(summary))
    return out


def _chunked(items: list, size: int) -> list[list]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def _run_serial(
    product: ProductSpec,
    market: MarketDB,
    paths: list[PathSpec],
    store_ids: set[int],
    on_progress: ProgressCb | None,
    should_cancel: CancelCb | None = None,
    *,
    params: GbmParams,
    frequency: Frequency,
    horizon_dates: list[date] | None = None,
    base_seed: int = GBM_BASE_SEED,
) -> tuple[list[PathSummary], dict[int, dict]]:
    n = len(paths)
    summaries: list[PathSummary] = []
    details: dict[int, dict] = {}
    progress_every = max(1, min(25, n // 100)) if n >= 100 else 1
    for i, path in enumerate(paths, start=1):
        if should_cancel and should_cancel():
            raise ForwardTestCancelled("Forward test cancelled — a newer run was started.")
        summary, detail = _evaluate_path(
            path,
            product,
            market,
            path.path_id in store_ids,
            params=params,
            frequency=frequency,
            horizon_dates=horizon_dates,
            base_seed=base_seed,
        )
        summaries.append(summary)
        if detail is not None:
            details[summary.path_id] = detail
        if i % progress_every == 0 or i == n:
            _emit(
                on_progress,
                5.0 + 90.0 * i / n,
                (
                    f"Path {i} of {n} · path {path.path_id} · "
                    f"{path.start.isoformat()} → {path.end.isoformat()}"
                ),
            )
    return summaries, details


def _run_parallel_processes(
    product: ProductSpec,
    paths: list[PathSpec],
    workers: int,
    on_progress: ProgressCb | None,
    should_cancel: CancelCb | None = None,
    *,
    params: GbmParams,
    frequency: Frequency,
    base_seed: int,
    simulation_end: date,
    horizon_dates: list[date] | None = None,
) -> list[PathSummary]:
    n = len(paths)
    windows = [(p.path_id, p.start.isoformat(), p.end.isoformat()) for p in paths]
    chunk_size = max(8, min(64, (n + workers - 1) // (workers * 4) or 8))
    chunks = _chunked(windows, chunk_size)
    summaries_by_id: dict[int, PathSummary] = {}
    done = 0
    progress_every = max(1, min(25, n // 100)) if n >= 100 else 1
    last_meta = (paths[0].path_id, paths[0].start, paths[0].end)

    init_payload = {
        "product": product.to_dict(),
        "frequency": frequency,
        "gbm": params.to_dict(),
        "base_seed": base_seed,
        "simulation_end": simulation_end.isoformat(),
        "horizon_dates": [d.isoformat() for d in (horizon_dates or [])],
    }
    pool = ProcessPoolExecutor(
        max_workers=workers,
        initializer=_init_worker,
        initargs=(init_payload,),
    )
    cancelled = False
    try:
        futures = {pool.submit(_eval_chunk, chunk): chunk for chunk in chunks}
        for fut in as_completed(futures):
            if should_cancel and should_cancel():
                cancelled = True
                for pending in futures:
                    pending.cancel()
                raise ForwardTestCancelled("Forward test cancelled — a newer run was started.")
            try:
                rows = fut.result()
            except CancelledError as e:
                cancelled = True
                raise ForwardTestCancelled("Forward test cancelled — a newer run was started.") from e
            except BrokenProcessPool as e:
                if should_cancel and should_cancel():
                    cancelled = True
                    raise ForwardTestCancelled("Forward test cancelled — a newer run was started.") from e
                raise RuntimeError("Forward test worker pool crashed — please run again.") from e
            for row in rows:
                try:
                    summary = PathSummary(**row)
                except TypeError as e:
                    raise RuntimeError(
                        f"Incomplete path result from worker (path {row.get('path_id')}): {e}"
                    ) from e
                summaries_by_id[summary.path_id] = summary
                done += 1
                if done % progress_every == 0 or done == n:
                    _emit(
                        on_progress,
                        5.0 + 90.0 * done / n,
                        (
                            f"Path {done} of {n} · path {summary.path_id} · "
                            f"{summary.start} → {summary.end}"
                        ),
                    )
    finally:
        try:
            pool.shutdown(wait=not cancelled, cancel_futures=cancelled)
        except Exception:
            log.debug("process pool shutdown issue", exc_info=True)
    missing = [p.path_id for p in paths if p.path_id not in summaries_by_id]
    if missing:
        raise RuntimeError(f"Forward test incomplete — missing {len(missing)} paths (e.g. {missing[:5]})")
    return [summaries_by_id[p.path_id] for p in paths]


def _run_parallel_threads(
    product: ProductSpec,
    market: MarketDB,
    paths: list[PathSpec],
    workers: int,
    store_ids: set[int],
    on_progress: ProgressCb | None,
    should_cancel: CancelCb | None = None,
    *,
    params: GbmParams,
    frequency: Frequency,
    horizon_dates: list[date] | None = None,
    base_seed: int = GBM_BASE_SEED,
) -> tuple[list[PathSummary], dict[int, dict]]:
    n = len(paths)
    summaries_by_id: dict[int, PathSummary] = {}
    details: dict[int, dict] = {}
    done = 0
    progress_every = max(1, min(25, n // 100)) if n >= 100 else 1

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(
                _evaluate_path,
                path,
                product,
                market,
                path.path_id in store_ids,
                params=params,
                frequency=frequency,
                horizon_dates=horizon_dates,
                base_seed=base_seed,
            ): path
            for path in paths
        }
        for fut in as_completed(futures):
            if should_cancel and should_cancel():
                for pending in futures:
                    pending.cancel()
                raise ForwardTestCancelled("Forward test cancelled — a newer run was started.")
            path = futures[fut]
            try:
                summary, detail = fut.result()
            except CancelledError as e:
                raise ForwardTestCancelled("Forward test cancelled — a newer run was started.") from e
            except Exception as e:
                raise RuntimeError(
                    f"Path {path.path_id} failed ({path.start} → {path.end}): {e}"
                ) from e
            summaries_by_id[summary.path_id] = summary
            if detail is not None:
                details[summary.path_id] = detail
            done += 1
            if done % progress_every == 0 or done == n:
                _emit(
                    on_progress,
                    5.0 + 90.0 * done / n,
                    (
                        f"Path {done} of {n} · path {path.path_id} · "
                        f"{path.start.isoformat()} → {path.end.isoformat()}"
                    ),
                )
    missing = [p.path_id for p in paths if p.path_id not in summaries_by_id]
    if missing:
        raise RuntimeError(f"Forward test incomplete — missing {len(missing)} paths (e.g. {missing[:5]})")
    return [summaries_by_id[p.path_id] for p in paths], details


def run_forwardtest(
    product: ProductSpec,
    frequency: Frequency = "daily",
    market: MarketDB | None = None,
    on_progress: ProgressCb | None = None,
    detail_path_ids: set[int] | None = None,
    should_cancel: CancelCb | None = None,
    base_seed: int = GBM_BASE_SEED,
) -> dict:
    """Run Monte Carlo forward test over as-of → simulation_end path atlas."""
    market = market or load_market()
    if should_cancel and should_cancel():
        raise ForwardTestCancelled("Forward test cancelled — a newer run was started.")
    if not product.observation_months:
        raise ValueError("Product must define at least one observation month")
    if not product.active_legs:
        raise ValueError("Product must have at least one active option leg")
    _emit(on_progress, 2.0, "Estimating parameters and building calendar…")

    sim_end = resolved_simulation_end(market.last_date, product)
    # Don't attach spots during build_paths — slice from the full MC matrix below
    # so every path_id shares one as-of → Simulation End Z-stream (Excel layout).
    paths, fwd_market, params, horizon = build_paths(
        market,
        product.tenure_days,
        frequency,
        observation_months=product.observation_months,
        product=product,
        simulation_end=sim_end,
        base_seed=base_seed,
        attach_spots=False,
    )

    if not paths:
        raise RuntimeError("No forward paths generated")
    if should_cancel and should_cancel():
        raise ForwardTestCancelled("Forward test cancelled — a newer run was started.")

    asof = date.fromisoformat(params.asof)
    horizon_dates = horizon_trading_dates(fwd_market.dates, asof, horizon)
    if not horizon_dates:
        raise RuntimeError("No trading dates on MC horizon (as-of → Simulation End)")

    n_paths = max(p.path_id for p in paths)
    _emit(
        on_progress,
        3.5,
        f"Building Monte Carlo Nifty matrix · {n_paths} paths",
    )
    mc_matrix = build_mc_matrix(params, horizon_dates, n_paths, base_seed=base_seed)
    for p in paths:
        p.spots = slice_path_spots(mc_matrix, horizon_dates, p.dates, p.path_id)

    n = len(paths)
    store_ids = detail_path_ids or set()
    details: dict[int, dict] = {}

    mode, workers = forwardtest_parallelism(n)
    if store_ids and mode == "processes":
        mode = "threads"
        workers = min(workers, 4)
    if n >= 5000 and mode == "serial":
        mode, workers = forwardtest_parallelism(n)

    _emit(
        on_progress,
        5.0,
        f"Running {n} {frequency} paths",
    )

    if mode == "serial" or workers == 1:
        summaries, details = _run_serial(
            product,
            fwd_market,
            paths,
            store_ids,
            on_progress,
            should_cancel=should_cancel,
            params=params,
            frequency=frequency,
            horizon_dates=horizon_dates,
            base_seed=base_seed,
        )
    elif mode == "processes":
        try:
            summaries = _run_parallel_processes(
                product,
                paths,
                workers,
                on_progress,
                should_cancel=should_cancel,
                params=params,
                frequency=frequency,
                base_seed=base_seed,
                simulation_end=horizon,
                horizon_dates=horizon_dates,
            )
        except ForwardTestCancelled:
            raise
        except Exception:
            if should_cancel and should_cancel():
                raise ForwardTestCancelled("Forward test cancelled — a newer run was started.")
            log.warning("process pool failed — falling back to threads", exc_info=True)
            _emit(on_progress, 5.0, "Process pool unavailable — continuing with threads…")
            summaries, details = _run_parallel_threads(
                product,
                fwd_market,
                paths,
                workers,
                store_ids,
                on_progress,
                should_cancel=should_cancel,
                params=params,
                frequency=frequency,
                horizon_dates=horizon_dates,
                base_seed=base_seed,
            )
    else:
        summaries, details = _run_parallel_threads(
            product,
            fwd_market,
            paths,
            workers,
            store_ids,
            on_progress,
            should_cancel=should_cancel,
            params=params,
            frequency=frequency,
            horizon_dates=horizon_dates,
            base_seed=base_seed,
        )

    if should_cancel and should_cancel():
        raise ForwardTestCancelled("Forward test cancelled — a newer run was started.")

    if not summaries:
        raise RuntimeError("Forward test produced no path results")

    yearly = _yearly_rollup(summaries, principal_cr=product.principal_cr)
    totals = [s.total for s in summaries]
    irrs = [s.irr for s in summaries]

    _emit(on_progress, 100.0, "Complete")

    return {
        "product": product.to_dict(),
        "frequency": frequency,
        "path_count": len(summaries),
        "simulation_start": params.asof,
        "simulation_end": horizon.isoformat(),
        "simulation_end_days": resolved_simulation_end_days(product),
        "gbm": params.to_dict(),
        "asof": params.asof,
        "mc_matrix": {
            "n_paths": int(mc_matrix.shape[0]),
            "n_dates": int(mc_matrix.shape[1]),
            "dates": [d.isoformat() for d in horizon_dates],
            "base_seed": int(base_seed),
            "spot0": float(params.spot0),
            "drift": float(params.drift),
            "std_dev": float(params.std_dev),
            "mean_return": float(params.mean_return),
            "asof": params.asof,
            "layout": {
                "rows": "path_id 1…N (vertical)",
                "columns": "trading dates as-of → Simulation End (horizontal)",
                "formula": "S_t = S_{t-1} · exp(drift + σ · Z)",
            },
        },
        # Internal: persisted to jobs/{id}/mc_matrix.npz then stripped before JSON.
        "_mc_matrix": mc_matrix,
        "_mc_dates": horizon_dates,
        "kpis": {
            "mean_total": float(np.mean(totals)),
            "median_total": float(np.median(totals)),
            "min_total": float(np.min(totals)),
            "max_total": float(np.max(totals)),
            "mean_irr": float(np.mean(irrs)),
            "median_irr": float(np.median(irrs)),
            "hit_rate_gt_100": float(
                np.mean([1.0 if t > product.principal_cr else 0.0 for t in totals])
            ),
            "mean_abs_nifty_ret": float(np.mean([s.abs_nifty_ret for s in summaries])),
        },
        "summary": [asdict(s) for s in summaries],
        "yearly": yearly,
        "details": details,
    }


def _detail_payload(
    path,
    hedge,
    nav,
    summary: PathSummary,
    spots: np.ndarray,
    market: MarketDB,
    roll_by: dict,
) -> dict:
    nifty = [float(x) for x in spots]
    if nav.computation_rows:
        nifty = [float(r["nifty"]) for r in nav.computation_rows]
    start, end = path.dates[0], path.dates[-1]
    rolls = [
        {
            "shift_date": d.isoformat(),
            "roll_cost": float(roll_by[d]),
        }
        for d in sorted(roll_by)
    ]
    monthly_expiries = []
    for e in market.expiries:
        if e < start or e > end:
            continue
        monthly_expiries.append(
            {
                "expiry_date": e.isoformat(),
                "weekday": e.strftime("%A"),
                "is_monthly_last": e in market.monthly_last_expiries,
                "nifty_close": path_nifty_on(path.dates, spots, e),
            }
        )
    return {
        "path_id": path.path_id,
        "start": path.start.isoformat(),
        "end": path.end.isoformat(),
        "spot0": hedge.spot0,
        "dates": [d.isoformat() for d in path.dates],
        "nifty": nifty,
        "rolls": rolls,
        "monthly_expiries": monthly_expiries,
        "observations": [d.isoformat() for d in hedge.observations],
        "obs_spots": hedge.obs_spots,
        "obs_builds": [_obs_dict(b) for b in hedge.obs_builds],
        "legs": [_leg_dict(lg) for lg in hedge.legs],
        "daily_nav": nav.daily_nav,
        "daily_delta": nav.daily_delta,
        "computation_rows": nav.computation_rows,
        "cost_rows": nav.cost_rows,
        "summary": asdict(summary),
    }


def _yearly_rollup(
    summaries: list[PathSummary],
    principal_cr: float = 100.0,
) -> list[dict]:
    buckets: dict[int, list[PathSummary]] = defaultdict(list)
    for s in summaries:
        buckets[s.year].append(s)
    rows = []
    for year in sorted(buckets):
        g = buckets[year]
        totals = [x.total for x in g]
        irrs = [x.irr for x in g]
        rows.append(
            {
                "year": year,
                "paths": len(g),
                "mean_total": float(np.mean(totals)),
                "median_total": float(np.median(totals)),
                "min_total": float(np.min(totals)),
                "max_total": float(np.max(totals)),
                "mean_irr": float(np.mean(irrs)),
                "median_irr": float(np.median(irrs)),
                "hit_rate_gt_100": float(
                    np.mean([1 if t > principal_cr else 0 for t in totals])
                ),
            }
        )
    return rows


def compute_single_path_detail(
    product: ProductSpec,
    path: PathSpec,
    market: MarketDB | None = None,
    *,
    params: GbmParams | None = None,
    frequency: Frequency = "daily",
    horizon_dates: list[date] | None = None,
    base_seed: int = GBM_BASE_SEED,
) -> dict:
    market = market or load_market()
    if params is None and (path.spots is None or len(path.spots) != len(path.dates)):
        sim_end = resolved_simulation_end(market.last_date, product)
        fwd, params = build_forward_market(
            market,
            sim_end,
            product.tenure_days,
            observation_months=product.observation_months,
        )
        market = fwd
        if horizon_dates is None:
            asof = date.fromisoformat(params.asof)
            horizon_dates = horizon_trading_dates(market.dates, asof, sim_end)
        rebuilt = path_from_window(
            market,
            path.path_id,
            path.start,
            path.end,
            params=params,
            frequency=frequency,
            base_seed=base_seed,
            horizon_dates=horizon_dates,
        )
        if rebuilt is not None:
            path = rebuilt
    summary, detail = _evaluate_path(
        path,
        product,
        market,
        store=True,
        params=params,
        frequency=frequency,
        horizon_dates=horizon_dates,
        base_seed=base_seed,
    )
    assert detail is not None
    return detail
