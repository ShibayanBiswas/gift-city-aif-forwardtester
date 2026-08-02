"""Monte Carlo Nifty matrix — Excel ``Nifty Simulations.xlsx`` layout.

Rows = path numbers 1…N (vertical).
Columns = trading **dates** from as-of through Simulation End (horizontal).

Same calendar date ⇒ different prices across paths (independent Z per path_id).
Each cell follows::

    S_t = S_{t-1} · exp(drift + σ · Z),  Z ~ N(0,1)

Path tenure windows slice this matrix so hedge / NAV / roll points stay
aligned to the same path_id random stream.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

import numpy as np

from .gbm import GBM_BASE_SEED, GbmParams, gbm_spots, gbm_spots_matrix

_MONTHS = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)

# Soft cap for free-tier Excel builds (cells ≈ paths × dates). Above this we
# still export, but stream path-by-path and skip heavy styling.
_EXCEL_CELL_SOFT_CAP = 800_000


def _resolve_logo() -> Path | None:
    """Logo for branded Excel — works in full repo and Render (backend-only root)."""
    here = Path(__file__).resolve()
    candidates = [
        here.parents[1] / "static" / "brand" / "arwl-logo.png",  # backend/app/static (Render)
        here.parents[3] / "frontend" / "public" / "brand" / "arwl-logo.png",  # monorepo
        here.parents[2] / "static" / "brand" / "arwl-logo.png",
    ]
    for p in candidates:
        if p.is_file():
            return p
    return None


_LOGO = _resolve_logo()


def _desk_date(d: date | str) -> str:
    """Match frontend formatDeskDate: 31-Jul-2026."""
    if isinstance(d, str):
        parts = d.strip()[:10].split("-")
        if len(parts) != 3:
            return d
        y, m, day = (int(parts[0]), int(parts[1]), int(parts[2]))
    else:
        y, m, day = d.year, d.month, d.day
    return f"{day:02d}-{_MONTHS[m - 1]}-{y}"


def horizon_trading_dates(market_dates: list[date], asof: date, horizon: date) -> list[date]:
    """Inclusive trading sessions from as-of through Simulation End."""
    return [d for d in market_dates if asof <= d <= horizon]


def build_mc_matrix(
    params: GbmParams,
    dates: list[date],
    n_paths: int,
    *,
    base_seed: int = GBM_BASE_SEED,
) -> np.ndarray:
    """Return float32 matrix shape (n_paths, n_dates); row i = path_id i+1."""
    if not dates or n_paths <= 0:
        return np.zeros((0, 0), dtype=np.float32)
    mat = gbm_spots_matrix(
        params.spot0,
        len(dates),
        n_paths,
        params.drift,
        params.std_dev,
        base_seed=base_seed,
    )
    return np.asarray(mat, dtype=np.float32)


def slice_path_spots(
    mat: np.ndarray,
    horizon_dates: list[date],
    path_dates: list[date],
    path_id: int,
) -> np.ndarray:
    """Slice one path's tenure spots from the full horizon matrix."""
    if mat.size == 0 or not path_dates:
        return np.zeros(0, dtype=float)
    idx = {d: i for i, d in enumerate(horizon_dates)}
    row = int(path_id) - 1
    if row < 0 or row >= mat.shape[0]:
        raise IndexError(f"path_id {path_id} out of matrix rows {mat.shape[0]}")
    return np.asarray([float(mat[row, idx[d]]) for d in path_dates if d in idx], dtype=float)


def spots_aligned_to_horizon(
    path_dates: list[date],
    params: GbmParams,
    path_id: int,
    horizon_dates: list[date],
    *,
    base_seed: int = GBM_BASE_SEED,
) -> np.ndarray:
    """Generate full horizon GBM row then slice to path dates (Excel column alignment)."""
    if not path_dates:
        return np.zeros(0, dtype=float)
    if not horizon_dates:
        return gbm_spots(
            params.spot0,
            len(path_dates),
            params.drift,
            params.std_dev,
            path_id=path_id,
            base_seed=base_seed,
        )
    full = gbm_spots(
        params.spot0,
        len(horizon_dates),
        params.drift,
        params.std_dev,
        path_id=path_id,
        base_seed=base_seed,
    )
    idx = {d: i for i, d in enumerate(horizon_dates)}
    return np.asarray([float(full[idx[d]]) for d in path_dates if d in idx], dtype=float)


