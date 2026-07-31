"""MongoDB Atlas sync for products, uploads, and forward-test summaries."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

from pymongo import MongoClient, ASCENDING
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
