"""Confirm options-book quantities/metrics are identical across Monte Carlo paths."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.engine.forwardtest import _evaluate_path  # noqa: E402
from app.engine.hedge import hedge_path  # noqa: E402
from app.engine.market import load_market  # noqa: E402
from app.engine.paths import build_paths  # noqa: E402
from app.engine.product import parse_product_workbook  # noqa: E402

UPLOAD = ROOT / "backend" / "data" / "uploads" / "current_product.xlsx"
DEFAULT = ROOT / "Product_Input_File.xlsx"
product_path = UPLOAD if UPLOAD.exists() else DEFAULT
if not product_path.exists():
    raise SystemExit(f"No product workbook at {product_path}")
product = parse_product_workbook(product_path, name="Current")
market = load_market()
paths, fwd, params, _horizon = build_paths(
    market,
    product.tenure_days,
    "daily",
    observation_months=product.observation_months,
    product=product,
    n_paths=8,
    attach_spots=True,
)

sigs: list[tuple] = []
for path in paths:
    hedge = hedge_path(fwd, product, path.dates, spots=path.spots)
    sig = tuple(
        sorted(
            (
                round(lg.raw_qty, 10),
                round(lg.strike_pct, 10),
                round(lg.strike, 8),
                round(lg.quantity, 10),
                round(lg.vol, 10),
                round(lg.forward_rate, 10),
                round(lg.discount_rate, 10),
                lg.expiry.isoformat(),
                lg.is_put,
            )
            for lg in hedge.legs
        )
    )
    sigs.append(
        (
            path.path_id,
            round(float(path.spots[0]), 8),
            len(hedge.legs),
            tuple(d.isoformat() for d in hedge.observations),
            sig,
        )
    )

base = sigs[0]
identical = all(
    s[1] == base[1] and s[2] == base[2] and s[3] == base[3] and s[4] == base[4] for s in sigs
)
print(f"paths={len(sigs)} legs={base[2]} spot0={base[1]}")
print(f"OPTION_BOOK_IDENTICAL_ACROSS_PATHS={identical}")

recon_ok = True
invt_gsec_fees: set[tuple[float, float, float]] = set()
for path in paths[:4]:
    summary, _ = _evaluate_path(
        path,
        product,
        fwd,
        False,
        params=params,
        frequency="daily",
        horizon_dates=path.dates,
    )
    recon = (
        summary.invt
        + summary.mtm_futures
        + summary.cash_plus_int
        + summary.gsec
        + summary.transaction_cost
        + summary.fees
    )
    if abs(summary.total - recon) >= 1e-9:
        recon_ok = False
    invt_gsec_fees.add(
        (round(summary.invt, 8), round(summary.gsec, 8), round(summary.fees, 8))
    )
    print(
        f"path={summary.path_id} total={summary.total:.6f} "
        f"mtm={summary.mtm_futures:.6f} recon_ok={abs(summary.total - recon) < 1e-9}"
    )

print(f"TOTAL_EQUALS_SUM_OF_COMPONENTS={recon_ok}")
print(f"INVT_GSEC_FEES_IDENTICAL_ACROSS_SAMPLED_PATHS={len(invt_gsec_fees) == 1}")
if not identical or not recon_ok:
    raise SystemExit(1)