def save_mc_matrix(
    folder: Path,
    *,
    dates: list[date],
    matrix: np.ndarray,
    params: GbmParams,
    base_seed: int,
) -> Path:
    """Persist matrix + dates under the job folder."""
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "mc_matrix.npz"
    np.savez_compressed(
        path,
        matrix=np.asarray(matrix, dtype=np.float32),
        dates=np.array([d.isoformat() for d in dates]),
        spot0=float(params.spot0),
        drift=float(params.drift),
        std_dev=float(params.std_dev),
        mean_return=float(params.mean_return),
        base_seed=int(base_seed),
        asof=str(params.asof),
        first_date=str(params.first_date),
        last_date=str(params.last_date),
    )
    return path


def load_mc_matrix(folder: Path, *, mmap: bool = False) -> dict[str, Any] | None:
    path = folder / "mc_matrix.npz"
    if not path.exists():
        return None
    # mmap keeps huge grids off the heap when only previewing / streaming rows.
    data = np.load(path, allow_pickle=False, mmap_mode="r" if mmap else None)
    dates = [date.fromisoformat(str(x)) for x in np.asarray(data["dates"]).tolist()]
    keys = set(data.files)
    matrix = data["matrix"]
    if not mmap:
        matrix = np.asarray(matrix, dtype=np.float32)
    return {
        "matrix": matrix,
        "dates": dates,
        "spot0": float(data["spot0"]),
        "drift": float(data["drift"]),
        "std_dev": float(data["std_dev"]),
        "mean_return": float(data["mean_return"]),
        "base_seed": int(data["base_seed"]),
        "asof": str(data["asof"]),
        "first_date": str(data["first_date"]) if "first_date" in keys else "2001-01-01",
        "last_date": str(data["last_date"]) if "last_date" in keys else str(data["asof"]),
        "n_paths": int(matrix.shape[0]),
        "n_dates": int(matrix.shape[1]),
    }


def matrix_meta(payload: dict[str, Any]) -> dict[str, Any]:
    dates: list[date] = payload["dates"]
    return {
        "asof": payload["asof"],
        "n_paths": payload["n_paths"] if "n_paths" in payload else int(payload["matrix"].shape[0]),
        "n_dates": payload["n_dates"] if "n_dates" in payload else int(payload["matrix"].shape[1]),
        "first_date": dates[0].isoformat() if dates else None,
        "last_date": dates[-1].isoformat() if dates else None,
        "spot0": payload["spot0"],
        "drift": payload["drift"],
        "std_dev": payload["std_dev"],
        "mean_return": payload["mean_return"],
        "base_seed": payload["base_seed"],
        "layout": {
            "rows": "path_id 1…N (vertical)",
            "columns": "trading dates as-of → Simulation End (horizontal)",
            "formula": "S_t = S_{t-1} · exp(drift + σ · Z)",
        },
    }


def matrix_preview(
    payload: dict[str, Any],
    *,
    max_paths: int = 25,
    max_dates: int = 40,
) -> dict[str, Any]:
    mat: np.ndarray = payload["matrix"]
    dates: list[date] = payload["dates"]
    n_paths = min(int(max_paths), mat.shape[0])
    n_dates = min(int(max_dates), mat.shape[1])
    headers = ["Path"] + [d.isoformat() for d in dates[:n_dates]]
    rows: list[list[float | int]] = []
    for i in range(n_paths):
        rows.append([i + 1] + [round(float(mat[i, j]), 4) for j in range(n_dates)])
    return {
        **matrix_meta(payload),
        "preview_paths": n_paths,
        "preview_dates": n_dates,
        "headers": headers,
        "rows": rows,
        "truncated": mat.shape[0] > n_paths or mat.shape[1] > n_dates,
    }


def _iter_path_rows(
    *,
    matrix: np.ndarray | None,
    params: GbmParams | None,
    dates: list[date],
    n_paths: int,
    base_seed: int,
):
    """Yield path rows without requiring the full matrix in RAM."""
    n_dates = len(dates)
    if matrix is not None:
        for i in range(n_paths):
            yield i + 1, np.asarray(matrix[i, :n_dates], dtype=np.float64)
        return
    assert params is not None
    for path_id in range(1, n_paths + 1):
        yield path_id, gbm_spots(
            params.spot0,
            n_dates,
            params.drift,
            params.std_dev,
            path_id=path_id,
            base_seed=base_seed,
        )


