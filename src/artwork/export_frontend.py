"""Small static JSON for the React frontend: Gold statistics plus resolved covers.

    python -m src.artwork.export_frontend --out data/exports/frontend/stats.json

The file is meant to be served as a static asset. It contains aggregates and
public image URLs only: no username, API key, storage account or blob path.
Covers are included only for ``resolved`` catalog rows; ``needs_review`` and
``rejected`` never reach the frontend.

Gold has no album mart yet, so album play counts come from Silver here.
"""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
from typing import Any

import pandas as pd

from .enrich import CATALOG_DIR, albums_from_silver, read_catalog

SCHEMA_VERSION = 1
ATTRIBUTION = {"coverartarchive": "cover art archive", "deezer": "deezer"}


def _int(value) -> int:
    return int(value) if pd.notna(value) else 0


def _date(value) -> str | None:
    return None if pd.isna(value) else pd.Timestamp(value).date().isoformat()


def cover(row: pd.Series | None) -> dict[str, Any] | None:
    if row is None or row.get("status") != "resolved" or not row.get("image_url"):
        return None
    return {"url": row["image_url"], "provider": row["provider"], "source_url": row.get("source_url"),
            "attribution": ATTRIBUTION.get(row["provider"], row["provider"])}


def build(gold_root: Path, silver_path: Path, catalog: pd.DataFrame, top: int = 50) -> dict[str, Any]:
    meta = json.loads((gold_root / "_metadata.json").read_text(encoding="utf-8"))
    yearly = pd.read_parquet(gold_root / "listening_yearly/listening_yearly.parquet").sort_values("year")
    monthly = pd.read_parquet(gold_root / "listening_monthly/listening_monthly.parquet").sort_values(["year", "month"])
    daily = pd.read_parquet(gold_root / "listening_daily/listening_daily.parquet", columns=["date", "scrobble_count"])
    artists = (pd.read_parquet(gold_root / "artist_stats/artist_stats.parquet",
                               columns=["artist_name", "total_scrobbles", "first_seen", "last_seen"])
               .drop_duplicates("artist_name").sort_values(["total_scrobbles", "artist_name"], ascending=[False, True]))
    tracks = (pd.read_parquet(gold_root / "track_stats/track_stats.parquet",
                              columns=["artist_name", "track_name", "total_scrobbles", "peak_year"])
              .sort_values(["total_scrobbles", "artist_name", "track_name"], ascending=[False, True, True]))
    patterns = pd.read_parquet(gold_root / "listening_patterns/listening_patterns.parquet")
    albums = albums_from_silver(pd.read_parquet(silver_path, columns=["artist_name", "album_name", "album_mbid"]))
    covers = catalog.set_index("album_key") if len(catalog) else None

    hours = patterns.groupby(["weekday", "hour"], as_index=False)["scrobble_count"].sum()
    return {
        "schema_version": SCHEMA_VERSION,
        "source": "gold",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "data_as_of": meta.get("generated_at"),
        "notes": {"tracking": meta.get("tracking_boundary_note"),
                  "albums": "album play counts come from silver until gold has an album mart"},
        "range": {"first_day": _date(daily["date"].min()), "last_day": _date(daily["date"].max())},
        "totals": {"scrobbles": _int(meta.get("source_silver_rows")), "artists": int(len(artists)),
                   "tracks": int(len(tracks)), "albums": int(len(albums)),
                   "active_days": int((daily["scrobble_count"] > 0).sum())},
        "years": [{"year": _int(r.year), "scrobbles": _int(r.scrobble_count), "active_days": _int(r.active_days),
                   "artists": _int(r.unique_artists), "tracks": _int(r.unique_tracks), "top_artist": r.top_artist,
                   "era": r.tracking_era} for r in yearly.itertuples()],
        "months": [{"month": r.year_month, "scrobbles": _int(r.scrobble_count)} for r in monthly.tail(24).itertuples()],
        "top_artists": [{"name": r.artist_name, "scrobbles": _int(r.total_scrobbles),
                         "first_seen": _date(r.first_seen), "last_seen": _date(r.last_seen)}
                        for r in artists.head(top).itertuples()],
        "top_albums": [{"key": r.album_key, "artist": r.artist_name, "title": r.album_name, "scrobbles": _int(r.scrobbles),
                        "cover": cover(covers.loc[r.album_key]) if covers is not None and r.album_key in covers.index else None}
                       for r in albums.head(top).itertuples()],
        "top_tracks": [{"artist": r.artist_name, "title": r.track_name, "scrobbles": _int(r.total_scrobbles),
                        "peak_year": _int(r.peak_year)} for r in tracks.head(top).itertuples()],
        "week_hours": [{"weekday": _int(r.weekday), "hour": _int(r.hour), "scrobbles": _int(r.scrobble_count)}
                       for r in hours.itertuples()],
    }


def write(document: dict[str, Any], out: Path) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=out.parent, suffix=".json", delete=False) as handle:
        json.dump(document, handle, ensure_ascii=False, separators=(",", ":"))
        staged = Path(handle.name)
    staged.replace(out)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export Gold stats and covers as one static JSON file")
    parser.add_argument("--gold-root", type=Path, default=Path("data/gold"))
    parser.add_argument("--silver", type=Path, default=Path("data/silver/scrobbles/scrobbles.parquet"))
    parser.add_argument("--catalog-dir", type=Path, default=CATALOG_DIR)
    parser.add_argument("--out", type=Path, default=Path("data/exports/frontend/stats.json"))
    parser.add_argument("--top", type=int, default=50)
    args = parser.parse_args(argv)
    path = write(build(args.gold_root, args.silver, read_catalog(args.catalog_dir), args.top), args.out)
    print(f"wrote {path} ({path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
