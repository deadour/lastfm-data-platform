"""Convert completed Last.fm Bronze records into typed Silver scrobbles."""

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import re
from typing import Any

import pandas as pd

from .bronze_reader import BronzeRun, iter_run_pages


SILVER_COLUMNS = [
    "scrobble_id", "user", "track_name", "artist_name", "album_name", "track_mbid", "artist_mbid",
    "album_mbid", "lastfm_track_url", "scrobbled_at", "scrobble_date", "scrobble_year", "scrobble_month",
    "scrobble_day", "scrobble_hour", "scrobble_weekday", "source", "bronze_run_id", "bronze_page",
    "transformed_at",
]
_WHITESPACE = re.compile(r"\s+")


@dataclass
class TransformStats:
    raw_records: int = 0
    completed_scrobbles: int = 0
    now_playing_skipped: int = 0
    malformed_rejected: int = 0
    duplicates_removed: int = 0


def _text(value: Any) -> str:
    return str(value or "").strip()


def _optional(value: Any) -> str | None:
    value = _text(value)
    return value or None


def _canonical(value: str) -> str:
    return _WHITESPACE.sub(" ", value).strip().casefold()


def _event_id(user: str, artist: str, track: str, timestamp: int) -> str:
    identity = "\x1f".join((_canonical(user), _canonical(artist), _canonical(track), str(timestamp)))
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def _reject(rejected: list[dict[str, Any]], reason: str, run: BronzeRun, page: int, track: Any) -> None:
    rejected.append({"reason": reason, "bronze_run_id": run.run_id, "bronze_page": page, "record": track})


def transform_runs(runs: list[BronzeRun], transformed_at: datetime | None = None) -> tuple[pd.DataFrame, TransformStats, list[dict[str, Any]]]:
    """Transform selected runs, excluding now-playing and quarantining malformed records."""
    transformed_at = transformed_at or datetime.now(timezone.utc)
    stats = TransformStats()
    rejected: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    for run in runs:
        for page, document in iter_run_pages(run):
            recent = document["payload"]["recenttracks"]
            recent_attributes = recent.get("@attr") if isinstance(recent.get("@attr"), dict) else {}
            user = _text(recent_attributes.get("user"))
            for track in recent["track"]:
                stats.raw_records += 1
                if not isinstance(track, dict):
                    stats.malformed_rejected += 1
                    _reject(rejected, "record_is_not_an_object", run, page, track)
                    continue
                track_attributes = track.get("@attr") if isinstance(track.get("@attr"), dict) else {}
                if track_attributes.get("nowplaying") == "true":
                    stats.now_playing_skipped += 1
                    continue
                artist_object = track.get("artist") if isinstance(track.get("artist"), dict) else {}
                album_object = track.get("album") if isinstance(track.get("album"), dict) else {}
                artist = _text(artist_object.get("#text"))
                name = _text(track.get("name"))
                timestamp_value = track.get("date", {}).get("uts") if isinstance(track.get("date"), dict) else None
                try:
                    timestamp = int(timestamp_value)
                    event_time = pd.Timestamp.fromtimestamp(timestamp, tz="UTC")
                    if event_time.year < 1970 or event_time.year > 2100:
                        raise ValueError
                except (TypeError, ValueError, OverflowError, OSError):
                    stats.malformed_rejected += 1
                    _reject(rejected, "invalid_scrobble_timestamp", run, page, track)
                    continue
                missing = [field for field, value in (("user", user), ("artist_name", artist), ("track_name", name)) if not value]
                if missing:
                    stats.malformed_rejected += 1
                    _reject(rejected, "missing_required:" + ",".join(missing), run, page, track)
                    continue
                stats.completed_scrobbles += 1
                rows.append({
                    "scrobble_id": _event_id(user, artist, name, timestamp),
                    "user": user,
                    "track_name": name,
                    "artist_name": artist,
                    "album_name": _optional(album_object.get("#text")),
                    "track_mbid": _optional(track.get("mbid")),
                    "artist_mbid": _optional(artist_object.get("mbid")),
                    "album_mbid": _optional(album_object.get("mbid")),
                    "lastfm_track_url": _optional(track.get("url")),
                    "scrobbled_at": event_time,
                    "scrobble_date": event_time.date(),
                    "scrobble_year": event_time.year,
                    "scrobble_month": event_time.month,
                    "scrobble_day": event_time.day,
                    "scrobble_hour": event_time.hour,
                    "scrobble_weekday": event_time.weekday(),
                    "source": "lastfm",
                    "bronze_run_id": run.run_id,
                    "bronze_page": page,
                    "transformed_at": transformed_at,
                })
    dataframe = pd.DataFrame(rows, columns=SILVER_COLUMNS)
    if not dataframe.empty:
        before = len(dataframe)
        dataframe = dataframe.sort_values(["scrobbled_at", "bronze_run_id", "bronze_page", "scrobble_id"])
        dataframe = dataframe.drop_duplicates("scrobble_id", keep="first").reset_index(drop=True)
        stats.duplicates_removed = before - len(dataframe)
    return _type_dataframe(dataframe), stats, rejected


