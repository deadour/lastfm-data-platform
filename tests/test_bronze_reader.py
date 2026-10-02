import json

from src.transformation.bronze_reader import discover_completed_runs
from src.ingestion.bronze_storage import save_page, write_run_metadata


def payload():
    return {"recenttracks": {"track": [{"artist": {"#text": "Fictional Artist"}, "name": "Fictional Track",
                                             "date": {"uts": "1700000000"}}],
                              "@attr": {"user": "fictional-user", "totalPages": "1"}}}


def create_run(root, run_id, status="completed"):
    path = save_page(payload(), root, 1, run_id=run_id, run_date="2026-01-01")
    run_dir = path.parent
    write_run_metadata(run_dir, {"run_id": run_id, "mode": "backfill", "started_at": run_id,
                                 "status": status, "pages_saved": [1], "expected_pages": 1})
    return run_dir


def test_discovery_selects_only_completed_metadata_runs(tmp_path):
    create_run(tmp_path, "completed-run")
    create_run(tmp_path, "failed-run", status="failed")
    legacy = tmp_path / "lastfm" / "recent_tracks" / "ingestion_date=2026-01-01" / "run_legacy"
    legacy.mkdir(parents=True)
    (legacy / "page_0001.json").write_text(json.dumps({}), encoding="utf-8")

    runs = discover_completed_runs(tmp_path)

    assert [run.run_id for run in runs] == ["completed-run"]
