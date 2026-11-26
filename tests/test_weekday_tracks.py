from pathlib import Path

import pandas as pd

from src.artwork.export_explore import weekday_tracks
from src.artwork.export_insights import load_events


def test_weekday_selection_uses_historical_local_days_and_real_play_counts(tmp_path):
    rows = pd.DataFrame([
        ("2026-11-23T01:00:00Z", "artist a", "sunday song", "album"),
        ("2026-11-23T02:00:00Z", "artist a", "sunday song", "album"),
        ("2026-11-23T15:00:00Z", "artist b", "monday song", "album"),
    ], columns=["scrobbled_at", "artist_name", "track_name", "album_name"])
    rows["scrobbled_at"] = pd.to_datetime(rows["scrobbled_at"], utc=True)
    source = tmp_path / "silver.parquet"
    rows.to_parquet(source, index=False)
    days = weekday_tracks(load_events(source, Path("config/timezone_periods.json")))
    assert [day["weekday"] for day in days] == list(range(7))
    assert days[6]["tracks"] == [{"artist": "artist a", "title": "sunday song", "plays": 2}]
    assert days[0]["tracks"] == [{"artist": "artist b", "title": "monday song", "plays": 1}]
    assert all(not day["tracks"] for day in days[1:6])
