from pathlib import Path
from types import SimpleNamespace

import pytest

from src.ingestion import ingest_scrobbles
from src.ingestion.bronze_storage import find_latest_incomplete_backfill, read_run_metadata
from src.ingestion.lastfm_client import LastFMAPIError


def response(page, total_pages=2):
    return {"recenttracks": {"track": [{"name": f"track-{page}"}],
                              "@attr": {"page": str(page), "totalPages": str(total_pages)}}}


class FakeClient:
    responses = {}
    calls = []

    def __init__(self, api_key, username):
        pass

    def get_recent_tracks(self, page=1, **kwargs):
        self.calls.append(page)
        result = self.responses[page]
        if isinstance(result, BaseException):
            raise result
        return result


def setup_fake_client(monkeypatch, responses):
    FakeClient.responses = responses
    FakeClient.calls = []
    monkeypatch.setattr(ingest_scrobbles, "LastFMClient", FakeClient)
    monkeypatch.setattr(ingest_scrobbles, "load_settings",
                        lambda: SimpleNamespace(api_key="sentinel", username="user"))


def run_directories(output_root: Path):
    return list((output_root / "lastfm" / "recent_tracks").glob("ingestion_date=*/run_*"))


def test_backfill_uses_one_run_directory_for_all_pages(tmp_path, monkeypatch):
    setup_fake_client(monkeypatch, {1: response(1), 2: response(2)})
    assert ingest_scrobbles.ingest(backfill=True, output_root=tmp_path) == 2

    runs = run_directories(tmp_path)
    assert len(runs) == 1
    assert sorted(path.name for path in runs[0].glob("page_*.json")) == ["page_0001.json", "page_0002.json"]
    metadata = read_run_metadata(runs[0])
    assert metadata["status"] == "completed"
    assert metadata["pages_saved"] == [1, 2]
    assert metadata["expected_pages"] == 2


def test_failed_backfill_can_resume_same_run(tmp_path, monkeypatch):
    setup_fake_client(monkeypatch, {1: response(1), 2: LastFMAPIError("temporary")})
    with pytest.raises(LastFMAPIError):
        ingest_scrobbles.ingest(backfill=True, output_root=tmp_path)

    runs = run_directories(tmp_path)
    assert len(runs) == 1
    assert read_run_metadata(runs[0])["status"] == "failed"
    assert read_run_metadata(runs[0])["pages_saved"] == [1]

    setup_fake_client(monkeypatch, {2: response(2)})
    assert ingest_scrobbles.ingest(backfill=True, resume=True, output_root=tmp_path) == 1
    assert FakeClient.calls == [2]
    assert len(run_directories(tmp_path)) == 1
    metadata = read_run_metadata(runs[0])
    assert metadata["status"] == "completed"
    assert metadata["pages_saved"] == [1, 2]


def test_resume_ignores_legacy_run_directories_without_metadata(tmp_path, monkeypatch):
    legacy = tmp_path / "lastfm" / "recent_tracks" / "ingestion_date=2026-10-02" / "run_legacy"
    legacy.mkdir(parents=True)
    (legacy / "page_0001.json").write_text("{}", encoding="utf-8")
    setup_fake_client(monkeypatch, {1: response(1), 2: response(2)})

    ingest_scrobbles.ingest(backfill=True, resume=True, output_root=tmp_path)

    assert legacy.exists()
    assert len(run_directories(tmp_path)) == 2
    assert find_latest_incomplete_backfill(tmp_path) is None
