from src.ingestion.bronze_storage import save_page, write_run_metadata
from src.transformation.silver_storage import read_metadata, read_silver
from src.transformation.transform_scrobbles import transform


def make_run(root, run_id, uts):
    raw = {"recenttracks": {"track": [{"artist": {"#text": "Fictional Artist"}, "name": f"Track {uts}",
                                             "album": {"#text": "Fictional Album"}, "date": {"uts": str(uts)}}],
                              "@attr": {"user": "fictional-user", "totalPages": "1"}}}
    page = save_page(raw, root, 1, run_id=run_id, run_date="2026-01-01")
    write_run_metadata(page.parent, {"run_id": run_id, "mode": "backfill", "started_at": run_id,
                                     "status": "completed", "pages_saved": [1], "expected_pages": 1})


def test_full_and_idempotent_incremental_transform(tmp_path):
    bronze = tmp_path / "bronze"
    silver = tmp_path / "silver"
    make_run(bronze, "run-one", 1700000000)

    first = transform(full=True, bronze_root=bronze, silver_root=silver)
    assert first["final_rows"] == 1
    assert read_silver(silver).shape[0] == 1
    assert read_metadata(silver)["processed_bronze_runs"] == ["run-one"]

    second = transform(bronze_root=bronze, silver_root=silver)
    assert second["processed_runs"] == 0
    assert second["final_rows"] == 1

    make_run(bronze, "run-two", 1700000001)
    third = transform(bronze_root=bronze, silver_root=silver)
    assert third["processed_runs"] == 1
    assert third["final_rows"] == 2
    assert read_silver(silver)["scrobble_id"].is_unique


def test_metadata_and_parquet_are_created_without_personal_paths(tmp_path):
    bronze = tmp_path / "bronze"
    silver = tmp_path / "silver"
    make_run(bronze, "run-one", 1700000000)
    transform(full=True, bronze_root=bronze, silver_root=silver)
    metadata_text = (silver / "scrobbles" / "_metadata.json").read_text(encoding="utf-8")
    assert "scrobbles.parquet" not in metadata_text
    assert str(tmp_path) not in metadata_text
    assert (silver / "scrobbles" / "scrobbles.parquet").exists()
