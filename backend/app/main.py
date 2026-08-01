"""FastAPI application for Gift City AIF Forward Tester (GBM Monte Carlo)."""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import threading
import uuid
from datetime import date
from pathlib import Path
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from app.db import mongo
from app.engine.forwardtest import ForwardTestCancelled, compute_single_path_detail, run_forwardtest
from app.engine.gbm import GBM_BASE_SEED, GbmParams, estimate_gbm_params
from app.engine.market import clear_market_cache, load_market, path_nifty_on, path_roll_vector
from app.engine.market_sync import sync_market_to_present
from app.engine.mc_matrix import (
    build_mc_matrix,
    load_mc_matrix,
    matrix_meta,
    matrix_preview,
    save_mc_matrix,
    slice_path_spots,
    write_mc_matrix_xlsx,
)
from app.engine.paths import build_forward_market, path_from_window
from app.engine.product import (
    ProductSpec,
    parse_product_workbook,
    resolved_simulation_end,
    resolved_simulation_end_days,
)

ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
load_dotenv(BACKEND_ROOT / ".env")

DATA = ROOT / "data"
UPLOADS = DATA / "uploads"
JOBS = DATA / "jobs"


def _resolve_default_product() -> Path:
    """Prefer repo-root sample; fall back to backend/ copy (Render root-directory deploys)."""
    for candidate in (
        ROOT / "Product_Input_File.xlsx",
        BACKEND_ROOT / "Product_Input_File.xlsx",
    ):
        if candidate.exists():
            return candidate
    return ROOT / "Product_Input_File.xlsx"


DEFAULT_PRODUCT = _resolve_default_product()
APP_VERSION = "1.0.0"
SERVICE_NAME = "gift-aif-forwardtester"

UPLOADS.mkdir(parents=True, exist_ok=True)
JOBS.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Gift City AIF Forward Tester", version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_jobs: dict[str, dict[str, Any]] = {}
_current_product = None
_active_job_id: str | None = None
# client_run_id → job_id so duplicate POSTs (cold-start retry / double-click) reuse one job.
_client_run_jobs: dict[str, str] = {}
_MAX_JOB_FILES = 12
_run_lock: asyncio.Lock | None = None


def _get_run_lock() -> asyncio.Lock:
    """Serialize heavy forward tests so cancel + new run never overlap pools (OOM / crash)."""
    global _run_lock
    if _run_lock is None:
        _run_lock = asyncio.Lock()
    return _run_lock


def _ensure_product() -> ProductSpec:
    global _current_product
    if _current_product is None:
        _load_default_product()
    assert _current_product is not None
    return _current_product


def _desk_market():
    """Historical market + forward calendar through Simulation End.

    Calendar only for desk meta (Trading Days / Monthly Expiries). Simulated
    Nifty prices and roll *points* live on each GBM path — there is no shared
    Path-1 price workbook for the forward horizon.
    """
    base = load_market()
    product = _ensure_product()
    sim_end = resolved_simulation_end(base.last_date, product)
    days = resolved_simulation_end_days(product)
    fwd, params = build_forward_market(
        base,
        sim_end,
        product.tenure_days,
        observation_months=product.observation_months,
        fill_gbm=False,
    )
    asof = base.last_date
    return {
        "base": base,
        "market": fwd,
        "params": params,
        "asof": asof,
        "simulation_end": sim_end,
        "simulation_end_days": days,
        "product": product,
    }


def _horizon_meta(desk: dict[str, Any]) -> dict[str, Any]:
    base = desk["base"]
    fwd = desk["market"]
    asof = desk["asof"]
    sim_end = desk["simulation_end"]
    horizon_days = fwd.trading_days_between(asof, sim_end)
    horizon_expiries = [e for e in fwd.expiries if asof <= e <= sim_end]
    return {
        "first_date": base.first_date.isoformat(),
        "last_date": asof.isoformat(),
        "asof": asof.isoformat(),
        "simulation_end": sim_end.isoformat(),
        "simulation_end_days": desk["simulation_end_days"],
        "product_name": desk["product"].name,
        "trading_days": len(horizon_days),
        "trading_days_history": len(base.dates),
        "expiries": len(horizon_expiries),
        "expiries_history": len(base.expiries),
        "all_expiries": len([e for e in fwd.all_expiries if asof <= e <= sim_end]),
        "first_expiry": horizon_expiries[0].isoformat() if horizon_expiries else None,
        "last_expiry": horizon_expiries[-1].isoformat() if horizon_expiries else None,
        "roll_shifts": len([d for d in fwd.roll_shifts if asof <= d <= sim_end]),
        "first_roll_shift": next(
            (d.isoformat() for d in fwd.roll_shifts if asof <= d <= sim_end), None
        ),
        "last_roll_shift": next(
            (d.isoformat() for d in reversed(fwd.roll_shifts) if asof <= d <= sim_end),
            None,
        ),
    }


