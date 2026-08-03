"""Full wind-up regression: engine, calendar, MC, branding, API calendar-only.

Run from repo root:
  PYTHONPATH=backend .venv/Scripts/python scripts/windup_suite.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = ROOT / ".venv" / "Scripts" / "python.exe"
SCRIPTS = [
    "verify_roll_costs.py",
    "verify_forward_calendar.py",
    "verify_path_counts.py",
    "verify_nifty_expiries.py",
    "verify_monte_carlo_paths.py",
    "audit_forward_parity.py",
    "audit_calc_deep.py",
    "audit_1000_limits.py",
    "e2e_edge_cases.py",
    "verify_monthly_excel.py",
    "e2e_smoke_five.py",
    "verify_dynamic_products.py",
]


def main() -> int:
    import os

    env = os.environ.copy()
    env["PYTHONPATH"] = str(ROOT / "backend")
    env["PYTHONIOENCODING"] = "utf-8"
    results: list[dict] = []
    for name in SCRIPTS:
        print(f"\n======== {name} ========", flush=True)
        proc = subprocess.run(
            [str(PY), str(ROOT / "scripts" / name)],
            cwd=str(ROOT),
            env=env,
        )
        ok = proc.returncode == 0
        results.append({"script": name, "ok": ok, "code": proc.returncode})
        print(("PASS" if ok else "FAIL"), name, flush=True)
        if not ok:
            break

    # Inline: BS identical; nav/hedge intentional FT extensions
    sys.path.insert(0, str(ROOT / "backend"))
    import filecmp
    import hashlib

    bt = Path(r"C:\Users\shiba\OneDrive\Desktop\Gift AIF Backtester\backend\app\engine")
    ft = ROOT / "backend" / "app" / "engine"
    if bt.exists():
        bs_ok = filecmp.cmp(bt / "black_scholes.py", ft / "black_scholes.py", shallow=False)
        results.append({"script": "parity_black_scholes", "ok": bs_ok, "code": 0 if bs_ok else 1})
        print(("PASS" if bs_ok else "FAIL"), "parity_black_scholes")
        nav_ft = (ft / "nav.py").read_text(encoding="utf-8")
        hedge_ft = (ft / "hedge.py").read_text(encoding="utf-8")
        nav_ok = "roll_on_day" in nav_ft
        hedge_ok = "_spot_on_or_before" in hedge_ft
        results.append({"script": "parity_nav_path_rolls", "ok": nav_ok, "code": 0 if nav_ok else 1})
        results.append({"script": "parity_hedge_path_spots", "ok": hedge_ok, "code": 0 if hedge_ok else 1})
        print(("PASS" if nav_ok else "FAIL"), "parity_nav_path_rolls")
        print(("PASS" if hedge_ok else "FAIL"), "parity_hedge_path_spots")

    fails = [r for r in results if not r["ok"]]
    print(f"\n==== WINDUP {len(results) - len(fails)} pass / {len(fails)} fail ====")
    print(json.dumps({"fails": fails, "n": len(results)}, indent=2))
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
