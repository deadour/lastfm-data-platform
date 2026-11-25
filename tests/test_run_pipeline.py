import json

from src.ingestion.bronze_storage import run_directory, write_run_metadata
from src.jobs import run_pipeline


def fake_ingest(tmp_path, status, failure_type=None):
    def ingest(backfill, max_pages, output_root):
        assert backfill is False and max_pages == 3
        metadata = {"run_id": "new", "status": status, "started_at": "2026-11-25T17:00:00.5Z", "failure_type": failure_type}
        write_run_metadata(run_directory(output_root, "2026-11-25", "new"), metadata)
        return 1
    return ingest


def patch(monkeypatch, tmp_path, status, failure_type=None):
    calls = []
    monkeypatch.setattr("src.ingestion.ingest_scrobbles.ingest", fake_ingest(tmp_path, status, failure_type))
    monkeypatch.setattr("src.transformation.transform_scrobbles.transform",
                        lambda **kw: calls.append("silver") or {"processed_runs": 1, "new_rows": 1, "final_rows": 1})
    monkeypatch.setattr("src.analytics.gold_builder.build_gold", lambda **kw: calls.append("gold") or {"marts": {}})
    return calls


def args(tmp_path):
    return ["--max-pages", "3", "--bronze-root", str(tmp_path / "b"), "--silver-root", str(tmp_path / "s")]


def test_max_pages_limit_is_not_success(monkeypatch, tmp_path, capsys):
    calls = patch(monkeypatch, tmp_path, "failed", "MaxPagesLimit")
    assert run_pipeline.main(args(tmp_path)) == 2
    assert calls == []  # nothing downstream runs on a partial ingestion
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert lines[0]["failure_type"] == "MaxPagesLimit"


def test_completed_run_transforms(monkeypatch, tmp_path):
    calls = patch(monkeypatch, tmp_path, "completed")
    assert run_pipeline.main(args(tmp_path)) == 0
    assert calls == ["silver", "gold"]


def test_errors_exit_non_zero(monkeypatch, tmp_path, capsys):
    patch(monkeypatch, tmp_path, "completed")
    def boom(**kw):
        raise ConnectionError("network down")
    monkeypatch.setattr("src.transformation.transform_scrobbles.transform", boom)
    assert run_pipeline.main(args(tmp_path)) == 1
    assert '"error_type": "ConnectionError"' in capsys.readouterr().out


def test_existing_runs_are_not_mistaken_for_new(monkeypatch, tmp_path):
    old = run_directory(tmp_path / "b", "2026-10-02", "old")
    write_run_metadata(old, {"run_id": "old", "status": "completed", "started_at": "9999"})
    patch(monkeypatch, tmp_path, "failed", "IncompletePages")
    assert run_pipeline.main(args(tmp_path)) == 3