def _cancel_job(job: dict[str, Any], *, reason: str, message: str) -> None:
    if job.get("status") not in {"queued", "running"}:
        return
    job["status"] = "cancelled"
    job["error"] = reason
    job["message"] = message
    _persist_job(job["id"])


def _cancel_other_jobs(keep_id: str) -> None:
    """Mark any queued/running job as cancelled so only one simulation runs at a time."""
    for jid, job in list(_jobs.items()):
        if jid == keep_id:
            continue
        _cancel_job(
            job,
            reason="Cancelled — a newer forward test was started.",
            message="Superseded by a newer run",
        )


def _prune_old_jobs() -> None:
    """Keep only the newest job JSON files (+ their path-detail folders)."""
    files = sorted(JOBS.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    for stale in files[_MAX_JOB_FILES:]:
        try:
            job_id = stale.stem
            stale.unlink(missing_ok=True)
            folder = JOBS / job_id
            if folder.is_dir():
                shutil.rmtree(folder, ignore_errors=True)
            _jobs.pop(job_id, None)
        except Exception:
            pass


def _load_default_product():
    """Load current upload, or seed from Product_Input_File.xlsx (default Simulation End Days = 7300)."""
    global _current_product
    dest = UPLOADS / "current_product.xlsx"
    UPLOADS.mkdir(parents=True, exist_ok=True)
    if not dest.exists() and DEFAULT_PRODUCT.exists():
        shutil.copy2(DEFAULT_PRODUCT, dest)

    def _parse(path: Path) -> ProductSpec:
        return parse_product_workbook(path, name="Current Product")

    if dest.exists():
        _current_product = _parse(dest)
    elif DEFAULT_PRODUCT.exists():
        shutil.copy2(DEFAULT_PRODUCT, dest)
        _current_product = _parse(dest)
    else:
        raise RuntimeError("No Product_Input_File.xlsx found to seed the current product")

    try:
        mongo.upsert_current_product(_current_product.to_dict())
    except Exception:
        pass
    return _current_product


def _persist_job(job_id: str) -> None:
    job = _jobs.get(job_id)
    if not job:
        return
    try:
        status = job.get("status")
        if status == "done" and job.get("result"):
            result = job["result"]
            # Persist MC matrix binary separately — never JSON-encode ndarray.
            matrix = result.pop("_mc_matrix", None)
            dates = result.pop("_mc_dates", None)
            if matrix is not None and dates is not None:
                gbm = result.get("gbm") or {}
                try:
                    params = GbmParams(
                        spot0=float(gbm.get("spot0") or result.get("mc_matrix", {}).get("spot0") or 0),
                        asof=str(gbm.get("asof") or result.get("asof") or ""),
                        mean_return=float(gbm.get("mean_return") or 0),
                        std_dev=float(gbm.get("std_dev") or 0),
                        drift=float(gbm.get("drift") or 0),
                        n_returns=int(gbm.get("n_returns") or 0),
                        first_date=str(gbm.get("first_date") or ""),
                        last_date=str(gbm.get("last_date") or ""),
                    )
                    seed = int((result.get("mc_matrix") or {}).get("base_seed") or GBM_BASE_SEED)
                    save_mc_matrix(
                        JOBS / job_id,
                        dates=dates,
                        matrix=matrix,
                        params=params,
                        base_seed=seed,
                    )
                except Exception:
                    pass
            slim = {
                k: v
                for k, v in result.items()
                if k not in {"details", "_mc_matrix", "_mc_dates"}
            }
            payload = {
                "id": job_id,
                "status": "done",
                "progress": 100.0,
                "message": "Complete",
                "error": None,
                "frequency": job.get("frequency") or slim.get("frequency"),
                "product": job.get("product") or slim.get("product"),
                "result": slim,
            }
            (JOBS / f"{job_id}.json").write_text(json.dumps(payload))
            _prune_old_jobs()
            return
        if status in {"error", "cancelled"}:
            payload = {
                "id": job_id,
                "status": status,
                "progress": float(job.get("progress") or 0.0),
                "message": job.get("message") or status,
                "error": job.get("error"),
                "frequency": job.get("frequency"),
                "product": job.get("product"),
                "result": None,
            }
            (JOBS / f"{job_id}.json").write_text(json.dumps(payload))
    except Exception:
        # Disk full / ephemeral FS — keep in-memory job usable.
        pass


def _hydrate_job_from_disk(job_id: str) -> dict[str, Any] | None:
    path = JOBS / f"{job_id}.json"
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text())
    except Exception:
        return None

    # New format wraps metadata; older files stored the slim result root.
    if isinstance(raw.get("result"), dict) and "summary" in raw["result"]:
        result = raw["result"]
        frequency = raw.get("frequency") or result.get("frequency") or "monthly"
        product = raw.get("product") or result.get("product")
    elif "summary" in raw and "frequency" in raw:
        result = {k: v for k, v in raw.items() if k not in {"id", "status", "progress", "message", "error"}}
        frequency = result.get("frequency") or "monthly"
        product = result.get("product")
    else:
        return None

    if "details" not in result:
        result["details"] = {}
    job = {
        "id": job_id,
        "status": "done",
        "progress": 100.0,
        "message": "Complete",
        "error": None,
        "frequency": frequency,
        "product": product,
        "result": result,
    }
    _jobs[job_id] = job
    return job


