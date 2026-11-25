from datetime import datetime, timezone
import json

from src.analytics.gold_builder import build_gold
from src.exports.frontend_stats import build_stats, main
from src.ingestion.bronze_storage import save_page, write_run_metadata
from src.transformation.transform_scrobbles import transform

CONTRACT_KEYS = {"schema_version", "source", "generated_at", "range", "totals", "years", "months",
                 "top_artists", "top_tracks", "rhythm", "longest_streak"}


def gold(tmp_path):
    tracks = [{"artist": {"#text": artist}, "name": title, "album": {"#text": "Fictional Album"}, "date": {"uts": str(uts)}}
              for artist, title, uts in [("Artist A", "One", 1700000000), ("Artist A", "One", 1700090000),
                                         ("Artist B", "Two", 1700180000), ("Artist A", "Three", 1800000000)]]
    raw = {"recenttracks": {"track": tracks, "@attr": {"user": "fictional-user", "totalPages": "1"}}}
    page = save_page(raw, tmp_path / "bronze", 1, run_id="r1", run_date="2026-01-01")
    write_run_metadata(page.parent, {"run_id": "r1", "mode": "backfill", "started_at": "r1",
                                     "status": "completed", "pages_saved": [1], "expected_pages": 1})
    transform(full=True, bronze_root=tmp_path / "bronze", silver_root=tmp_path / "silver")
    build_gold(silver_path=tmp_path / "silver" / "scrobbles" / "scrobbles.parquet", gold_root=tmp_path / "gold")
    return tmp_path / "gold"


def test_export_matches_frontend_contract(tmp_path):
    stats = build_stats(gold(tmp_path), now=datetime(2026, 11, 25, tzinfo=timezone.utc))
    assert set(stats) == CONTRACT_KEYS
    assert stats["schema_version"] == 1 and stats["source"] == "gold"
    assert stats["generated_at"] == "2026-11-25T00:00:00Z"
    assert stats["totals"] == {"scrobbles": 4, "artists": 2, "tracks": 3, "active_days": 4}
    assert stats["top_artists"][0] == {"name": "Artist A", "scrobbles": 3, "image": None}
    assert stats["top_tracks"][0]["title"] == "One" and stats["top_tracks"][0]["scrobbles"] == 2
    assert abs(sum(cell["share"] for cell in stats["rhythm"]) - 1) < 1e-4
    assert all(0 <= cell["weekday"] <= 6 and 0 <= cell["hour"] <= 23 for cell in stats["rhythm"])
    assert stats["years"][-1]["partial"] is True  # data ends mid-year
    assert stats["longest_streak"]["days"] >= 1


def test_export_contains_no_private_fields(tmp_path):
    out = tmp_path / "stats.json"
    assert main(["--gold-root", str(gold(tmp_path)), "--out", str(out)]) == 0
    text = out.read_text(encoding="utf-8")
    json.loads(text)
    for private in ("fictional-user", "bronze", "run_id", "api_key", "blob.core.windows.net"):
        assert private not in text
