"""Version history storage: MongoDB when MONGODB_URI is set, otherwise in-memory."""
from datetime import datetime, timezone
from typing import Optional
from bson import ObjectId
from bson.errors import InvalidId
from pymongo import MongoClient
from pymongo.errors import PyMongoError
from .config import get_settings

_collection = None
_memory: list[dict] = []
_counter = 0


def get_collection():
    global _collection
    settings = get_settings()
    if not settings.mongodb_uri:
        return None
    if _collection is not None:
        return _collection
    try:
        client = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=2500)
        client.admin.command("ping")
        _collection = client[settings.mongodb_database]["resume_versions"]
        return _collection
    except Exception:
        return None


def storage_name() -> str:
    return "mongodb" if get_collection() is not None else "memory"


def _public(doc: dict, with_text: bool) -> dict:
    out = {k: v for k, v in doc.items() if k != "_id"}
    out["id"] = str(doc["_id"])
    if not with_text:
        out.pop("resume_text", None)
        out.pop("job_description", None)
    return out


def save_version(data: dict) -> dict:
    global _counter
    doc = dict(data)
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    col = get_collection()
    if col is not None:
        try:
            doc["_id"] = col.insert_one(doc).inserted_id
            return _public(doc, with_text=False)
        except PyMongoError:
            pass  # fall through to memory so the app keeps working
    _counter += 1
    doc["_id"] = f"m{_counter}"
    _memory.append(doc)
    del _memory[:-100]
    return _public(doc, with_text=False)


def list_versions(limit: int) -> list[dict]:
    col = get_collection()
    if col is not None:
        try:
            return [_public(d, False) for d in col.find({}).sort("_id", -1).limit(limit)]
        except PyMongoError:
            return []
    return [_public(d, False) for d in reversed(_memory[-limit:])]


def get_version(version_id: str) -> Optional[dict]:
    col = get_collection()
    if col is not None:
        try:
            doc = col.find_one({"_id": ObjectId(version_id)})
            return _public(doc, True) if doc else None
        except (InvalidId, PyMongoError):
            return None
    for d in _memory:
        if d["_id"] == version_id:
            return _public(d, True)
    return None


def delete_version(version_id: str) -> bool:
    col = get_collection()
    if col is not None:
        try:
            return col.delete_one({"_id": ObjectId(version_id)}).deleted_count > 0
        except (InvalidId, PyMongoError):
            return False
    for i, d in enumerate(_memory):
        if d["_id"] == version_id:
            del _memory[i]
            return True
    return False