def _get_job(job_id: str) -> dict[str, Any] | None:
    job = _jobs.get(job_id)
    if job:
        return job
    return _hydrate_job_from_disk(job_id)


def _reload_jobs_from_disk() -> None:
    for path in JOBS.glob("*.json"):
        _hydrate_job_from_disk(path.stem)


@app.on_event("startup")
def _startup() -> None:
    # Bind / health / product must not wait on Yahoo — Render free-tier cold starts
    # stay snappy; market extend runs in the background.
    try:
        load_market()
    except Exception:
        clear_market_cache()
        try:
            load_market()
        except Exception:
            pass
    _load_default_product()
    _reload_jobs_from_disk()
    if mongo.is_configured():
        try:
            mongo.ensure_indexes()
            mongo.save_market_snapshot(_horizon_meta(_desk_market()))
        except Exception:
            pass

    def _bg_market_sync() -> None:
        try:
            sync_market_to_present()
            if mongo.is_configured():
                try:
                    mongo.save_market_snapshot(_horizon_meta(_desk_market()))
                except Exception:
                    pass
        except Exception:
            clear_market_cache()
            try:
                load_market()
            except Exception:
                pass

    threading.Thread(target=_bg_market_sync, daemon=True, name="market-sync").start()


class RunRequest(BaseModel):
    frequency: Literal["monthly", "weekly", "daily", "quarterly", "semi_annual"] = "daily"
    """Browser-generated id for this Run click — duplicate POSTs return the same job."""
    client_run_id: str | None = None


class CancelRequest(BaseModel):
    job_id: str | None = None
    reason: str | None = None


@app.get("/api/health")
def health() -> dict:
    mongo_status = mongo.ping()
    return {
        "ok": True,
        "service": SERVICE_NAME,
        "version": APP_VERSION,
        "mongo": mongo_status,
    }


@app.get("/api/ping")
def ping() -> dict:
    """Ultra-light wake probe — no Mongo, no market I/O."""
    return {"ok": True, "service": SERVICE_NAME, "version": APP_VERSION}


@app.get("/api/gbm/params")
def gbm_params() -> dict:
    """Live GBM inputs + resolved simulation horizon."""
    desk = _desk_market()
    return {
        "ok": True,
        "gbm": desk["params"].to_dict(),
        "simulation_start": desk["asof"].isoformat(),
        "simulation_end": desk["simulation_end"].isoformat(),
        "simulation_end_days": desk["simulation_end_days"],
    }


@app.get("/api/sync")
def sync_status(force: bool = False) -> dict:
    """Wake-up ping + daily market sync (Nifty + roll/expiry calendars through present).

    Pass ``force=true`` to rebuild roll/expiry calendars even when no new Nifty
    rows were appended (desk “refresh calendars” control).
    """
    try:
        synced = sync_market_to_present(force=force)
    except Exception as e:
        synced = {"ok": False, "error": str(e)}
        clear_market_cache()
    desk = _desk_market()
    meta = _horizon_meta(desk)
    mongo_status = mongo.ping()
    if mongo.is_configured() and synced.get("ok"):
        try:
            mongo.save_market_snapshot(meta)
        except Exception:
            pass
    return {
        "ok": bool(synced.get("ok")),
        "service": SERVICE_NAME,
        "market": meta,
        "market_sync": synced,
        "mongo": mongo_status,
        "product_loaded": _current_product is not None,
    }


@app.get("/api/mongo/status")
def mongo_status() -> dict:
    return mongo.ping()


@app.get("/api/market/meta")
def get_market_meta() -> dict:
    return _horizon_meta(_desk_market())


@app.get("/api/market/nifty")
def get_nifty(limit: int = 0) -> dict:
    """Historical Nifty through as-of only (GBM estimation sample).

    Forward simulated closes are path-specific — use path detail ``nifty`` /
    Intel · Path Market, not a shared workbook.
    """
    desk = _desk_market()
    base = desk["base"]
    asof = desk["asof"]
    sim_end = desk["simulation_end"]
    rows = [
        {"date": d.isoformat(), "close": float(c)}
        for d, c in zip(base.dates, base.closes)
        if d <= asof
    ]
    if limit > 0:
        rows = rows[:limit]
    return {
        "rows": rows,
        "count": len(rows),
        "asof": asof.isoformat(),
        "simulation_end": sim_end.isoformat(),
        "simulation_end_days": desk["simulation_end_days"],
        "note": "Historical closes through as-of for μ/σ estimation. Simulated Nifty is per GBM path.",
    }


