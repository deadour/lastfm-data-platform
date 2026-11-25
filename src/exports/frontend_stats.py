"""Export public listening stats for the fm.eduramirez.dev frontend.

Reads local Gold marts and writes one small JSON file that matches
frontend/src/data/types.ts (StatsFile, schema_version 1). It only reads
aggregates: no Bronze payloads, usernames, keys or lake paths end up in the
output. It is not called by the pipeline; run it on purpose:

    python -m src.exports.frontend_stats --gold-root data/gold --out frontend/public/data/stats.json
"""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
from typing import Any

import pandas as pd


SCHEMA_VERSION = 1
TOP_N = 20
MONTHS = 24


def _read(gold_root: Path, mart: str, name: str | None = None) -> pd.DataFrame:
    return pd.read_parquet(gold_root / mart / f"{name or mart}.parquet", engine="pyarrow")


def _date(value: Any) -> str:
    return pd.Timestamp(value).date().isoformat()


def build_stats(gold_root: str | Path, now: datetime | None = None) -> dict[str, Any]:
    gold_root = Path(gold_root)
    daily = _read(gold_root, "listening_daily")
    yearly = _read(gold_root, "listening_yearly").sort_values("year")
    monthly = _read(gold_root, "listening_monthly")
    artists = _read(gold_root, "artist_stats")
    tracks = _read(gold_root, "track_stats")
    patterns = _read(gold_root, "listening_patterns")
    streaks = _read(gold_root, "listening_patterns", "streaks")

    first, last = pd.Timestamp(daily["date"].min()), pd.Timestamp(daily["date"].max())
    complete_last_year = last.month == 12 and last.day == 31

    years = [
        {
            "year": int(row.year),
            "scrobbles": int(row.scrobble_count),
            "artists": int(row.unique_artists),
            "tracks": int(row.unique_tracks),
            "top_artist": None if pd.isna(row.top_artist) else str(row.top_artist),
            "partial": bool(row.tracking_era == "partial_tracking" or (row.year == last.year and not complete_last_year)),
        }
        for row in yearly.itertuples()
    ]

    by_month = monthly.groupby("year_month", as_index=False)["scrobble_count"].sum().sort_values("year_month")
    months = [{"month": str(r.year_month), "scrobbles": int(r.scrobble_count)} for r in by_month.tail(MONTHS).itertuples()]

    artist_totals = (artists.groupby("artist_name", as_index=False)["scrobble_count"].sum()
                     .sort_values(["scrobble_count", "artist_name"], ascending=[False, True]))
    top_artists = [{"name": str(r.artist_name), "scrobbles": int(r.scrobble_count), "image": None}
                   for r in artist_totals.head(TOP_N).itertuples()]

    top_tracks_df = tracks.sort_values(["total_scrobbles", "artist_name", "track_name"], ascending=[False, True, True])
    top_tracks = [{"title": str(r.track_name), "artist": str(r.artist_name), "scrobbles": int(r.total_scrobbles), "image": None}
                  for r in top_tracks_df.head(TOP_N).itertuples()]

    consistent = patterns[patterns["tracking_era"] == "consistent_tracking"]
    source = consistent if not consistent.empty else patterns
    grid = source.groupby(["weekday", "hour"], as_index=False)["scrobble_count"].sum()
    total = grid["scrobble_count"].sum() or 1
    rhythm = [{"weekday": int(r.weekday), "hour": int(r.hour), "share": round(float(r.scrobble_count) / total, 6)}
              for r in grid.sort_values(["weekday", "hour"]).itertuples()]

    longest = None
    if not streaks.empty:
        top = streaks.sort_values(["days", "start_date"], ascending=[False, True]).iloc[0]
        longest = {"days": int(top["days"]), "start": _date(top["start_date"]), "end": _date(top["end_date"])}

    return {
        "schema_version": SCHEMA_VERSION,
        "source": "gold",
        "generated_at": (now or datetime.now(timezone.utc)).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "range": {"first": first.date().isoformat(), "last": last.date().isoformat()},
        "totals": {
            "scrobbles": int(daily["scrobble_count"].sum()),
            "artists": int(artists["artist_name"].nunique()),
            "tracks": int(len(tracks)),
            "active_days": int(daily["date"].nunique()),
        },
        "years": years,
        "months": months,
        "top_artists": top_artists,
        "top_tracks": top_tracks,
        "rhythm": rhythm,
        "longest_streak": longest,
    }


def write_stats(stats: dict[str, Any], out: str | Path) -> Path:
    target = Path(out)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=target.parent, suffix=".json", delete=False) as stream:
        json.dump(stats, stream, ensure_ascii=False, separators=(",", ":"))
        staged = Path(stream.name)
    staged.replace(target)
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export Gold aggregates as frontend stats JSON")
    parser.add_argument("--gold-root", default="data/gold")
    parser.add_argument("--out", default="frontend/public/data/stats.json")
    args = parser.parse_args(argv)
    path = write_stats(build_stats(args.gold_root), args.out)
    print(f"Wrote {path} ({path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
