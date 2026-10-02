from datetime import datetime, timezone

import pandas as pd

from src.ingestion.bronze_storage import save_page, write_run_metadata
from src.transformation.bronze_reader import discover_completed_runs
from src.transformation.scrobble_transformer import profile_dataframe, transform_runs, validate_dataframe


def track(name="Fictional Track", uts="1700000000", album=""):
    return {"artist": {"#text": "Fictional Artist", "mbid": ""}, "name": name, "mbid": "",
            "album": {"#text": album, "mbid": ""}, "url": "https://example.test/track",
            "date": {"uts": uts, "#text": "14 Nov 2023, 22:13"}}


def make_run(root, run_id, tracks):
    raw = {"recenttracks": {"track": tracks, "@attr": {"user": "fictional-user", "totalPages": "1"}}}
    page = save_page(raw, root, 1, run_id=run_id, run_date="2026-01-01")
    write_run_metadata(page.parent, {"run_id": run_id, "mode": "backfill", "started_at": run_id,
                                     "status": "completed", "pages_saved": [1], "expected_pages": 1})


def test_transform_excludes_now_playing_handles_missing_fields_and_deduplicates(tmp_path):
    tracks = [track(), track(), {**track(name="Now Playing"), "date": None, "@attr": {"nowplaying": "true"}},
              {"artist": {"#text": ""}, "name": "Malformed", "date": {"uts": "1700000000"}}]
    make_run(tmp_path, "run-one", tracks)
    run = discover_completed_runs(tmp_path)[0]

    dataframe, stats, rejected = transform_runs([run], datetime(2026, 1, 1, tzinfo=timezone.utc))

    assert len(dataframe) == 1
    assert stats.raw_records == 4
    assert stats.completed_scrobbles == 2
    assert stats.now_playing_skipped == 1
    assert stats.duplicates_removed == 1
    assert stats.malformed_rejected == 1
    assert len(rejected) == 1
    assert pd.isna(dataframe.iloc[0]["album_name"])
    assert dataframe.iloc[0]["scrobbled_at"].tzinfo is not None
    validate_dataframe(dataframe)
    assert profile_dataframe(dataframe)["missing_album_pct"] == 100.0


def test_scrobble_id_is_deterministic(tmp_path):
    make_run(tmp_path, "run-one", [track()])
    run = discover_completed_runs(tmp_path)[0]
    first, _, _ = transform_runs([run])
    second, _, _ = transform_runs([run])
    assert first.iloc[0]["scrobble_id"] == second.iloc[0]["scrobble_id"]
