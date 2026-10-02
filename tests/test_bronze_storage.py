import json
from datetime import datetime, timezone

from src.ingestion.bronze_storage import latest_completed_timestamp, save_page


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


def test_watermark_ignores_now_playing(tmp_path):
    save_page(payload({"date": {"uts": "100"}}, {"@attr": {"nowplaying": "true"}}), tmp_path, 1,
              datetime(2026, 1, 2, tzinfo=timezone.utc), run_id="one")
    assert latest_completed_timestamp(tmp_path) == 100