def write_mc_matrix_xlsx(
    payload: dict[str, Any],
    dest: Path,
    *,
    max_paths: int | None = None,
    params: GbmParams | None = None,
) -> Path:
    """Memory-safe branded Excel (write_only grid — safe on Render free tier).

    Prefer ``payload['matrix']`` when present; otherwise stream rows from GBM
    using ``params`` + dates (one path at a time).
    """
    from openpyxl import Workbook

    dates: list[date] = list(payload["dates"])
    mat = payload.get("matrix")
    n_paths_all = int(payload.get("n_paths") or (mat.shape[0] if mat is not None else 0))
    if max_paths is not None:
        n_paths = min(n_paths_all, max(1, int(max_paths)))
    else:
        n_paths = n_paths_all
    n_dates = len(dates)
    if n_paths <= 0 or n_dates <= 0:
        raise ValueError("Empty Monte Carlo matrix — nothing to export")

    mean_ret = float(payload["mean_return"])
    std_dev = float(payload["std_dev"])
    drift = float(payload["drift"])
    spot0 = float(payload["spot0"])
    asof = str(payload.get("asof") or "")
    hist_first = str(payload.get("first_date") or "2001-01-01")
    hist_last = str(payload.get("last_date") or asof)
    base_seed = int(payload.get("base_seed") or GBM_BASE_SEED)
    cells = n_paths * n_dates
    capped_note = ""
    if n_paths < n_paths_all:
        capped_note = f"Export capped to {n_paths} of {n_paths_all} paths for memory."
    elif cells > _EXCEL_CELL_SOFT_CAP:
        capped_note = "Large grid exported with streaming writer (deploy-safe)."

    gbm_params = params
    if gbm_params is None and mat is None:
        gbm_params = GbmParams(
            spot0=spot0,
            asof=asof,
            mean_return=mean_ret,
            std_dev=std_dev,
            drift=drift,
            n_returns=int(payload.get("n_returns") or 0),
            first_date=hist_first,
            last_date=hist_last,
        )

    # write_only keeps only the current row buffered — critical on 512MB hosts.
    wb = Workbook(write_only=True)

    ws_p = wb.create_sheet("Parameters")
    ws_p.append(["Anand Rathi Wealth · Gift City"])
    ws_p.append(["Simulated Nifty Paths · Parameters"])
    ws_p.append([f"{_desk_date(hist_first)} → {_desk_date(hist_last)} · {n_paths} paths · {n_dates} trading dates"])
    if capped_note:
        ws_p.append([capped_note])
    else:
        ws_p.append([""])
    ws_p.append([])
    ws_p.append(["Parameter", "Value"])
    param_rows: list[tuple[str, Any]] = [
        ("Current Nifty Spot", spot0),
        ("Daily Average Return", mean_ret),
        ("Daily Average Return %", mean_ret * 100.0),
        ("Daily Standard Deviation", std_dev),
        ("Daily Standard Deviation %", std_dev * 100.0),
        ("Drift", drift),
        ("Estimation Start", _desk_date(hist_first)),
        ("Estimation End", _desk_date(hist_last)),
        ("Simulation First Date", _desk_date(dates[0]) if dates else ""),
        ("Simulation Last Date", _desk_date(dates[-1]) if dates else ""),
        ("Number Of Paths", int(n_paths)),
        ("Number Of Trading Dates", int(n_dates)),
        ("Formula", "S_t = S_(t-1) * EXP(drift + sigma * Z), Z ~ N(0,1)"),
        ("Base Seed", int(base_seed)),
    ]
    for label, value in param_rows:
        ws_p.append([label, value])

    ws = wb.create_sheet("Simulated Nifty")
    ws.append(["Anand Rathi Wealth · Gift City"])
    ws.append(["Simulated Nifty Paths"])
    ws.append(
        [
            f"{n_paths} paths · {n_dates} trading dates · "
            f"{_desk_date(dates[0]) if dates else ''} → {_desk_date(dates[-1]) if dates else ''}"
        ]
    )
    ws.append([capped_note] if capped_note else [""])
    ws.append([])
    ws.append(["Path"] + [_desk_date(d) for d in dates])

    for path_id, spots in _iter_path_rows(
        matrix=mat if mat is not None else None,
        params=gbm_params,
        dates=dates,
        n_paths=n_paths,
        base_seed=base_seed,
    ):
        # Round once per cell for Excel size; keep path float64 stream short-lived.
        ws.append([path_id] + [round(float(x), 4) for x in spots])

    ws.append(
        [
            f"Anand Rathi Wealth · Gift City AIF · {n_paths} paths · Exported {_desk_date(date.today())}"
        ]
    )

    dest.parent.mkdir(parents=True, exist_ok=True)
    wb.save(dest)
    return dest
