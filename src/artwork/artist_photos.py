"""Artist photos from Deezer's public API, kept in an incremental catalog.

Last.fm's API no longer serves artist images, so photos come from Deezer
search. A photo is accepted only when one result has the same normalized
name and a real picture. When several artists share that exact name, the
first is accepted only with ten times the fans of the next; otherwise it is
stored as ``needs_review`` and never shown. Resolved artists are not queried again and
``not_found`` is retried after ``RETRY_DAYS``. Only URLs are stored; images are
not rehosted.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import re
from typing import Any, Iterable

from .clients import ArtworkError, Deezer
from .export_frontend import public_url
from .matching import normalize

CATALOG_BLOB = "artwork/frontend/artists.json"
RETRY_DAYS = 30
DOMINANCE = 10
FIELDS = ("artist", "status", "image_url", "source_url", "checked_at")
_PLACEHOLDER = re.compile(r"/images/artist//")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def match(name: str, results: Iterable[dict[str, Any]]) -> dict[str, Any]:
    target = normalize(name)
    fans = lambda r: r.get("nb_fan") if isinstance(r.get("nb_fan"), int) else 0
    exact = sorted({r.get("id"): r for r in results if normalize(str(r.get("name", ""))) == target}.values(),
                   key=fans, reverse=True)
    if not exact:
        return {"status": "not_found", "image_url": None, "source_url": None}
    # Same name, different artists: accept only a clear winner (10x the fans of the runner-up).
    if len(exact) > 1 and fans(exact[0]) < DOMINANCE * max(fans(exact[1]), 1):
        return {"status": "needs_review", "image_url": None, "source_url": None}
    picture, link = exact[0].get("picture_xl"), exact[0].get("link")
    if not public_url(picture) or _PLACEHOLDER.search(picture or "") or not public_url(link, source=True):
        return {"status": "not_found", "image_url": None, "source_url": None}
    return {"status": "resolved", "image_url": picture, "source_url": link}


def load(content: bytes | None) -> dict[str, dict[str, Any]]:
    if not content:
        return {}
    rows = json.loads(content)
    if not isinstance(rows, list) or not all(isinstance(r, dict) and set(r) == set(FIELDS) for r in rows):
        raise ValueError("Artist photo catalog has an unexpected shape")
    catalog = {normalize(r["artist"]): r for r in rows}
    if len(catalog) != len(rows) or not all(r["status"] in {"resolved", "needs_review", "not_found"} for r in rows):
        raise ValueError("Artist photo catalog has duplicate artists or invalid statuses")
    return catalog


def dump(catalog: dict[str, dict[str, Any]]) -> bytes:
    rows = sorted(catalog.values(), key=lambda r: normalize(r["artist"]))
    return json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def due(record: dict[str, Any] | None, now: datetime) -> bool:
    if record is None:
        return True
    if record["status"] != "not_found":
        return False  # resolved stays; needs_review waits for a person
    checked = datetime.fromisoformat(record["checked_at"].replace("Z", "+00:00"))
    return now - checked >= timedelta(days=RETRY_DAYS)


def refresh(catalog: dict[str, dict[str, Any]], artists: Iterable[str], client: Deezer,
            now: datetime | None = None) -> int:
    """Query only artists that are new or due; stops quietly if the provider refuses."""
    now = now or datetime.now(timezone.utc)
    checked = 0
    for name in artists:
        key = normalize(name)
        if not due(catalog.get(key), now):
            continue
        try:
            result = match(name, client.search_artists(name))
        except ArtworkError:
            break
        catalog[key] = {"artist": name, **result, "checked_at": _now()}
        checked += 1
    return checked


def photo(catalog: dict[str, dict[str, Any]], name: str) -> dict[str, Any] | None:
    record = catalog.get(normalize(name))
    if not record or record["status"] != "resolved":
        return None
    return {"url": record["image_url"], "source_url": record["source_url"], "attribution": "deezer"}