@app.get("/api/market/expiries")
def get_expiries(full: bool = True) -> dict:
    """Forward calendar expiry *dates* as-of → Simulation End (no shared prices).

    Nifty on each expiry is path-specific — see path detail ``monthly_expiries``.
    """
    desk = _desk_market()
    m = desk["market"]
    asof = desk["asof"]
    sim_end = desk["simulation_end"]
    source = m.all_expiries if full else m.expiries
    rows = []
    for e in source:
        if e < asof or e > sim_end:
            continue
        is_monthly = e in m.monthly_last_expiries
        rows.append(
            {
                "expiry_date": e.isoformat(),
                "nifty_close": None,
                "weekday": e.strftime("%A"),
                "is_monthly_last": is_monthly,
                "kind": "monthly_last" if is_monthly else "weekly",
            }
        )
    monthly_count = sum(1 for r in rows if r["is_monthly_last"])
    return {
        "rows": rows,
        "count": len(rows),
        "monthly_last_count": monthly_count,
        "full": full,
        "asof": asof.isoformat(),
        "simulation_end": sim_end.isoformat(),
        "simulation_end_days": desk["simulation_end_days"],
        "note": "Calendar dates only. Pair with a path's simulated Nifty on Intel · Path Market.",
    }


@app.get("/api/market/rolls")
def get_rolls() -> dict:
    """Forward calendar futures-shift *dates* as-of → Simulation End.

    Roll *points* are recomputed per path from that path's GBM spots.
    """
    desk = _desk_market()
    m = desk["market"]
    asof = desk["asof"]
    sim_end = desk["simulation_end"]
    rows = [
        {"shift_date": d.isoformat(), "roll_cost": None}
        for d in m.roll_shifts
        if asof <= d <= sim_end
    ]
    return {
        "rows": rows,
        "count": len(rows),
        "asof": asof.isoformat(),
        "simulation_end": sim_end.isoformat(),
        "simulation_end_days": desk["simulation_end_days"],
        "note": "Shift dates from the shared calendar. Roll points are path-specific.",
    }

@app.get("/api/product/current")
def get_current_product() -> dict:
    if _current_product is None:
        _load_default_product()
    return _current_product.to_dict()


@app.get("/api/product/sample")
def download_sample_product() -> FileResponse:
    if not DEFAULT_PRODUCT.exists():
        raise HTTPException(404, "Sample product input file not found")
    return FileResponse(
        DEFAULT_PRODUCT,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="Product_Input_File.xlsx",
    )


@app.get("/api/product/history")
def product_history() -> dict:
    try:
        rows = mongo.list_products()
    except Exception:
        rows = []
    return {"rows": rows, "mongo": mongo.ping()}


@app.post("/api/product/upload")
async def upload_product(file: UploadFile = File(...)) -> dict:
    global _current_product
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(400, "Upload an .xlsx or .xlsm product input file")
    dest = UPLOADS / f"product_{uuid.uuid4().hex[:8]}_{file.filename}"
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    try:
        product = parse_product_workbook(dest, name=Path(file.filename).stem.replace("_", " ").title())
    except Exception as e:
        raise HTTPException(400, f"Failed to parse product: {e}") from e
    # Keep a stable current copy
    shutil.copy2(dest, UPLOADS / "current_product.xlsx")
    _current_product = product
    payload = product.to_dict()
    try:
        mongo.upsert_current_product(payload)
        mongo.log_upload(
            {
                "filename": file.filename,
                "name": product.name,
                "principal_cr": product.principal_cr,
                "n_obs": product.n_obs,
                "n_legs": len(product.legs),
            }
        )
    except Exception:
        pass
    base = load_market()
    sim_days = resolved_simulation_end_days(product)
    sim_end = resolved_simulation_end(base.last_date, product)
    desk = _desk_market()
    meta = _horizon_meta(desk)
    if mongo.is_configured():
        try:
            mongo.save_market_snapshot(meta)
        except Exception:
            pass
    return {
        "ok": True,
        "product": payload,
        "simulation_end_days": sim_days,
        "simulation_end": sim_end.isoformat(),
        "asof": base.last_date.isoformat(),
        "market": meta,
    }


