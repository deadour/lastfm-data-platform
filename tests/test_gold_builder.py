from pathlib import Path

import pandas as pd

from src.analytics.gold_builder import build_gold, build_marts, prepare_events, validate_marts


def silver_fixture():
    rows = [
        ("a", "Artist A", "Track A", "2019-12-31T23:00:00Z"),
        ("b", "Artist A", "Track A", "2020-01-01T00:00:00Z"),
        ("c", "Artist B", "Track B", "2020-01-01T01:00:00Z"),
        ("d", "Artist B", "Track B", "2020-01-02T01:00:00Z"),
        ("e", "Artist C", "Track C", "2020-01-03T02:00:00Z"),
    ]
    return pd.DataFrame({
        "scrobble_id": [row[0] for row in rows],
        "artist_name": [row[1] for row in rows],
        "track_name": [row[2] for row in rows],
        "scrobbled_at": pd.to_datetime([row[3] for row in rows], utc=True),
    })


def test_tracking_era_and_conservation():
    silver = silver_fixture()
    events = prepare_events(silver, pd.Timestamp("2020-01-01", tz="UTC"))
    marts, profile = build_marts(silver, pd.Timestamp("2020-01-01", tz="UTC"))
    quality = validate_marts(marts, len(silver))

    assert events.loc[events["scrobble_id"] == "a", "tracking_era"].item() == "partial_tracking"
    assert events.loc[events["scrobble_id"] == "b", "tracking_era"].item() == "consistent_tracking"
    assert quality["silver_conservation"] is True
    assert marts["listening_daily"]["scrobble_count"].sum() == 5
    assert profile["partial_tracking_rows"] == 1
    assert profile["consistent_tracking_rows"] == 4


def test_discovery_concentration_patterns_and_streaks():
    marts, profile = build_marts(silver_fixture(), pd.Timestamp("2020-01-01", tz="UTC"))

    yearly = marts["listening_yearly"]
    consistent = yearly[yearly["year"] == 2020].iloc[0]
    assert consistent["new_artists"] == 2
    assert 0 <= consistent["top_5_artist_share"] <= 1
    assert marts["discovery"].loc[lambda frame: frame.year == 2020, "newly_observed_artists"].item() == 2
    assert profile["longest_recorded_streak_since_2020"] == 3
    assert set(marts["listening_patterns"]["tracking_era"]) == {"partial_tracking", "consistent_tracking"}


def test_gold_build_writes_expected_marts_and_metadata(tmp_path):
    silver_path = tmp_path / "silver.parquet"
    gold_root = tmp_path / "gold"
    silver_fixture().to_parquet(silver_path, index=False)

    result = build_gold(silver_path=silver_path, gold_root=gold_root)

    assert result["quality"]["silver_conservation"] is True
    assert (gold_root / "listening_daily" / "listening_daily.parquet").exists()
    assert (gold_root / "listening_patterns" / "streaks.parquet").exists()
    assert (gold_root / "_metadata.json").exists()
    assert result["marts"]["listening_yearly"] == 2
