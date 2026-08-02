"""MongoDB Atlas sync for products, uploads, and forward-test job recovery."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

from pymongo import ASCENDING, MongoClient
from pymongo.collection import Collection
from pymongo.database import Database

COLLECTIONS = {
    "products": "products",
    "uploads": "product_uploads",
    "jobs": "forwardtest_jobs",
    "market": "market_snapshots",
}


def _uri() -> str | None:
    return os.environ.get("MONGODB_URI") or os.environ.get("MONGO_URI")


def _db_name() -> str:
    return os.environ.get("MONGODB_DB", "gift_aif_forwardtester")


@lru_cache(maxsize=1)
def get_client() -> MongoClient | None:
    uri = _uri()
    if not uri:
        return None
    return MongoClient(uri, serverSelectionTimeoutMS=8000)


def get_db() -> Database | None:
    client = get_client()
    if client is None:
        return None
    return client[_db_name()]


def is_configured() -> bool:
    return bool(_uri())


def ping() -> dict[str, Any]:
    if not is_configured():
        return {"ok": False, "configured": False, "message": "MONGODB_URI not set"}
    try:
        client = get_client()
        assert client is not None
        client.admin.command("ping")
        return {"ok": True, "configured": True, "database": _db_name()}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "configured": True, "error": str(e)}


def _col(name: str) -> Collection | None:
    db = get_db()
    if db is None:
        return None
    return db[COLLECTIONS[name]]


def ensure_indexes() -> None:
    products = _col("products")
    jobs = _col("jobs")
    uploads = _col("uploads")
    if products is not None:
        products.create_index([("name", ASCENDING)])
        products.create_index([("updated_at", ASCENDING)])
    if jobs is not None:
        jobs.create_index([("job_id", ASCENDING)], unique=True)
        jobs.create_index([("created_at", ASCENDING)])
    if uploads is not None:
        uploads.create_index([("created_at", ASCENDING)])


def upsert_current_product(product: dict[str, Any]) -> None:
    col = _col("products")
    if col is None:
        return
    now = datetime.now(timezone.utc)
    doc = {
        **product,
        "is_current": True,
        "updated_at": now,
    }
    col.update_many({"is_current": True}, {"$set": {"is_current": False}})
    col.update_one(
        {"name": product.get("name"), "source_file": product.get("source_file")},
        {"$set": doc, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )


def log_upload(meta: dict[str, Any]) -> None:
    col = _col("uploads")
    if col is None:
        return
    col.insert_one({**meta, "created_at": datetime.now(timezone.utc)})


def save_job_summary(job_id: str, frequency: str, summary: dict[str, Any]) -> None:
    """Persist a slim KPI card (legacy helper). Prefer ``save_job_result``."""
    col = _col("jobs")
    if col is None:
        return
    slim = {
        "job_id": job_id,
        "frequency": frequency,
        "path_count": summary.get("path_count"),
        "kpis": summary.get("kpis"),
        "yearly": summary.get("yearly"),
        "product": summary.get("product"),
        "created_at": datetime.now(timezone.utc),
    }
    col.update_one({"job_id": job_id}, {"$set": slim}, upsert=True)


def save_job_result(
    job_id: str,
    *,
    frequency: str,
    product: dict[str, Any] | None,
    result: dict[str, Any],
) -> None:
    """Persist enough slim result to rebuild MC Excel after Render restart.

    Stores GBM params + mc_matrix date list (not the float matrix). Matrix /
    Excel are regenerated on demand from those params.
    """
    col = _col("jobs")
    if col is None:
        return
    slim = {
        k: v
        for k, v in result.items()
        if k not in {"details", "_mc_matrix", "_mc_dates"}
    }
    now = datetime.now(timezone.utc)
    doc = {
        "job_id": job_id,
        "status": "done",
        "frequency": frequency,
        "product": product or slim.get("product"),
        "result": slim,
        "path_count": slim.get("path_count"),
        "kpis": slim.get("kpis"),
        "yearly": slim.get("yearly"),
        "updated_at": now,
    }
    col.update_one(
        {"job_id": job_id},
        {"$set": doc, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )


def load_job_result(job_id: str) -> dict[str, Any] | None:
    """Load a completed job slim result for in-process hydrate after restart."""
    col = _col("jobs")
    if col is None:
        return None
    try:
        doc = col.find_one({"job_id": job_id}, {"_id": 0})
    except Exception:
        return None
    if not doc:
        return None
    result = doc.get("result")
    if not isinstance(result, dict) or "summary" not in result:
        return None
    return {
        "id": job_id,
        "status": "done",
        "progress": 100.0,
        "message": "Complete",
        "error": None,
        "frequency": doc.get("frequency") or result.get("frequency") or "monthly",
        "product": doc.get("product") or result.get("product"),
        "result": result,
    }


def save_market_snapshot(meta: dict[str, Any]) -> None:
    col = _col("market")
    if col is None:
        return
    col.update_one(
        {"_id": "latest"},
        {"$set": {**meta, "synced_at": datetime.now(timezone.utc)}},
        upsert=True,
    )


def list_products(limit: int = 50) -> list[dict[str, Any]]:
    col = _col("products")
    if col is None:
        return []
    try:
        out = []
        for doc in col.find({}, {"_id": 0}).sort("updated_at", -1).limit(limit):
            out.append(doc)
    except Exception:
        return []
    return out