@app.post("/api/forwardtest/run")
async def start_forwardtest(body: RunRequest) -> dict:
    global _active_job_id
    if _current_product is None:
        _load_default_product()

    # Idempotent: cold-start proxies / double-clicks must not spawn a second job.
    token = (body.client_run_id or "").strip()[:64] or None
    if token:
        existing_id = _client_run_jobs.get(token)
        existing = _jobs.get(existing_id) if existing_id else None
        if existing and existing.get("status") in {"queued", "running", "done"}:
            if existing.get("frequency") == body.frequency:
                return {"job_id": existing["id"], "reused": True}

    job_id = uuid.uuid4().hex[:12]
    _cancel_other_jobs(job_id)
    _active_job_id = job_id
    if token:
        _client_run_jobs[token] = job_id
    _jobs[job_id] = {
        "id": job_id,
        "status": "queued",
        "progress": 0.0,
        "message": "Queued",
        "result": None,
        "error": None,
        "frequency": body.frequency,
        "product": _current_product.to_dict(),
        "client_run_id": token,
    }
    product = _current_product
    frequency = body.frequency

    async def _runner() -> None:
        def on_progress(pct: float, msg: str) -> None:
            job = _jobs.get(job_id)
            if not job or job.get("status") == "cancelled":
                return
            job["progress"] = pct
            job["message"] = msg
            if job.get("status") != "cancelled":
                job["status"] = "running"

        def should_cancel() -> bool:
            job = _jobs.get(job_id)
            return not job or job.get("status") == "cancelled" or _active_job_id != job_id

        async with _get_run_lock():
            try:
                if should_cancel():
                    raise ForwardTestCancelled("Forward test cancelled — a newer run was started.")
                _jobs[job_id]["status"] = "running"
                result = await asyncio.to_thread(
                    run_forwardtest,
                    product,
                    frequency,
                    None,
                    on_progress,
                    None,
                    should_cancel,
                    GBM_BASE_SEED,
                )
                if should_cancel():
                    raise ForwardTestCancelled("Forward test cancelled — a newer run was started.")
                _jobs[job_id]["result"] = result
                _jobs[job_id]["status"] = "done"
                _jobs[job_id]["progress"] = 100.0
                _jobs[job_id]["message"] = "Complete"
                _persist_job(job_id)
                try:
                    slim = {
                        k: v
                        for k, v in result.items()
                        if k not in {"details", "_mc_matrix", "_mc_dates"}
                    }
                    mongo.save_job_summary(job_id, frequency, slim)
                except Exception:
                    pass
            except ForwardTestCancelled as e:
                job = _jobs.get(job_id)
                if job and job.get("status") != "cancelled":
                    job["status"] = "cancelled"
                    job["error"] = str(e)
                    job["message"] = "Superseded by a newer run"
                _persist_job(job_id)
            except Exception as e:
                job = _jobs.get(job_id)
                if job and job.get("status") != "cancelled":
                    job["status"] = "error"
                    job["error"] = str(e)
                    job["message"] = str(e)
                    _persist_job(job_id)

    asyncio.create_task(_runner())
    return {"job_id": job_id, "reused": False}


@app.post("/api/forwardtest/cancel")
async def cancel_forwardtest(body: CancelRequest = CancelRequest()) -> dict:
    """Stop the active simulation (browser refresh / user cancel). One-at-a-time desk rule."""
    global _active_job_id
    target_id = (body.job_id or _active_job_id or "").strip() or None
    if not target_id:
        return {"ok": True, "cancelled": False, "reason": "no_active_job"}
    job = _jobs.get(target_id)
    if not job:
        return {"ok": True, "cancelled": False, "reason": "unknown_job"}
    reason = (body.reason or "Cancelled by user.").strip()[:200]
    was_live = job.get("status") in {"queued", "running"}
    _cancel_job(job, reason=reason, message="Cancelled")
    if _active_job_id == target_id:
        _active_job_id = None
    return {"ok": True, "cancelled": was_live, "job_id": target_id}


@app.get("/api/forwardtest/{job_id}/progress")
async def progress_sse(job_id: str) -> EventSourceResponse:
    if _get_job(job_id) is None:
        raise HTTPException(404, "Unknown job. Run a fresh forward test.")

    async def gen():
        while True:
            job = _get_job(job_id)
            if job is None:
                break
            payload = {"progress": job["progress"], "message": job["message"], "status": job["status"]}
            yield {"event": "progress", "data": json.dumps(payload)}
            if job["status"] in {"done", "error", "cancelled"}:
                yield {"event": "done", "data": json.dumps(payload)}
                break
            await asyncio.sleep(0.25)

    return EventSourceResponse(gen())


@app.get("/api/forwardtest/{job_id}/status")
def job_status(job_id: str) -> dict:
    job = _get_job(job_id)
    if not job:
        raise HTTPException(404, "Unknown job. Run a fresh forward test.")
    return {
        "id": job_id,
        "status": job["status"],
        "progress": job["progress"],
        "message": job["message"],
        "error": job["error"],
    }


@app.get("/api/forwardtest/{job_id}/summary")
def job_summary(job_id: str) -> dict:
    job = _get_job(job_id)
    if not job:
        raise HTTPException(404, "Unknown job. Run a fresh forward test.")
    if job["status"] != "done" or not job["result"]:
        raise HTTPException(409, f"Job not ready: {job['status']}")
    r = job["result"]
    return {
        "product": r["product"],
        "frequency": r["frequency"],
        "path_count": r["path_count"],
        "simulation_start": r.get("simulation_start") or r.get("asof"),
        "simulation_end": r.get("simulation_end"),
        "simulation_end_days": r.get("simulation_end_days"),
        "gbm": r.get("gbm"),
        "asof": r.get("asof"),
        "mc_matrix": r.get("mc_matrix"),
        "kpis": r["kpis"],
        "summary": r["summary"],
        "yearly": r["yearly"],
    }


