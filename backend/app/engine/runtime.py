"""Host resource heuristics for free-tier (Render) vs fat local boxes."""
from __future__ import annotations

import os
from functools import lru_cache


def _mem_available_mb() -> float | None:
    """Best-effort available RAM in MiB (Linux). None if unknown."""
    try:
        with open("/proc/meminfo", encoding="utf-8") as f:
            info: dict[str, float] = {}
            for line in f:
                parts = line.split()
                if len(parts) >= 2 and parts[0].endswith(":"):
                    info[parts[0][:-1]] = float(parts[1])  # kB
        # Prefer MemAvailable; fall back to MemFree + Cached.
        if "MemAvailable" in info:
            return info["MemAvailable"] / 1024.0
        return (info.get("MemFree", 0.0) + info.get("Cached", 0.0)) / 1024.0
    except Exception:
        return None


def _env_first(*keys: str) -> str:
    for key in keys:
        val = os.environ.get(key, "").strip()
        if val:
            return val
    return ""


@lru_cache(maxsize=1)
def is_constrained_host() -> bool:
    """
    True on Render free / small VMs where process pools OOM and thrash.

    Override with FORWARDTEST_CONSTRAINED=1|0 (legacy: BACKTEST_CONSTRAINED).
    """
    flag = _env_first("FORWARDTEST_CONSTRAINED", "BACKTEST_CONSTRAINED").lower()
    if flag in {"1", "true", "yes", "on"}:
        return True
    if flag in {"0", "false", "no", "off"}:
        return False
    if os.environ.get("RENDER") or os.environ.get("RENDER_SERVICE_ID"):
        return True
    cpus = os.cpu_count() or 1
    mem = _mem_available_mb()
    if cpus <= 1:
        return True
    if mem is not None and mem < 1200:
        return True
    return False


def forwardtest_parallelism(n_paths: int) -> tuple[str, int]:
    """
    Return (mode, workers) where mode is 'serial' | 'threads' | 'processes'.

    Env overrides:
      FORWARDTEST_WORKERS=N   (legacy: BACKTEST_WORKERS)
      FORWARDTEST_MODE=serial|threads|processes  (legacy: BACKTEST_MODE)
    """
    mode_env = _env_first("FORWARDTEST_MODE", "BACKTEST_MODE").lower()
    workers_env = _env_first("FORWARDTEST_WORKERS", "BACKTEST_WORKERS")
    cpus = max(1, os.cpu_count() or 1)
    constrained = is_constrained_host()

    if mode_env in {"serial", "threads", "processes"}:
        mode = mode_env
    elif constrained:
        # Free Render: never spawn process pools (each worker reloads the market).
        mode = "serial" if n_paths < 80 else "threads"
    elif n_paths < 24:
        mode = "serial"
    else:
        mode = "processes"

    if workers_env.isdigit():
        workers = max(1, int(workers_env))
    elif mode == "serial":
        workers = 1
    elif constrained:
        # 2 threads share one market copy — enough for tiny free CPUs without thrash.
        workers = 2
    elif mode == "processes":
        workers = max(1, min(cpus, n_paths, 8))
    else:
        workers = max(1, min(cpus, 4))

    return mode, workers


# Legacy alias
backtest_parallelism = forwardtest_parallelism
