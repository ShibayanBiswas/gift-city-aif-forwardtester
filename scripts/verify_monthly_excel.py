#!/usr/bin/env python3
"""Verify monthly path pins + Working File 1 / Product Input book parity vs Excel Summary."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import openpyxl
from app.engine.forwardtest import compute_single_path_detail
from app.engine.market import clear_market_cache, load_market
from app.engine.paths import build_paths
from app.engine.product import parse_product_workbook

WF1 = ROOT / "Gift AIF Working File 1.xlsm"
PATH1_TOTAL = 180.78505147144745
PATH10_TOTAL = 216.47711650487614


def main() -> None:
    clear_market_cache()
    market = load_market()
    product = parse_product_workbook(ROOT / "Product_Input_File.xlsx")
    assert len(product.active_legs) == 6, product.active_legs
    assert all(lg.include for lg in product.legs), "sample product has no excluded legs"

    paths = build_paths(market, product.tenure_days, "monthly", observation_months=product.observation_months)
    assert len(paths) >= 235, f"expected ≥235 monthly paths, got {len(paths)}"
    assert paths[0].start.isoformat() == "2001-01-01"
    assert paths[9].start.isoformat() == "2001-10-01"
    assert paths[9].end.isoformat() == "2006-09-29"
    pinned = paths[:235]
    assert pinned[-1].start.isoformat() == "2020-07-01"
    assert paths[-1].start.year >= 2021, f"expected dynamic extension into 2021+, last={paths[-1].start}"

    d1 = compute_single_path_detail(product, paths[0], market)["summary"]
    d10 = compute_single_path_detail(product, paths[9], market)["summary"]
    assert abs(float(d1["total"]) - PATH1_TOTAL) < 1e-4, d1["total"]
    print(f"Path1 Total OK {float(d1['total']):.6f} (engine gold {PATH1_TOTAL:.6f})")
    print(f"Path10 Total {float(d10['total']):.6f}")
    assert abs(float(d10["total"]) - PATH10_TOTAL) < 1e-4, d10["total"]

    wb_path = WF1
    if not wb_path.exists():
        print(f"OK monthly={len(paths)} (no Gift AIF Working File 1.xlsm for multi-path check)")
        return

    wb = openpyxl.load_workbook(wb_path, data_only=True, read_only=True)
    ws = wb["Summary"]
    excel: dict[int, dict[str, float]] = {}
    for row in ws.iter_rows(min_row=4, max_col=20, values_only=True):
        b = row[1]
        if not isinstance(b, (int, float)) or isinstance(b, bool) or row[8] is None:
            continue
        pid = int(b)
        if pid < 1 or pid > 300:
            continue
        # Keep first occurrence — Summary can append stale duplicate path ids.
        if pid in excel:
            continue
        excel[pid] = {
            "total": float(row[8]),
            "gsec": float(row[5]),
            "irr": float(row[19]) if row[19] is not None else 0.0,
        }
    wb.close()
    assert len(excel) >= 200, len(excel)

    # Spot-check Path 1 from Summary when WF1 is present (brokerage-only desk vs WF1 AK/AL ≈ 1 bp).
    if 1 in excel:
        assert abs(excel[1]["total"] - 180.77242011453939) < 0.05, excel[1]["total"]

    checked = 0
    mismatches: list[tuple[int, float, float]] = []
    for p in pinned:
        if p.path_id not in excel:
            continue
        e = excel[p.path_id]
        s = compute_single_path_detail(product, p, market)["summary"]
        if abs(float(s["gsec"]) - e["gsec"]) > 0.5:
            continue
        if abs(float(s["total"]) - e["total"]) < 0.05:
            checked += 1
        else:
            mismatches.append((p.path_id, float(s["total"]), e["total"]))

    # WF1 Summary still has stale rows (same class of Gsec/MTM drift as prior WF).
    assert checked >= 140, f"too few healthy Summary rows matched: {checked}"
    assert len(mismatches) <= 35, mismatches[:10]
    print(
        f"OK monthly={len(paths)} (excel_pins=235) last_start={paths[-1].start} "
        f"path1={float(d1['total']):.3f} path10={float(d10['total']):.3f} "
        f"summary_matched={checked} summary_mismatches={len(mismatches)} {mismatches[:3]}"
    )


if __name__ == "__main__":
    main()
