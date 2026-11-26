"""Small static JSON for the React frontend: Gold statistics plus resolved covers.

    python -m src.artwork.export_frontend --out data/exports/frontend/stats.json

The file is meant to be served as a static asset. It contains aggregates and
public image URLs only: no username, API key, storage account or blob path.
Covers are included only for ``resolved`` catalog rows; ``needs_review`` and
``rejected`` never reach the frontend.

Gold has no album mart yet, so album play counts (and the album a track is
mostly played from) come from Silver here. The shape matches
``frontend/src/data/types.ts`` ``StatsFile``; ``data_as_of``, ``totals.albums``,
``top_albums`` and ``cover`` are additions the frontend may ignore.

Image URLs resolve through these hosts (for the frontend's CSP img-src):
coverartarchive.org -> archive.org -> *.archive.org, and cdn-images.dzcdn.net /
e-cdns-images.dzcdn.net for Deezer.
"""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
from typing import Any
from urllib.parse import urlsplit

import pandas as pd

from .enrich import CATALOG_DIR, albums_from_silver, read_catalog
from .matching import album_key

SCHEMA_VERSION = 1
ATTRIBUTION = {"coverartarchive": "cover art archive", "deezer": "deezer"}


def public_url(value: Any, *, source: bool = False) -> bool:
    """Only provider URLs without embedded credentials or query tokens are public."""
    if not isinstance(value, str):
        return False
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        allowed = ({"musicbrainz.org", "www.deezer.com", "deezer.com"} if source else
                   {"coverartarchive.org", "archive.org", "cdn-images.dzcdn.net", "e-cdns-images.dzcdn.net"})
        approved = host in allowed or (not source and host.endswith(".archive.org"))
        return (approved and parsed.scheme == "https" and parsed.port in (None, 443)
                and parsed.username is None and parsed.password is None and not parsed.query and not parsed.fragment)
    except ValueError:
        return False


def _int(value) -> int:
    return int(value) if pd.notna(value) else 0


def _date(value) -> str | None:
    return None if pd.isna(value) else pd.Timestamp(value).date().isoformat()


def cover(row: pd.Series | None) -> dict[str, Any] | None:
    # Only https images are exported; the frontend is served over https with a strict CSP.
    if (row is None or row.get("status") != "resolved" or row.get("provider") not in ATTRIBUTION
            or not public_url(row.get("image_url")) or not public_url(row.get("source_url"), source=True)):
        return None
    return {"url": row["image_url"], "provider": row["provider"], "source_url": row.get("source_url"),
            "attribution": ATTRIBUTION.get(row["provider"], row["provider"])}


def _partial(year: int, era: str, first: pd.Timestamp, last: pd.Timestamp) -> bool:
    """Partial tracking era, or a calendar year the data does not fully cover."""
    return (era == "partial_tracking" or (year == first.year and (first.month, first.day) != (1, 1))
            or (year == last.year and (last.month, last.day) != (12, 31)))