def _type_dataframe(dataframe: pd.DataFrame) -> pd.DataFrame:
    dataframe = dataframe.reindex(columns=SILVER_COLUMNS)
    string_columns = ["scrobble_id", "user", "track_name", "artist_name", "album_name", "track_mbid", "artist_mbid",
                      "album_mbid", "lastfm_track_url", "source", "bronze_run_id"]
    for column in string_columns:
        dataframe[column] = dataframe[column].astype("string")
    for column in ["scrobbled_at", "transformed_at"]:
        dataframe[column] = pd.to_datetime(dataframe[column], utc=True)
    dataframe["scrobble_date"] = pd.to_datetime(dataframe["scrobble_date"]).dt.date
    for column in ["scrobble_year", "scrobble_month", "scrobble_day", "scrobble_hour", "scrobble_weekday", "bronze_page"]:
        dataframe[column] = pd.to_numeric(dataframe[column], errors="coerce").astype("Int64")
    return dataframe


def validate_dataframe(dataframe: pd.DataFrame) -> None:
    """Raise if Silver violates its event-level invariants."""
    missing_columns = set(SILVER_COLUMNS) - set(dataframe.columns)
    if missing_columns:
        raise ValueError(f"Silver schema is missing columns: {sorted(missing_columns)}")
    if dataframe["scrobble_id"].duplicated().any():
        raise ValueError("Silver scrobble_id values are not unique")
    required = dataframe[["user", "artist_name", "track_name", "scrobbled_at"]]
    if required.isna().any().any():
        raise ValueError("Silver required fields contain nulls")
    if not str(dataframe["scrobbled_at"].dtype).startswith("datetime64[ns, UTC]"):
        raise ValueError("Silver scrobbled_at must be timezone-aware UTC")


def profile_dataframe(dataframe: pd.DataFrame) -> dict[str, Any]:
    """Return aggregate validation metrics without printing personal records."""
    row_count = len(dataframe)
    return {
        "silver_rows": row_count,
        "earliest_event": dataframe["scrobbled_at"].min().isoformat() if row_count else None,
        "latest_event": dataframe["scrobbled_at"].max().isoformat() if row_count else None,
        "unique_artists": int(dataframe["artist_name"].nunique()) if row_count else 0,
        "unique_tracks": int(dataframe[["artist_name", "track_name"]].drop_duplicates().shape[0]) if row_count else 0,
        "missing_track_mbid_pct": round(float(dataframe["track_mbid"].isna().mean() * 100), 3) if row_count else 0.0,
        "missing_artist_mbid_pct": round(float(dataframe["artist_mbid"].isna().mean() * 100), 3) if row_count else 0.0,
        "missing_album_pct": round(float(dataframe["album_name"].isna().mean() * 100), 3) if row_count else 0.0,
    }