@app.get("/api/forwardtest/{job_id}/paths")
def job_paths(job_id: str) -> dict:
    job = _get_job(job_id)
    if not job or job["status"] != "done" or not job["result"]:
        raise HTTPException(404, "Forward test result expired. Please run again.")
    rows = [
        {
            "path_id": s["path_id"],
            "start": s["start"],
            "end": s["end"],
            "total": s["total"],
            "irr": s["irr"],
            "year": s["year"],
            "n_trading_days": s.get("n_trading_days"),
        }
        for s in job["result"]["summary"]
    ]
    return {"paths": rows}


def _product_for_job(job: dict[str, Any]) -> ProductSpec:
    """Prefer the product snapshot saved with the job (survives uploads / restarts)."""
    raw = job.get("product") or (job.get("result") or {}).get("product")
    if isinstance(raw, dict) and raw.get("tenure_days") is not None:
        try:
            return ProductSpec.from_dict(raw)
        except Exception as e:
            raise HTTPException(
                500,
                f"Job product snapshot could not be restored: {e}",
            ) from e
    src = UPLOADS / "current_product.xlsx"
    if not src.exists():
        src = DEFAULT_PRODUCT
    return parse_product_workbook(
        src,
        name=_current_product.name if _current_product else "Current Product",
    )


def _path_detail_cache_path(job_id: str, path_id: int) -> Path:
    folder = JOBS / job_id
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"path_{path_id}.json"


