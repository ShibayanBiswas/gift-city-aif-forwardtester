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
        return f"{day:02d}-{_MONTHS[m - 1]}-{y}"
    return f"{d.day:02d}-{_MONTHS[d.month - 1]}-{d.year}"


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
    """Regenerate full-horizon GBM for ``path_id`` then slice to ``path_dates``."""
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


def write_mc_matrix_xlsx(payload: dict[str, Any], dest: Path, *, max_paths: int | None = None) -> Path:
    """Branded desk Excel matching other downloads (logo + soft-gold banner + maroon headers)."""
    from openpyxl import Workbook
    from openpyxl.drawing.image import Image as XLImage
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    mat: np.ndarray = payload["matrix"]
    dates: list[date] = payload["dates"]
    n_paths = mat.shape[0] if max_paths is None else min(mat.shape[0], int(max_paths))
    n_dates = mat.shape[1]
    mean_ret = float(payload["mean_return"])
    std_dev = float(payload["std_dev"])
    asof = str(payload.get("asof") or "")
    hist_first = str(payload.get("first_date") or "2001-01-01")
    hist_last = str(payload.get("last_date") or asof)

    maroon = "7A1E2C"
    gold = "D4B24C"
    soft = "FFF8EC"
    alt = "FAF6F0"
    ink = "1F1612"
    white = "FFFFFF"
    muted = "6B5E55"
    footer_bg = "F7F1E8"
    grid = "CDBBA8"

    thin_gold = Side(style="thin", color=gold)
    thin_grid = Side(style="thin", color=grid)
    med_maroon = Side(style="medium", color=maroon)
    gold_border = Border(left=thin_gold, right=thin_gold, top=thin_gold, bottom=thin_gold)
    grid_border = Border(left=thin_grid, right=thin_grid, top=thin_grid, bottom=thin_grid)
    header_border = Border(left=thin_gold, right=thin_gold, top=med_maroon, bottom=med_maroon)

    fill_maroon = PatternFill("solid", fgColor=maroon)
    fill_soft = PatternFill("solid", fgColor=soft)
    fill_alt = PatternFill("solid", fgColor=alt)
    fill_white = PatternFill("solid", fgColor=white)
    fill_footer = PatternFill("solid", fgColor=footer_bg)

    font_title = Font(name="Calibri", size=14, bold=True, color=maroon)
    font_sub = Font(name="Calibri", size=11, bold=True, color=ink)
    font_muted = Font(name="Calibri", size=9, italic=True, color=muted)
    font_brand = Font(name="Calibri", size=11, bold=True, color=maroon)
    font_white = Font(name="Calibri", size=10, bold=True, color=white)
    font_label = Font(name="Calibri", size=10, bold=True, color=ink)
    font_ink = Font(name="Calibri", size=10, color=ink)
    center = Alignment(vertical="center", horizontal="center", wrapText=True)
    left = Alignment(vertical="center", horizontal="left")
    right = Alignment(vertical="center", horizontal="right")

    wb = Workbook()

    # ── Parameters (matches Product Input / desk ExcelJS tone) ────────
    ws_p = wb.active
    ws_p.title = "Parameters"
    ws_p.sheet_view.showGridLines = False
    for r in range(1, 5):
        ws_p.row_dimensions[r].height = {1: 22, 2: 20, 3: 16, 4: 8}[r]
    for c in range(1, 4):
        for r in range(1, 5):
            ws_p.cell(r, c).fill = fill_soft

    logo = _LOGO if _LOGO is not None else _resolve_logo()
    if logo is not None and logo.is_file():
        img = XLImage(str(logo))
        img.width = 168
        img.height = 48
        ws_p.add_image(img, "A1")

    ws_p.merge_cells("C1:C1")
    ws_p["C1"] = "Anand Rathi Wealth · Gift City"
    ws_p["C1"].font = font_brand
    ws_p["C1"].alignment = left
    ws_p["C1"].fill = fill_soft

    ws_p["C2"] = "Simulated Nifty Paths · Parameters"
    ws_p["C2"].font = font_sub
    ws_p["C2"].fill = fill_soft

    ws_p["C3"] = (
        f"{_desk_date(hist_first)} → {_desk_date(hist_last)} · "
        f"{n_paths} paths · {n_dates} trading dates"
    )
    ws_p["C3"].font = font_muted
    ws_p["C3"].fill = fill_soft

    for c in range(1, 3):
        ws_p.cell(4, c).fill = PatternFill("solid", fgColor=gold)

    ws_p["A6"] = "Parameter"
    ws_p["B6"] = "Value"
    for col in (1, 2):
        cell = ws_p.cell(6, col)
        cell.font = font_white
        cell.fill = fill_maroon
        cell.alignment = center
        cell.border = header_border

    param_rows: list[tuple[str, Any]] = [
        ("Current Nifty Spot", float(payload["spot0"])),
        ("Daily Average Return", mean_ret),
        ("Daily Average Return %", mean_ret * 100.0),
        ("Daily Standard Deviation", std_dev),
        ("Daily Standard Deviation %", std_dev * 100.0),
        ("Mean Drift", float(payload["drift"])),
        ("Estimation Start", _desk_date(hist_first)),
        ("Estimation End", _desk_date(hist_last)),
        ("Simulation First Date", _desk_date(dates[0]) if dates else ""),
        ("Simulation Last Date", _desk_date(dates[-1]) if dates else ""),
        ("Number Of Paths", int(n_paths)),
        ("Number Of Trading Dates", int(n_dates)),
    ]
    for i, (label, value) in enumerate(param_rows, start=7):
        a = ws_p.cell(i, 1, label)
        b = ws_p.cell(i, 2, value)
        a.font = font_label
        b.font = font_ink
        a.alignment = left
        b.alignment = right if isinstance(value, (int, float)) else left
        a.border = grid_border
        b.border = grid_border
        fill = fill_alt if i % 2 else fill_white
        a.fill = fill
        b.fill = fill
        if isinstance(value, float):
            b.number_format = "0.000000" if abs(value) < 1 else "#,##0.00"
    ws_p.column_dimensions["A"].width = 34
    ws_p.column_dimensions["B"].width = 22
    ws_p.column_dimensions["C"].width = 48

    # ── Simulated Nifty grid ──────────────────────────────────────────
    ws = wb.create_sheet("Simulated Nifty")
    ws.sheet_view.showGridLines = False
    banner_cols = min(n_dates + 1, 8)
    for r in range(1, 5):
        ws.row_dimensions[r].height = {1: 22, 2: 20, 3: 16, 4: 8}[r]
        for c in range(1, banner_cols + 1):
            ws.cell(r, c).fill = fill_soft

    if logo is not None and logo.is_file():
        img2 = XLImage(str(logo))
        img2.width = 168
        img2.height = 48
        ws.add_image(img2, "A1")

    ws.cell(1, 3, "Anand Rathi Wealth · Gift City").font = font_brand
    ws.cell(1, 3).fill = fill_soft
    ws.cell(2, 3, "Simulated Nifty Paths").font = font_sub
    ws.cell(2, 3).fill = fill_soft
    ws.cell(
        3,
        3,
        (
            f"{n_paths} paths · {n_dates} trading dates · "
            f"{_desk_date(dates[0]) if dates else ''} → {_desk_date(dates[-1]) if dates else ''}"
        ),
    ).font = font_muted
    ws.cell(3, 3).fill = fill_soft
    for c in range(1, banner_cols + 1):
        ws.cell(4, c).fill = PatternFill("solid", fgColor=gold)

    header_row = 6
    headers = ["Path"] + [_desk_date(d) for d in dates]
    for c, h in enumerate(headers, start=1):
        cell = ws.cell(header_row, c, h)
        cell.font = font_white
        cell.fill = fill_maroon
        cell.alignment = center
        cell.border = header_border

    # Plain numeric body (no per-cell alt fill) — keeps large grids deployable.
    for i in range(n_paths):
        r = header_row + 1 + i
        ws.cell(r, 1, i + 1).font = font_label
        ws.cell(r, 1).alignment = center
        ws.cell(r, 1).border = grid_border
        for j in range(n_dates):
            cell = ws.cell(r, j + 2, round(float(mat[i, j]), 4))
            cell.number_format = "#,##0.00"
            cell.font = font_ink
            cell.alignment = right
            cell.border = grid_border

    footer_r = header_row + 1 + n_paths
    ws.cell(
        footer_r,
        1,
        f"Anand Rathi Wealth · Gift City AIF · {n_paths} paths · Exported {_desk_date(date.today())}",
    ).font = font_muted
    for c in range(1, min(banner_cols, n_dates + 1) + 1):
        ws.cell(footer_r, c).fill = fill_footer
        ws.cell(footer_r, c).border = gold_border

    ws.column_dimensions["A"].width = 10
    for c in range(2, min(n_dates + 2, 40)):
        ws.column_dimensions[get_column_letter(c)].width = 12
    ws.freeze_panes = "B7"

    dest.parent.mkdir(parents=True, exist_ok=True)
    wb.save(dest)
    return dest
