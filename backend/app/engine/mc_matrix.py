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
    matrix: np.ndarray,
    dates: list[date],
    path_dates: list[date],
    path_id: int,
) -> np.ndarray:
    """Extract one path's spots for ``path_dates`` from the full-horizon matrix."""
    if matrix.size == 0 or not path_dates:
        return np.zeros(0, dtype=float)
    idx = {d: i for i, d in enumerate(dates)}
    row = int(path_id) - 1
    if row < 0 or row >= matrix.shape[0]:
        raise IndexError(f"path_id {path_id} out of matrix rows {matrix.shape[0]}")
    missing = [d for d in path_dates if d not in idx]
    if missing:
        raise KeyError(f"path dates not on MC horizon axis: {missing[:3]}…")
    return np.asarray([float(matrix[row, idx[d]]) for d in path_dates], dtype=float)


def spots_aligned_to_horizon(
    path_dates: list[date],
    params: GbmParams,
    path_id: int,
    horizon_dates: list[date],
    *,
    base_seed: int = GBM_BASE_SEED,
) -> np.ndarray:
    """Regenerate full-horizon GBM for ``path_id`` then slice to ``path_dates``.

    Workers use this so path_id shares one Z stream with the saved MC matrix
    without loading the matrix file.
    """
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


def load_mc_matrix(folder: Path) -> dict[str, Any] | None:
    path = folder / "mc_matrix.npz"
    if not path.exists():
        return None
    data = np.load(path, allow_pickle=False)
    dates = [date.fromisoformat(str(x)) for x in data["dates"].tolist()]
    keys = set(data.files)
    return {
        "matrix": np.asarray(data["matrix"], dtype=np.float32),
        "dates": dates,
        "spot0": float(data["spot0"]),
        "drift": float(data["drift"]),
        "std_dev": float(data["std_dev"]),
        "mean_return": float(data["mean_return"]),
        "base_seed": int(data["base_seed"]),
        "asof": str(data["asof"]),
        "first_date": str(data["first_date"]) if "first_date" in keys else "2001-01-01",
        "last_date": str(data["last_date"]) if "last_date" in keys else str(data["asof"]),
        "n_paths": int(data["matrix"].shape[0]),
        "n_dates": int(data["matrix"].shape[1]),
    }


def matrix_meta(payload: dict[str, Any]) -> dict[str, Any]:
    dates: list[date] = payload["dates"]
    return {
        "asof": payload["asof"],
        "n_paths": payload["n_paths"],
        "n_dates": payload["n_dates"],
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


def write_mc_matrix_xlsx(payload: dict[str, Any], dest: Path, *, max_paths: int | None = None) -> Path:
    """Branded desk Excel: Parameters sheet + Simulated Nifty path×date grid."""
    from openpyxl import Workbook
    from openpyxl.cell import WriteOnlyCell
    from openpyxl.styles import Alignment, Font, PatternFill

    mat: np.ndarray = payload["matrix"]
    dates: list[date] = payload["dates"]
    n_paths = mat.shape[0] if max_paths is None else min(mat.shape[0], int(max_paths))
    n_dates = mat.shape[1]
    mean_ret = float(payload["mean_return"])
    std_dev = float(payload["std_dev"])
    asof = str(payload.get("asof") or "")
    hist_first = str(payload.get("first_date") or payload.get("estimation_start") or "2001-01-01")
    hist_last = str(payload.get("last_date") or payload.get("estimation_end") or asof)

    maroon_fill = PatternFill("solid", fgColor="7A1E2C")
    white_font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
    title_font = Font(name="Calibri", size=14, bold=True, color="7A1E2C")
    sub_font = Font(name="Calibri", size=9, italic=True, color="6B5E55")
    label_font = Font(name="Calibri", size=10, bold=True, color="1F1612")
    ink_font = Font(name="Calibri", size=10, color="1F1612")
    center = Alignment(vertical="center", horizontal="center")

    wb = Workbook(write_only=True)

    # Parameters — same desk tone as other branded exports.
    ws_p = wb.create_sheet("Parameters")
    c = WriteOnlyCell(ws_p, value="Anand Rathi Wealth · Gift City AIF Forwardtester")
    c.font = title_font
    ws_p.append([c, None])
    c = WriteOnlyCell(ws_p, value="Simulated Nifty Paths · Parameters")
    c.font = sub_font
    ws_p.append([c, None])
    ws_p.append([])
    h1 = WriteOnlyCell(ws_p, value="Parameter")
    h2 = WriteOnlyCell(ws_p, value="Value")
    for h in (h1, h2):
        h.font = white_font
        h.fill = maroon_fill
        h.alignment = center
    ws_p.append([h1, h2])
    for label, value in (
        ("Current Nifty Spot", float(payload["spot0"])),
        ("Daily Average Return", mean_ret),
        ("Daily Average Return %", mean_ret * 100.0),
        ("Daily Standard Deviation", std_dev),
        ("Daily Standard Deviation %", std_dev * 100.0),
        ("Mean Drift", float(payload["drift"])),
        ("Estimation Start", hist_first),
        ("Estimation End", hist_last),
        ("Simulation First Date", dates[0].isoformat() if dates else ""),
        ("Simulation Last Date", dates[-1].isoformat() if dates else ""),
        ("Number Of Paths", int(n_paths)),
        ("Number Of Trading Dates", int(n_dates)),
    ):
        a = WriteOnlyCell(ws_p, value=label)
        a.font = label_font
        b = WriteOnlyCell(ws_p, value=value)
        b.font = ink_font
        ws_p.append([a, b])

    # Simulated Nifty — path rows × trading-date columns.
    ws = wb.create_sheet("Simulated Nifty")
    t1 = WriteOnlyCell(ws, value="Anand Rathi Wealth · Gift City AIF Forwardtester")
    t1.font = title_font
    ws.append([t1])
    t2 = WriteOnlyCell(ws, value="Simulated Nifty Paths")
    t2.font = Font(name="Calibri", size=12, bold=True, color="7A1E2C")
    ws.append([t2])
    t3 = WriteOnlyCell(
        ws,
        value=(
            f"{n_paths} paths · {n_dates} trading dates · "
            f"{dates[0].isoformat() if dates else ''} → {dates[-1].isoformat() if dates else ''}"
        ),
    )
    t3.font = sub_font
    ws.append([t3])
    ws.append([])

    header_cells = [WriteOnlyCell(ws, value="Path")]
    header_cells[0].font = white_font
    header_cells[0].fill = maroon_fill
    header_cells[0].alignment = center
    for d in dates:
        cell = WriteOnlyCell(ws, value=d.isoformat())
        cell.font = white_font
        cell.fill = maroon_fill
        cell.alignment = center
        header_cells.append(cell)
    ws.append(header_cells)

    for i in range(n_paths):
        ws.append([i + 1] + [round(float(mat[i, j]), 4) for j in range(n_dates)])
    if n_paths < mat.shape[0]:
        ws.append([f"(Showing first {n_paths} of {mat.shape[0]} paths)"])

    dest.parent.mkdir(parents=True, exist_ok=True)
    wb.save(dest)
    return dest