def _load_cached_path_detail(job_id: str, path_id: int) -> dict | None:
    path = _path_detail_cache_path(job_id, path_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except Exception:
        return None
    if data.get("computation_rows"):
        return data
    return None


def _save_cached_path_detail(job_id: str, path_id: int, detail: dict) -> None:
    try:
        _path_detail_cache_path(job_id, path_id).write_text(json.dumps(detail))
    except Exception:
        pass


def _resolve_path_detail(job_id: str, path_id: int) -> dict:
    job = _get_job(job_id)
    if not job:
        raise HTTPException(
            404,
            "Unknown forward test job. It may have been cleared — please run again.",
        )
    status = job.get("status") or "pending"
    if status == "error":
        raise HTTPException(
            422,
            job.get("error") or job.get("message") or "Forward test job failed.",
        )
    if status == "cancelled":
        raise HTTPException(
            409,
            "This forward test was superseded by a newer run. Results are no longer available.",
        )
    if status != "done" or not job.get("result"):
        raise HTTPException(
            409,
            f"Job not ready: {status}",
        )

    details = job["result"].setdefault("details", {})
    cached = details.get(path_id) or details.get(str(path_id))
    if cached and cached.get("computation_rows"):
        return cached

    disk = _load_cached_path_detail(job_id, path_id)
    if disk:
        details[path_id] = disk
        return disk

    summary_rows = job["result"].get("summary") or []
    row = next((s for s in summary_rows if int(s["path_id"]) == int(path_id)), None)
    if not row:
        raise HTTPException(404, f"Window {path_id} was not found in this forward test summary.")

    product = _product_for_job(job)
    frequency = job.get("frequency") or (job.get("result") or {}).get("frequency") or "daily"
    gbm_raw = (job.get("result") or {}).get("gbm")
    params: GbmParams | None = None
    if isinstance(gbm_raw, dict) and gbm_raw.get("spot0") is not None:
        params = GbmParams(
            spot0=float(gbm_raw["spot0"]),
            asof=str(gbm_raw["asof"]),
            mean_return=float(gbm_raw["mean_return"]),
            std_dev=float(gbm_raw["std_dev"]),
            drift=float(gbm_raw["drift"]),
            n_returns=int(gbm_raw["n_returns"]),
            first_date=str(gbm_raw["first_date"]),
            last_date=str(gbm_raw["last_date"]),
        )

    base = load_market()
    sim_end_raw = (job.get("result") or {}).get("simulation_end")
    if sim_end_raw:
        sim_end = date.fromisoformat(str(sim_end_raw)[:10])
    else:
        sim_end = resolved_simulation_end(base.last_date, product)

    fwd_market, est = build_forward_market(
        base,
        sim_end,
        product.tenure_days,
        observation_months=product.observation_months,
    )
    if params is None:
        params = est

    mc_meta = (job.get("result") or {}).get("mc_matrix") or {}
    horizon_dates: list[date] | None = None
    raw_dates = mc_meta.get("dates")
    if isinstance(raw_dates, list) and raw_dates:
        horizon_dates = [date.fromisoformat(str(x)[:10]) for x in raw_dates]
    else:
        loaded = load_mc_matrix(JOBS / job_id)
        if loaded:
            horizon_dates = loaded["dates"]
        else:
            asof_d = date.fromisoformat(str(params.asof)[:10])
            horizon_dates = fwd_market.trading_days_between(asof_d, sim_end)

    match = path_from_window(
        fwd_market,
        int(path_id),
        row["start"],
        row["end"],
        params=params,
        frequency=frequency,
        base_seed=GBM_BASE_SEED,
        horizon_dates=horizon_dates,
    )
    if not match:
        raise HTTPException(
            404,
            f"Could not rebuild GBM path {path_id} ({row['start']} → {row['end']}).",
        )

    try:
        detail = compute_single_path_detail(
            product,
            match,
            fwd_market,
            params=params,
            frequency=frequency,
            horizon_dates=horizon_dates,
            base_seed=GBM_BASE_SEED,
        )
    except Exception as e:
        raise HTTPException(
            500,
            f"Failed to compute path {path_id} ledger: {e}",
        ) from e
    details[path_id] = detail
    _save_cached_path_detail(job_id, path_id, detail)
    return detail


def _mc_matrix_payload(job_id: str) -> dict[str, Any]:
    """Load saved MC matrix or rebuild from job GBM params + seed."""
    job = _get_job(job_id)
    if not job:
        raise HTTPException(404, "Unknown job. Run a fresh forward test.")
    if job.get("status") != "done" or not job.get("result"):
        raise HTTPException(409, f"Job not ready: {job.get('status')}")

    loaded = load_mc_matrix(JOBS / job_id)
    if loaded:
        return loaded

    r = job["result"]
    meta = r.get("mc_matrix") or {}
    gbm = r.get("gbm") or {}
    dates_raw = meta.get("dates") or []
    if not dates_raw or not gbm.get("spot0"):
        raise HTTPException(404, "Monte Carlo matrix not available for this job.")
    dates = [date.fromisoformat(str(x)[:10]) for x in dates_raw]
    params = GbmParams(
        spot0=float(gbm["spot0"]),
        asof=str(gbm["asof"]),
        mean_return=float(gbm["mean_return"]),
        std_dev=float(gbm["std_dev"]),
        drift=float(gbm["drift"]),
        n_returns=int(gbm["n_returns"]),
        first_date=str(gbm["first_date"]),
        last_date=str(gbm["last_date"]),
    )
    n_paths = int(meta.get("n_paths") or r.get("path_count") or 0)
    seed = int(meta.get("base_seed") or GBM_BASE_SEED)
    matrix = build_mc_matrix(params, dates, n_paths, base_seed=seed)
    try:
        save_mc_matrix(JOBS / job_id, dates=dates, matrix=matrix, params=params, base_seed=seed)
    except Exception:
        pass
    return {
        "matrix": matrix,
        "dates": dates,
        "spot0": float(params.spot0),
        "drift": float(params.drift),
        "std_dev": float(params.std_dev),
        "mean_return": float(params.mean_return),
        "base_seed": seed,
        "asof": params.asof,
        "first_date": str(params.first_date),
        "last_date": str(params.last_date),
        "n_paths": int(matrix.shape[0]),
        "n_dates": int(matrix.shape[1]),
    }


@app.get("/api/forwardtest/{job_id}/mc-matrix")
def job_mc_matrix_meta(job_id: str) -> dict:
    job = _get_job(job_id)
    if not job or job.get("status") != "done" or not job.get("result"):
        raise HTTPException(404, "Forward test result expired. Please run again.")
    meta = (job["result"].get("mc_matrix") or {}).copy()
    if not meta:
        payload = _mc_matrix_payload(job_id)
        return {"ok": True, **matrix_meta(payload)}
    return {"ok": True, **meta}


@app.get("/api/forwardtest/{job_id}/mc-matrix/preview")
def job_mc_matrix_preview(
    job_id: str,
    max_paths: int = 25,
    max_dates: int = 40,
) -> dict:
    payload = _mc_matrix_payload(job_id)
    return {
        "ok": True,
        **matrix_preview(
            payload,
            max_paths=max(1, min(int(max_paths), 100)),
            max_dates=max(1, min(int(max_dates), 120)),
        ),
    }


@app.get("/api/forwardtest/{job_id}/mc-matrix.xlsx")
def job_mc_matrix_xlsx(job_id: str, max_paths: int | None = None) -> FileResponse:
    try:
        payload = _mc_matrix_payload(job_id)
        dest = JOBS / job_id / "Simulated_Nifty_Paths.xlsx"
        cap = None if max_paths is None else max(1, int(max_paths))
        write_mc_matrix_xlsx(payload, dest, max_paths=cap)
        return FileResponse(
            dest,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename="Simulated_Nifty_Paths.xlsx",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Could not build Simulated Nifty Excel: {e}") from e


def _path_horizon_market(job_id: str, path_id: int) -> dict[str, Any]:
    """Full as-of → Simulation End Path Market sheet for one Monte Carlo path.

    Uses the saved MC matrix row — not the tenure-window path detail — so Intel
    shows Nifty / last-Tuesday expiries / month-end rolls from today through
    Simulation End with path-local prices and roll points.
    """
    job = _get_job(job_id)
    if not job or job.get("status") != "done" or not job.get("result"):
        raise HTTPException(404, "Forward test result expired. Please run again.")
    summary_rows = job["result"].get("summary") or []
    row = next((s for s in summary_rows if int(s["path_id"]) == int(path_id)), None)
    if not row:
        raise HTTPException(404, f"Path {path_id} was not found in this forward test.")

    payload = _mc_matrix_payload(job_id)
    dates: list[date] = payload["dates"]
    if not dates:
        raise HTTPException(404, "Monte Carlo horizon dates missing.")
    try:
        spots = slice_path_spots(payload["matrix"], dates, dates, int(path_id))
    except Exception as e:
        raise HTTPException(404, f"Could not read Monte Carlo row for path {path_id}: {e}") from e

    product = _product_for_job(job)
    base = load_market()
    sim_end_raw = (job.get("result") or {}).get("simulation_end")
    if sim_end_raw:
        sim_end = date.fromisoformat(str(sim_end_raw)[:10])
    else:
        sim_end = resolved_simulation_end(base.last_date, product)
    fwd_market, _ = build_forward_market(
        base,
        sim_end,
        product.tenure_days,
        observation_months=product.observation_months,
    )

    start, end = dates[0], dates[-1]
    _, roll_by = path_roll_vector(dates, spots, fwd_market.roll_shifts)
    rolls = [
        {"shift_date": d.isoformat(), "roll_cost": float(roll_by[d])}
        for d in sorted(roll_by)
    ]
    monthly_expiries = []
    for e in sorted(fwd_market.monthly_last_expiries):
        if e < start or e > end:
            continue
        monthly_expiries.append(
            {
                "expiry_date": e.isoformat(),
                "weekday": e.strftime("%A"),
                "is_monthly_last": True,
                "nifty_close": path_nifty_on(dates, spots, e),
            }
        )

    return {
        "ok": True,
        "path_id": int(path_id),
        "tenure_start": row["start"],
        "tenure_end": row["end"],
        "horizon_start": start.isoformat(),
        "horizon_end": end.isoformat(),
        "asof": payload.get("asof"),
        "simulation_end": end.isoformat(),
        "dates": [d.isoformat() for d in dates],
        "nifty": [float(x) for x in spots],
        "rolls": rolls,
        "monthly_expiries": monthly_expiries,
        "n_trading_days": len(dates),
        "n_rolls": len(rolls),
        "n_expiries": len(monthly_expiries),
        "spot0": float(payload["spot0"]),
        "layout": {
            "scope": "as-of through Simulation End",
            "source": "Monte Carlo matrix row for this path_id",
        },
    }


@app.get("/api/forwardtest/{job_id}/paths/{path_id}/horizon-market")
async def job_path_horizon_market(job_id: str, path_id: int) -> dict:
    return await asyncio.to_thread(_path_horizon_market, job_id, path_id)


@app.get("/api/forwardtest/{job_id}/paths/{path_id}")
async def job_path_detail(job_id: str, path_id: int) -> dict:
    return await asyncio.to_thread(_resolve_path_detail, job_id, path_id)


@app.get("/api/forwardtest/{job_id}/paths/{path_id}/series")
async def job_path_series(job_id: str, path_id: int) -> dict:
    """Slim series payload (delta / calendar / NAV) for a single path."""
    d = await asyncio.to_thread(_resolve_path_detail, job_id, path_id)
    return {
        "path_id": path_id,
        "start": d["start"],
        "end": d["end"],
        "dates": d.get("dates") or [],
        "daily_delta": d.get("daily_delta"),
        "daily_nav": d.get("daily_nav"),
        "observations": d.get("observations") or [],
        "nifty": d.get("nifty"),
    }


@app.get("/api/forwardtest/{job_id}/paths/{path_id}/computation")
async def job_path_computation(job_id: str, path_id: int) -> dict:
    d = await asyncio.to_thread(_resolve_path_detail, job_id, path_id)
    return {
        "path_id": path_id,
        "start": d["start"],
        "end": d["end"],
        "summary": d["summary"],
        "rows": d.get("computation_rows") or [],
    }


@app.get("/api/forwardtest/{job_id}/paths/{path_id}/hedging")
async def job_path_hedging(job_id: str, path_id: int) -> dict:
    d = await asyncio.to_thread(_resolve_path_detail, job_id, path_id)
    return {
        "path_id": path_id,
        "start": d["start"],
        "end": d["end"],
        "spot0": d.get("spot0"),
        "obs_builds": d.get("obs_builds") or [],
        "legs": d.get("legs") or [],
        "summary": d["summary"],
    }
