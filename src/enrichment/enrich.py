"""Cache-first artist enrichment workflow."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Any
import unicodedata

import pandas as pd
from dotenv import load_dotenv

from .artist_resolver import Resolution, normalize_name, resolve_candidates
from .cache import EnrichmentCache
from .lastfm_tags_client import LastFMArtistTagsClient, LastFMTagError
from .musicbrainz_client import MusicBrainzClient, MusicBrainzError
from .storage import read_artist_tags, read_artists, read_metadata, write_metadata, write_normalized

LOGGER = logging.getLogger("enrichment")
ARTIST_COLUMNS = [
    "artist_key", "source_artist_name", "musicbrainz_artist_id", "canonical_name", "sort_name", "artist_type",
    "country", "area", "begin_area", "begin_date", "end_date", "disambiguation", "resolution_status",
    "resolution_method", "resolution_confidence", "candidate_count", "musicbrainz_retrieved_at",
    "lastfm_tags_retrieved_at", "enriched_at",
]
TAG_COLUMNS = ["artist_key", "tag", "tag_normalized", "tag_count", "tag_rank", "source", "retrieved_at"]


def artist_key(name: str) -> str:
    # Preserve case in the local entity key.  Case-folding here would silently
    # merge distinct Silver source names; case-insensitive matching is reserved
    # for MusicBrainz candidate comparison.
    identity = " ".join(unicodedata.normalize("NFKC", str(name)).strip().split())
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def _first_nonempty(values: pd.Series) -> str | None:
    values = values.dropna().astype(str).str.strip()
    values = values[values != ""]
    return values.iloc[0] if not values.empty else None


def extract_artist_entities(silver_path: str | Path) -> pd.DataFrame:
    silver = pd.read_parquet(silver_path, columns=["artist_name", "artist_mbid", "scrobble_id", "scrobbled_at"])
    silver["artist_key"] = silver["artist_name"].map(artist_key)
    names = silver.groupby(["artist_key", "artist_name"], as_index=False).size()
    names = names.sort_values(["artist_key", "size", "artist_name"], ascending=[True, False, True])
    source_names = names.drop_duplicates("artist_key").set_index("artist_key")["artist_name"]
    grouped = silver.groupby("artist_key")
    entities = grouped.agg(total_scrobbles=("scrobble_id", "size"), first_seen=("scrobbled_at", "min"), last_seen=("scrobbled_at", "max")).reset_index()
    entities["source_artist_name"] = entities["artist_key"].map(source_names)
    mbids = grouped["artist_mbid"].apply(_first_nonempty).rename("existing_artist_mbid").reset_index()
    entities = entities.merge(mbids, on="artist_key", how="left")
    return entities.sort_values(["total_scrobbles", "source_artist_name"], ascending=[False, True]).reset_index(drop=True)


def _load_json(path: str | Path, default: Any) -> Any:
    path = Path(path)
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _area_name(value: Any) -> str | None:
    return str(value.get("name")) if isinstance(value, dict) and value.get("name") else None


def _resolution_from_direct(response: dict[str, Any] | None, mbid: str, method: str = "existing_mbid") -> Resolution:
    if response and response.get("id") == mbid:
        return Resolution("resolved", method, "high", response, [])
    return Resolution("not_found", method, None, None, [])


def _resolution_from_search(artist_name: str, body: dict[str, Any] | None) -> Resolution:
    candidates = body.get("artists", []) if isinstance(body, dict) else []
    return resolve_candidates(artist_name, candidates if isinstance(candidates, list) else [])


def _safe_error(exc: BaseException) -> str:
    return type(exc).__name__


def _resolve_with_cache(entity: pd.Series, mb_client: MusicBrainzClient | None, cache: EnrichmentCache,
                        from_cache: bool, stats: dict[str, int], override: dict[str, Any] | None = None) -> tuple[Resolution, str | None]:
    name = str(entity.source_artist_name)
    existing_mbid = str(entity.existing_artist_mbid) if pd.notna(entity.existing_artist_mbid) and entity.existing_artist_mbid else None
    method_override = False
    if override and override.get("musicbrainz_artist_id"):
        existing_mbid = str(override["musicbrainz_artist_id"])
        method_override = True
    if existing_mbid:
        identity = f"mbid:{existing_mbid}"
        cached = cache.load("musicbrainz", "artist", identity)
        if cached:
            stats["cache_hits"] += 1
            if cached["status"] == "success":
                resolution = _resolution_from_direct(cached.get("response"), existing_mbid, "manual_override" if method_override else "existing_mbid")
                if resolution.status == "resolved":
                    return resolution, cached.get("retrieved_at")
            elif cached["status"] == "error":
                if from_cache or not mb_client:
                    return Resolution("error", "manual_override" if method_override else "existing_mbid", None, None, [], cached.get("error")), cached.get("retrieved_at")
        elif not from_cache and mb_client:
            stats["api_requests"] += 1
            try:
                response = mb_client.get_artist(existing_mbid)
                cache.store("musicbrainz", "artist", identity, "success" if response else "not_found", response)
                resolution = _resolution_from_direct(response, existing_mbid, "manual_override" if method_override else "existing_mbid")
                if resolution.status == "resolved":
                    return resolution, datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            except MusicBrainzError as exc:
                cache.store("musicbrainz", "artist", identity, "error", error=_safe_error(exc))
                return Resolution("error", "manual_override" if method_override else "existing_mbid", None, None, [], _safe_error(exc)), None
        elif from_cache:
            return Resolution("error", "manual_override" if method_override else "existing_mbid", None, None, [], "cache_miss"), None
    identity = f"name:{normalize_name(name)}"
    cached = cache.load("musicbrainz", "artist", identity)
    if cached:
        stats["cache_hits"] += 1
        if cached["status"] == "success":
            return _resolution_from_search(name, cached.get("response")), cached.get("retrieved_at")
        if cached["status"] == "not_found":
            return Resolution("not_found", "search_match", None, None, []), cached.get("retrieved_at")
        if from_cache or not mb_client:
            return Resolution("error", "search_match", None, None, [], cached.get("error")), cached.get("retrieved_at")
    if from_cache or not mb_client:
        return Resolution("error", "search_match", None, None, [], "cache_miss"), None
    stats["api_requests"] += 1
    try:
        candidates = mb_client.search_artists(name)
        body = {"artists": candidates}
        cache.store("musicbrainz", "artist", identity, "success" if candidates else "not_found", body)
        return resolve_candidates(name, candidates), datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    except MusicBrainzError as exc:
        cache.store("musicbrainz", "artist", identity, "error", error=_safe_error(exc))
        return Resolution("error", "search_match", None, None, [], _safe_error(exc)), None


def _tag_normalized(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).strip().casefold().split())


def _tag_rows(artist_key_value: str, body: dict[str, Any], limit: int, retrieved_at: str) -> list[dict[str, Any]]:
    raw_tags = body.get("toptags", {}).get("tag", []) if isinstance(body.get("toptags"), dict) else []
    if isinstance(raw_tags, dict):
        raw_tags = [raw_tags]
    rows = []
    for rank, tag in enumerate(raw_tags[:limit], start=1):
        if not isinstance(tag, dict) or not str(tag.get("name", "")).strip():
            continue
        try:
            count = int(tag.get("count", 0))
        except (TypeError, ValueError):
            count = 0
        rows.append({"artist_key": artist_key_value, "tag": str(tag["name"]).strip(),
                     "tag_normalized": _tag_normalized(str(tag["name"])), "tag_count": max(count, 0),
                     "tag_rank": rank, "source": "lastfm", "retrieved_at": retrieved_at})
    return rows


def _artist_row(entity: pd.Series, resolution: Resolution, mb_retrieved_at: str | None,
                tags_retrieved_at: str | None, enriched_at: str, override: dict[str, Any] | None) -> dict[str, Any]:
    response = resolution.response or {}
    return {
        "artist_key": entity.artist_key, "source_artist_name": entity.source_artist_name,
        "musicbrainz_artist_id": response.get("id"), "canonical_name": response.get("name"),
        "sort_name": response.get("sort-name"), "artist_type": response.get("type"),
        "country": response.get("country"), "area": _area_name(response.get("area")),
        "begin_area": _area_name(response.get("begin-area")), "begin_date": response.get("life-span", {}).get("begin") if isinstance(response.get("life-span"), dict) else None,
        "end_date": response.get("life-span", {}).get("end") if isinstance(response.get("life-span"), dict) else None,
        "disambiguation": response.get("disambiguation"), "resolution_status": resolution.status,
        "resolution_method": resolution.method, "resolution_confidence": resolution.confidence,
        "candidate_count": len(resolution.candidates), "musicbrainz_retrieved_at": mb_retrieved_at,
        "lastfm_tags_retrieved_at": tags_retrieved_at, "enriched_at": enriched_at,
    }


def _empty_artists() -> pd.DataFrame:
    return pd.DataFrame(columns=ARTIST_COLUMNS)


def _empty_tags() -> pd.DataFrame:
    return pd.DataFrame(columns=TAG_COLUMNS)


def calculate_coverage(silver: pd.DataFrame, artists: pd.DataFrame, tags: pd.DataFrame) -> dict[str, Any]:
    total_artists = int(silver["artist_name"].map(artist_key).nunique())
    artists = artists.copy()
    evaluated_keys = set(artists["artist_key"])
    resolved_keys = set(artists.loc[artists["resolution_status"] == "resolved", "artist_key"])
    tagged_keys = set(tags["artist_key"]) if not tags.empty else set()
    silver_keys = silver["artist_name"].map(artist_key)
    evaluated_events = silver_keys.isin(evaluated_keys)
    return {
        "unique_artists": total_artists,
        "evaluated_artists": len(evaluated_keys),
        "existing_artist_mbid": int((silver.groupby(silver_keys)["artist_mbid"].apply(_first_nonempty).notna()).sum()),
        "resolved_artists": len(resolved_keys),
        "ambiguous_artists": int((artists["resolution_status"] == "ambiguous").sum()),
        "not_found_artists": int((artists["resolution_status"] == "not_found").sum()),
        "error_artists": int((artists["resolution_status"] == "error").sum()),
        "musicbrainz_entity_coverage_pct": round(len(resolved_keys) / len(evaluated_keys) * 100, 3) if evaluated_keys else 0,
        "musicbrainz_event_coverage_pct": round(silver_keys[evaluated_events].isin(resolved_keys).mean() * 100, 3) if evaluated_events.any() else 0,
        "artists_with_lastfm_tags": len(tagged_keys),
        "lastfm_tag_entity_coverage_pct": round(len(tagged_keys & evaluated_keys) / len(evaluated_keys) * 100, 3) if evaluated_keys else 0,
        "lastfm_tag_event_coverage_pct": round(silver_keys[evaluated_events].isin(tagged_keys).mean() * 100, 3) if evaluated_events.any() else 0,
        "unique_raw_tags": int(tags["tag"].nunique()) if not tags.empty else 0,
        "unique_normalized_tags": int(tags["tag_normalized"].nunique()) if not tags.empty else 0,
    }


def enrich_artists(limit: int | None = None, from_cache: bool = False, profile: bool = False,
                   silver_path: str | Path = "data/silver/scrobbles/scrobbles.parquet",
                   raw_root: str | Path = "data/enrichment/raw", normalized_root: str | Path = "data/enrichment/normalized",
                   config_path: str | Path = "config/enrichment.json", overrides_path: str | Path = "config/artist_overrides.json") -> dict[str, Any]:
    load_dotenv()
    config = _load_json(config_path, {})
    entities = extract_artist_entities(silver_path)
    selected = entities.head(limit) if limit else entities
    existing_artists = read_artists(normalized_root)
    existing_tags = read_artist_tags(normalized_root)
    artist_rows = {row["artist_key"]: row for row in existing_artists.to_dict("records")} if existing_artists is not None else {}
    tag_rows = existing_tags.to_dict("records") if existing_tags is not None else []
    tag_keys = {row["artist_key"] for row in tag_rows}
    overrides = _load_json(overrides_path, {})
    cache = EnrichmentCache(raw_root)
    user_agent = os.getenv("MUSICBRAINZ_USER_AGENT", config.get("musicbrainz_user_agent", "lastfm-data-platform/0.1 (local enrichment)"))
    mb_client = None if from_cache else MusicBrainzClient(user_agent, float(config.get("musicbrainz_interval_seconds", 1.0)))
    api_key = os.getenv("LASTFM_API_KEY", "").strip()
    tags_client = None if from_cache or not api_key else LastFMArtistTagsClient(api_key, float(config.get("lastfm_interval_seconds", 0.5)))
    tag_limit = int(config.get("lastfm_artist_tag_limit", 20))
    stats = {"cache_hits": 0, "api_requests": 0, "tag_api_requests": 0, "tag_cache_hits": 0}
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    for index, entity in enumerate(selected.itertuples(index=False), start=1):
        entity_series = pd.Series(entity._asdict())
        key = entity_series.artist_key
        existing = artist_rows.get(key)
        if existing and existing.get("resolution_status") != "error":
            resolution = None
            mb_retrieved_at = existing.get("musicbrainz_retrieved_at")
        else:
            resolution, mb_retrieved_at = _resolve_with_cache(entity_series, mb_client, cache, from_cache, stats,
                                                              overrides.get(entity_series.source_artist_name) if isinstance(overrides, dict) else None)
        # A timestamp alone is not completion state: older runs also recorded
        # timestamps for failed tag requests.  A key in tag_rows is the durable
        # success marker, including a valid response with zero tags.
        tags_retrieved_at = existing.get("lastfm_tags_retrieved_at") if existing and key in tag_keys else None
        if key not in tag_keys and not tags_retrieved_at:
            tag_identity = f"artist:{key}"
            cached = cache.load("lastfm", "artist_tag", tag_identity)
            if cached:
                stats["tag_cache_hits"] += 1
                retrieved = cached.get("retrieved_at", now)
                if cached.get("status") == "success":
                    tags_retrieved_at = retrieved
                    tag_rows.extend(_tag_rows(key, cached.get("response", {}), tag_limit, retrieved))
                    tag_keys.add(key)
                elif not tags_client or from_cache:
                    tags_retrieved_at = retrieved
            if key not in tag_keys and not tags_retrieved_at and tags_client:
                stats["tag_api_requests"] += 1
                try:
                    body = tags_client.get_top_tags(str(entity_series.source_artist_name))
                    retrieved = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                    cache.store("lastfm", "artist_tag", tag_identity, "success", body)
                    tag_rows.extend(_tag_rows(key, body, tag_limit, retrieved))
                    tag_keys.add(key)
                    tags_retrieved_at = retrieved
                except LastFMTagError as exc:
                    cache.store("lastfm", "artist_tag", tag_identity, "error", error=_safe_error(exc))
                    tags_retrieved_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        if existing and existing.get("resolution_status") != "error":
            existing["lastfm_tags_retrieved_at"] = tags_retrieved_at
            existing["enriched_at"] = now
            artist_rows[key] = existing
        else:
            artist_rows[key] = _artist_row(entity_series, resolution, mb_retrieved_at, tags_retrieved_at, now,
                                           overrides.get(entity_series.source_artist_name) if isinstance(overrides, dict) else None)
        if index % 10 == 0 or index == len(selected):
            artists_df = pd.DataFrame(list(artist_rows.values())).reindex(columns=ARTIST_COLUMNS)
            tags_df = pd.DataFrame(tag_rows).reindex(columns=TAG_COLUMNS) if tag_rows else _empty_tags()
            write_normalized(artists_df, tags_df, normalized_root)
            write_metadata({"processed_artist_keys": sorted(artist_rows), "selected_artist_count": len(selected),
                            "last_checkpoint": now, "cache_hits": stats["cache_hits"], "api_requests": stats["api_requests"],
                            "tag_api_requests": stats["tag_api_requests"], "tag_cache_hits": stats["tag_cache_hits"]}, normalized_root)
        if index == 1 or index % 25 == 0 or index == len(selected):
            LOGGER.info("Artist enrichment: %s/%s; cache hits=%s; API requests=%s; tag requests=%s",
                        index, len(selected), stats["cache_hits"], stats["api_requests"], stats["tag_api_requests"])
    artists_df = pd.DataFrame(list(artist_rows.values())).reindex(columns=ARTIST_COLUMNS) if artist_rows else _empty_artists()
    tags_df = pd.DataFrame(tag_rows).drop_duplicates(["artist_key", "tag_normalized"], keep="first").reindex(columns=TAG_COLUMNS) if tag_rows else _empty_tags()
    # Checkpoints intentionally favor durability; rewrite the final normalized
    # outputs from the deduplicated frame before calculating/reporting coverage.
    write_normalized(artists_df, tags_df, normalized_root)
    coverage = calculate_coverage(pd.read_parquet(silver_path, columns=["artist_name", "artist_mbid"]), artists_df, tags_df)
    metadata = {**read_metadata(normalized_root), "coverage": coverage, "last_run": stats, "normalized_schema_version": 1}
    write_metadata(metadata, normalized_root)
    if profile:
        LOGGER.info("Enrichment coverage: %s", coverage)
    return {"coverage": coverage, "stats": stats, "processed": len(selected)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Enrich unique Last.fm artists with MusicBrainz and Last.fm tags")
    parser.add_argument("--limit", type=int, help="Process the top N artists by recorded scrobbles")
    parser.add_argument("--from-cache", action="store_true", help="Use only local provider caches")
    parser.add_argument("--profile", action="store_true", help="Log coverage metrics")
    parser.add_argument("--resume", action="store_true", help="Resume using cached/normalized entities")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    enrich_artists(limit=args.limit, from_cache=args.from_cache, profile=args.profile)


if __name__ == "__main__":
    main()