def build(gold_root: Path, silver_path: Path, catalog: pd.DataFrame, top: int = 20,
          release_years: dict[str, int] | None = None, extra_album_keys: set[str] | None = None) -> dict[str, Any]:
    """Document matching frontend/src/data/types.ts ``StatsFile`` (schema_version 1)."""
    meta = json.loads((gold_root / "_metadata.json").read_text(encoding="utf-8"))
    yearly = pd.read_parquet(gold_root / "listening_yearly/listening_yearly.parquet").sort_values("year")
    monthly = pd.read_parquet(gold_root / "listening_monthly/listening_monthly.parquet").sort_values(["year", "month"])
    daily = pd.read_parquet(gold_root / "listening_daily/listening_daily.parquet", columns=["date", "scrobble_count"])
    artists = (pd.read_parquet(gold_root / "artist_stats/artist_stats.parquet", columns=["artist_name", "total_scrobbles"])
               .drop_duplicates("artist_name").sort_values(["total_scrobbles", "artist_name"], ascending=[False, True]))
    tracks = (pd.read_parquet(gold_root / "track_stats/track_stats.parquet",
                              columns=["artist_name", "track_name", "total_scrobbles"])
              .sort_values(["total_scrobbles", "artist_name", "track_name"], ascending=[False, True, True]))
    patterns = pd.read_parquet(gold_root / "listening_patterns/listening_patterns.parquet")
    streaks = pd.read_parquet(gold_root / "listening_patterns/streaks.parquet")
    plays = pd.read_parquet(silver_path, columns=["artist_name", "album_name", "album_mbid", "track_name", "scrobbled_at"])
    albums = albums_from_silver(plays)
    selected_albums = pd.concat([albums.head(max(top, 500)), albums[albums.album_key.isin(extra_album_keys or set())]]).drop_duplicates("album_key")
    release = release_years or {}
    from src.analytics.historical_time import add_historical_local_time
    album_events = plays[plays["album_name"].fillna("").str.strip() != ""].copy()
    album_events["album_key"] = [album_key(a, b) for a, b in zip(album_events.artist_name, album_events.album_name)]
    selected_keys = set(selected_albums["album_key"])
    album_events = add_historical_local_time(album_events[album_events.album_key.isin(selected_keys)],
        Path(__file__).resolve().parents[2] / "config/timezone_periods.json")
    details = {}
    for key, group in album_events.groupby("album_key"):
        counts = group.groupby("track_name").size().sort_values(ascending=False)
        yearly_counts = group.groupby("local_year").size()
        details[key] = {
            "first": _date(group["scrobbled_at_local"].min()), "last": _date(group["scrobbled_at_local"].max()),
            "unique_tracks": len(counts),
            "tracks": [{"title": title, "scrobbles": int(count)} for title, count in counts.head(50).items()],
            "years": [{"year": int(year), "scrobbles": int(count)} for year, count in yearly_counts.items()],
        }
    covers = catalog.set_index("album_key") if len(catalog) else pd.DataFrame(columns=catalog.columns)

    def album_cover(key: str) -> dict[str, Any] | None:
        return cover(covers.loc[key]) if key in covers.index else None

    # A track borrows the cover of the album it was most often played from.
    named = plays.assign(album_name=plays["album_name"].fillna("").str.strip()).query("album_name != ''")
    counts = (named.groupby(["artist_name", "track_name", "album_name"]).size().rename("n").reset_index()
              .sort_values(["n", "album_name"], ascending=[False, True])
              .drop_duplicates(["artist_name", "track_name"]))
    track_album = {(a, t): album_key(a, b) for a, t, b in zip(counts.artist_name, counts.track_name, counts.album_name)}

    first, last = pd.Timestamp(daily["date"].min()), pd.Timestamp(daily["date"].max())
    consistent = patterns[patterns["tracking_era"] == "consistent_tracking"]
    if consistent.empty:
        consistent = patterns
    cells = consistent.groupby(["weekday", "hour"])["scrobble_count"].sum()
    total = float(cells.sum()) or 1.0
    longest = streaks.sort_values(["days", "start_date"], ascending=[False, True]).head(1)

    return {
        "schema_version": SCHEMA_VERSION,
        "source": "gold",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "data_as_of": meta.get("generated_at"),
        "range": {"first": _date(first), "last": _date(last)},
        "totals": {"scrobbles": _int(meta.get("source_silver_rows")), "artists": int(len(artists)),
                   "tracks": int(len(tracks)), "albums": int(len(albums)),
                   "active_days": int((daily["scrobble_count"] > 0).sum())},
        "years": [{"year": _int(r.year), "scrobbles": _int(r.scrobble_count), "artists": _int(r.unique_artists),
                   "tracks": _int(r.unique_tracks), "top_artist": r.top_artist if isinstance(r.top_artist, str) else None,
                   "partial": _partial(int(r.year), r.tracking_era, first, last)} for r in yearly.itertuples()],
        "months": [{"month": r.year_month, "scrobbles": _int(r.scrobble_count)} for r in monthly.tail(24).itertuples()],
        "top_artists": [{"name": r.artist_name, "scrobbles": _int(r.total_scrobbles), "image": None}
                        for r in artists.head(top).itertuples()],
        "top_tracks": [{"title": r.track_name, "artist": r.artist_name, "scrobbles": _int(r.total_scrobbles),
                        "image": (album_cover(track_album.get((r.artist_name, r.track_name), "")) or {}).get("url")}
                       for r in tracks.head(max(top, 100)).itertuples()],
        "top_albums": [{"key": r.album_key, "title": r.album_name, "artist": r.artist_name,
                        "year": release.get(r.album_key),
                        "scrobbles": _int(r.scrobbles), "image": (album_cover(r.album_key) or {}).get("url"),
                        "cover": album_cover(r.album_key), "details": details.get(r.album_key)} for r in selected_albums.itertuples()],
        "rhythm": [{"weekday": day, "hour": hour, "share": round(float(cells.get((day, hour), 0)) / total, 5)}
                   for day in range(7) for hour in range(24)],
        "longest_streak": None if longest.empty else {"days": _int(longest.iloc[0]["days"]),
                                                       "start": _date(longest.iloc[0]["start_date"]),
                                                       "end": _date(longest.iloc[0]["end_date"])},
    }


def write(document: dict[str, Any], out: Path) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=out.parent, suffix=".json", delete=False) as handle:
        staged = Path(handle.name)
        try:
            json.dump(document, handle, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        except BaseException:
            handle.close()
            staged.unlink(missing_ok=True)
            raise
    try:
        staged.replace(out)
    finally:
        staged.unlink(missing_ok=True)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export Gold stats and covers as one static JSON file")
    parser.add_argument("--gold-root", type=Path, default=Path("data/gold"))
    parser.add_argument("--silver", type=Path, default=Path("data/silver/scrobbles/scrobbles.parquet"))
    parser.add_argument("--catalog-dir", type=Path, default=CATALOG_DIR)
    parser.add_argument("--out", type=Path, default=Path("data/exports/frontend/stats.json"))
    parser.add_argument("--top", type=int, default=20)
    args = parser.parse_args(argv)
    path = write(build(args.gold_root, args.silver, read_catalog(args.catalog_dir), args.top), args.out)
    print(f"wrote {path} ({path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
