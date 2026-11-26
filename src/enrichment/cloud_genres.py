"""Artist genres for the cloud export, from Last.fm artist tags.

The local enrichment (MusicBrainz + tags) only runs on the owner's machine.
This is its cloud counterpart for the public site: one ``artist.getTopTags``
call per artist, kept in an incremental catalog in the lake so each artist is
asked about once. Tags are mapped to genre families with the existing
``config/tag_taxonomy.json``; anything outside the taxonomy stays a plain tag
and never invents a family.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from typing import Any, Iterable

from src.analytics.enriched_builder import classify_tag, load_taxonomy
from src.artwork.matching import normalize

from .lastfm_tags_client import LastFMArtistTagsClient, LastFMTagError

CATALOG_BLOB = "enrichment/frontend/genres.json"
FIELDS = ("artist", "status", "tags", "checked_at")
RETRY_NOT_FOUND_DAYS = 30
REFRESH_RESOLVED_DAYS = 180
KEEP_TAGS = 8


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_tags(body: dict[str, Any]) -> list[dict[str, Any]]:
    """Top tags as [{name, count}], lowercase, provider order kept."""
    tags = (body.get("toptags") or {}).get("tag") or []
    if isinstance(tags, dict):
        tags = [tags]
    out = []
    for tag in tags:
        if not isinstance(tag, dict) or not str(tag.get("name", "")).strip():
            continue
        try:
            count = int(tag.get("count", 0))
        except (TypeError, ValueError):
            count = 0
        out.append({"name": str(tag["name"]).strip().casefold(), "count": count})
    return out[:KEEP_TAGS]


def load(content: bytes | None) -> dict[str, dict[str, Any]]:
    if not content:
        return {}
    rows = json.loads(content)
    if not isinstance(rows, list) or not all(isinstance(r, dict) and set(r) == set(FIELDS) for r in rows):
        raise ValueError("Genre catalog has an unexpected shape")
    catalog = {normalize(r["artist"]): r for r in rows}
    if len(catalog) != len(rows) or not all(r["status"] in {"resolved", "not_found"} for r in rows):
        raise ValueError("Genre catalog has duplicate artists or invalid statuses")
    return catalog


def dump(catalog: dict[str, dict[str, Any]]) -> bytes:
    rows = sorted(catalog.values(), key=lambda r: normalize(r["artist"]))
    return json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def due(record: dict[str, Any] | None, now: datetime) -> bool:
    if record is None:
        return True
    age = now - datetime.fromisoformat(record["checked_at"].replace("Z", "+00:00"))
    days = REFRESH_RESOLVED_DAYS if record["status"] == "resolved" else RETRY_NOT_FOUND_DAYS
    return age >= timedelta(days=days)


def refresh(catalog: dict[str, dict[str, Any]], artists: Iterable[str], client: LastFMArtistTagsClient,
            limit: int = 400, now: datetime | None = None, mbids: dict[str, str] | None = None) -> int:
    """Ask Last.fm about at most ``limit`` artists that are new or due; stop on provider errors.

    When Silver knows an artist's MusicBrainz id it is used instead of the name,
    so a namesake's tags (another band called Virus) cannot be picked up.
    """
    now = now or datetime.now(timezone.utc)
    mbids = mbids or {}
    checked = 0
    for name in artists:
        if checked >= limit:
            break
        key = normalize(name)
        if not due(catalog.get(key), now):
            continue
        try:
            tags = parse_tags(client.get_top_tags(name, mbids.get(name)))
        except LastFMTagError as exc:
            if "error 6" not in str(exc):
                break
            tags = []
            if mbids.get(name):  # unknown mbid on last.fm: fall back to the name once
                try:
                    tags = parse_tags(client.get_top_tags(name))
                except LastFMTagError:
                    tags = []
        catalog[key] = {"artist": name, "status": "resolved" if tags else "not_found", "tags": tags, "checked_at": _now()}
        checked += 1
    return checked


class Genres:
    """Genre lookups for export: families weighted by tag rank, via the shared taxonomy."""

    def __init__(self, catalog: dict[str, dict[str, Any]], taxonomy: dict[str, Any] | None = None,
                 taxonomy_path: Path = Path("config/tag_taxonomy.json")):
        self.catalog = catalog
        self.taxonomy = taxonomy or load_taxonomy(taxonomy_path)
        self.max_tags = int(self.taxonomy.get("max_tags_per_artist", 5))

    def tags(self, artist: str) -> list[str]:
        record = self.catalog.get(normalize(artist))
        if not record or record["status"] != "resolved":
            return []
        return [t["name"] for t in record["tags"] if classify_tag(t["name"], self.taxonomy)[0] != "noise"]

    def families(self, artist: str) -> dict[str, float]:
        """Family weights summing to 1, from the artist's top genre tags (inverse rank)."""
        weights: dict[str, float] = {}
        genre_tags = [t for t in self.tags(artist) if classify_tag(t, self.taxonomy)[0] == "genre_style"][: self.max_tags]
        for rank, tag in enumerate(genre_tags, start=1):
            family = classify_tag(tag, self.taxonomy)[1]
            weights[family] = weights.get(family, 0.0) + 1.0 / rank
        total = sum(weights.values())
        return {f: w / total for f, w in weights.items()} if total else {}

    def primary(self, artist: str) -> str | None:
        families = self.families(artist)
        return max(families, key=families.get) if families else None

    def style(self, artist: str) -> str | None:
        """The most specific genre tag Last.fm listeners use for the artist."""
        return next((t for t in self.tags(artist) if classify_tag(t, self.taxonomy)[0] == "genre_style"), None)


def artist_mbids(silver_path: Path) -> dict[str, str]:
    """The most common non-empty MusicBrainz artist id per artist name in Silver."""
    import pandas as pd
    frame = pd.read_parquet(silver_path, columns=["artist_name", "artist_mbid"])
    frame = frame[frame["artist_mbid"].fillna("").astype(str).str.strip() != ""]
    counts = frame.groupby(["artist_name", "artist_mbid"]).size().rename("n").reset_index()
    best = counts.sort_values("n", ascending=False, kind="stable").drop_duplicates("artist_name")
    return dict(zip(best["artist_name"], best["artist_mbid"]))
