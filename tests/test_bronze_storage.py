import json
from datetime import datetime, timezone

from src.ingestion.bronze_storage import latest_completed_timestamp, save_page, write_run_metadata


def payload(*tracks):
    return {"recenttracks": {"track": list(tracks), "@attr": {"page": "1", "totalPages": "1"}}}


def test_save_page_persists_metadata_and_raw_payload(tmp_path):
    timestamp = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    raw = payload({"name": "Song", "artist": {"#text": "Artist"}})
    path = save_page(raw, tmp_path, 1, timestamp, run_id="run-test")
    document = json.loads(path.read_text(encoding="utf-8"))
    assert document["metadata"]["page"] == 1
    assert document["metadata"]["source"] == "lastfm"
    assert document["payload"] == raw


def run(tmp_path, run_id, status, *tracks, failure_type=None):
    path = save_page(payload(*tracks), tmp_path, 1, datetime(2026, 1, 2, tzinfo=timezone.utc), run_id=run_id)
    write_run_metadata(path.parent, {"run_id": run_id, "status": status, "failure_type": failure_type})


def test_watermark_ignores_now_playing(tmp_path):
    run(tmp_path, "one", "completed", {"date": {"uts": "100"}}, {"@attr": {"nowplaying": "true"}})
    assert latest_completed_timestamp(tmp_path) == 100


def test_watermark_ignores_partial_and_unmarked_runs(tmp_path):
    run(tmp_path, "one", "completed", {"date": {"uts": "100"}})
    # Newest page of a gap from a --max-pages run must not move the watermark past the gap.
    run(tmp_path, "two", "failed", {"date": {"uts": "900"}}, failure_type="MaxPagesLimit")
    run(tmp_path, "three", "running", {"date": {"uts": "950"}})
    save_page(payload({"date": {"uts": "999"}}), tmp_path, 1, run_id="no-metadata")
    assert latest_completed_timestamp(tmp_path) == 100


def test_watermark_is_none_without_completed_runs(tmp_path):
    run(tmp_path, "two", "failed", {"date": {"uts": "900"}}, failure_type="MaxPagesLimit")
    assert latest_completed_timestamp(tmp_path) is None
