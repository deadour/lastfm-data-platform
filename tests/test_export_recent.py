from datetime import datetime, timezone

import pandas as pd
import pytest

from src.artwork.export_recent import build_recent


def silver(tmp_path, rows):
    """rows: (utc iso, artist, track, album)"""
    frame = pd.DataFrame(rows, columns=["scrobbled_at", "artist_name", "track_name", "album_name"])
    frame["scrobbled_at"] = pd.to_datetime(frame["scrobbled_at"], utc=True)
    path = tmp_path / "scrobbles.parquet"
    frame.to_parquet(path, index=False)
    return path


EMPTY = pd.DataFrame(columns=["album_key", "status", "provider", "image_url", "source_url"])
# wednesday 25 nov 2026, 15:00 in cordoba (utc-3)
NOW = datetime(2026, 11, 25, 18, 0, tzinfo=timezone.utc)
AS_OF = "2026-11-25T17:00:00+00:00"


def recent(tmp_path, rows, as_of=AS_OF, now=NOW):
    return build_recent(silver(tmp_path, rows), EMPTY, as_of, now=now)


def test_local_midnight_decides_the_day(tmp_path):
    doc = recent(tmp_path, [
        ("2026-11-25T02:59:00Z", "a", "t", "x"),  # 23:59 on the 24th in cordoba
        ("2026-11-25T03:00:00Z", "b", "t", "x"),  # 00:00 on the 25th
    ])
    assert doc["periods"]["today"]["scrobbles"] == 1
    assert doc["periods"]["today"]["top_artists"] == [{"name": "b", "scrobbles": 1}]
    assert [d["scrobbles"] for d in doc["series"]["days"][-2:]] == [1, 1]


def test_week_starts_monday_and_month_on_the_first(tmp_path):
    doc = recent(tmp_path, [
        ("2026-11-23T12:00:00Z", "a", "t", "x"),  # monday
        ("2026-11-22T12:00:00Z", "a", "t", "x"),  # sunday: last week
        ("2026-11-01T12:00:00Z", "a", "t", "x"),
        ("2026-10-31T12:00:00Z", "a", "t", "x"),  # last month
    ])
    p = doc["periods"]
    assert (p["this_week"]["start"], p["this_week"]["end_exclusive"]) == ("2026-11-23", "2026-11-30")
    assert (p["last_week"]["start"], p["last_week"]["end_exclusive"]) == ("2026-11-16", "2026-11-23")
    assert p["this_week"]["scrobbles"] == 1 and p["last_week"]["scrobbles"] == 1
    assert (p["this_month"]["start"], p["last_month"]["start"]) == ("2026-11-01", "2026-10-01")
    assert p["this_month"]["scrobbles"] == 3 and p["last_month"]["scrobbles"] == 1


def test_running_periods_are_incomplete_and_closed_ones_complete(tmp_path):
    doc = recent(tmp_path, [("2026-11-25T12:00:00Z", "a", "t", "x")])
    p = doc["periods"]
    assert [p[k]["complete"] for k in ("today", "this_week", "last_week", "this_month", "last_month")] == [False, False, True, False, True]
    assert doc["series"]["days"][-1]["complete"] is False and doc["series"]["days"][-2]["complete"] is True
    assert doc["series"]["weeks"][-1]["complete"] is False and doc["series"]["months"][-1]["complete"] is False


def test_series_shape_and_order(tmp_path):
    doc = recent(tmp_path, [("2026-11-25T12:00:00Z", "a", "t", "x")])
    s = doc["series"]
    assert (len(s["days"]), len(s["weeks"]), len(s["months"])) == (14, 12, 12)
    assert s["days"][0]["date"] == "2026-11-12" and s["days"][-1]["date"] == "2026-11-25"
    assert s["weeks"][-1]["start"] == "2026-11-23" and s["months"][0]["month"] == "2025-12"
    assert [d["date"] for d in s["days"]] == sorted(d["date"] for d in s["days"])


def test_true_zero_versus_unknown(tmp_path):
    # data processed up to the 23rd: the 24th and 25th are unknown, not zero
    doc = recent(tmp_path, [("2026-11-20T12:00:00Z", "a", "t", "x")], as_of="2026-11-23T12:00:00+00:00")
    days = {d["date"]: d["scrobbles"] for d in doc["series"]["days"]}
    assert days["2026-11-22"] == 0  # covered, nothing played
    assert days["2026-11-24"] is None and days["2026-11-25"] is None
    assert doc["periods"]["today"]["status"] == "unknown"
    assert doc["periods"]["last_week"]["status"] == "covered"


def test_ties_are_broken_by_name(tmp_path):
    rows = [(f"2026-11-25T1{i}:00:00Z", artist, "t", "") for i, artist in enumerate(["zeta", "alfa", "medio"])]
    doc = recent(tmp_path, rows)
    assert [a["name"] for a in doc["periods"]["today"]["top_artists"]] == ["alfa", "medio", "zeta"]
    assert doc["periods"]["today"]["top_albums"] == []  # plays without album never invent one


def test_empty_periods_have_zero_counts_and_empty_lists(tmp_path):
    doc = recent(tmp_path, [("2026-11-01T12:00:00Z", "a", "t", "x")])
    today = doc["periods"]["today"]
    assert (today["scrobbles"], today["unique_artists"], today["unique_tracks"]) == (0, 0, 0)
    assert today["top_artists"] == today["top_albums"] == today["top_tracks"] == []


def test_top_lists_cap_at_five(tmp_path):
    rows = [(f"2026-11-25T1{i % 10}:0{i // 10}:00Z", f"artist {i}", f"track {i}", f"album {i}") for i in range(8)]
    doc = recent(tmp_path, rows)
    today = doc["periods"]["today"]
    assert len(today["top_artists"]) == len(today["top_tracks"]) == len(today["top_albums"]) == 5
    assert today["unique_artists"] == 8 and today["unique_albums"] == 8


@pytest.mark.parametrize("field", ["generated_at", "data_as_of", "timezone"])
def test_header_fields(tmp_path, field):
    doc = recent(tmp_path, [("2026-11-25T12:00:00Z", "a", "t", "x")])
    assert doc[field] and doc["timezone"] == "America/Argentina/Cordoba"


def test_last_scrobble_is_exported_for_the_live_fallback(tmp_path):
    doc = recent(tmp_path, [("2026-11-20T12:00:00Z", "a", "old", "x"), ("2026-11-25T12:00:00Z", "b", "newest", "")])
    assert doc["last_scrobble"] == {"artist": "b", "title": "newest", "album": None,
                                    "played_at": "2026-11-25T12:00:00Z", "cover": None}
