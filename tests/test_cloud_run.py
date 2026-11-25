import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

from azure.core.exceptions import HttpResponseError, ResourceExistsError, ResourceModifiedError, ServiceRequestError
import pandas as pd
import pytest

from src.ingestion.bronze_storage import run_directory, save_page, write_run_metadata
from src.jobs import cloud_run
from src.storage import checkpoint as cp
from src.transformation.transform_scrobbles import transform
from tests.test_silver_pipeline import make_run

SILVER = "silver/scrobbles/snapshot=seed"


class FakeLake:
    """Blob semantics the job relies on: no-clobber, ETags, one lease."""

    def __init__(self):
        self.blobs, self.meta, self.etags, self.n = {}, {}, {}, 0
        self.lease_held, self.fail_upload_of = False, None

    def _put(self, name, data, metadata=None):
        self.n += 1
        self.blobs[name], self.meta[name], self.etags[name] = data, metadata, f'"{self.n}"'
        return self.etags[name]

    def blob_properties(self, name):
        return SimpleNamespace(metadata=self.meta.get(name)) if name in self.blobs else None

    def remote_sha256(self, name):
        return hashlib.sha256(self.blobs[name]).hexdigest()

    def upload_file(self, path, name, *, overwrite=False, metadata=None):
        if self.fail_upload_of and self.fail_upload_of in name:
            raise ServiceRequestError("connection reset")
        if name in self.blobs and not overwrite:
            raise ResourceExistsError("exists")
        self._put(name, Path(path).read_bytes(), metadata)

    def download_file(self, name, local):
        Path(local).write_bytes(self.blobs[name])
        return Path(local)

    def read_bytes(self, name):
        return (self.blobs[name], self.etags[name]) if name in self.blobs else None

    def write_bytes_conditional(self, name, data, *, etag):
        if etag is None and name in self.blobs:
            raise ResourceExistsError("exists")
        if etag is not None and self.etags.get(name) != etag:
            raise ResourceModifiedError("modified")
        return self._put(name, data)

    def acquire_lease(self, name, seconds):
        if self.lease_held:
            error = HttpResponseError("lease present")
            error.status_code = 409
            raise error
        self.lease_held = True
        lake = self
        return SimpleNamespace(renew=lambda: None, release=lambda: setattr(lake, "lease_held", False))


@pytest.fixture
def lake(tmp_path):
    """A lake seeded with a real Silver snapshot of one scrobble at t=1700000000."""
    seed = tmp_path / "seed"
    make_run(seed / "bronze", "run-one", 1700000000)
    transform(full=True, bronze_root=seed / "bronze", silver_root=seed / "silver")
    store = FakeLake()
    files = {}
    for name in ("scrobbles.parquet", "_metadata.json"):
        data = (seed / "silver" / "scrobbles" / name).read_bytes()
        store._put(f"{SILVER}/{name}", data)
        files[name] = hashlib.sha256(data).hexdigest()
    document = {"schema_version": 1, "watermark_uts": 1700000000, "sequence": 0,
                "snapshots": {"silver": {"prefix": SILVER, "files": files}}}
    cp.commit(store, cp.Checkpoint({}, None), document)
    return store


@pytest.fixture
def distinct_seconds(monkeypatch):
    """Snapshot ids have one-second resolution; tests run faster than that."""
    from src.storage import publish
    counter = iter(range(10**6))
    monkeypatch.setattr(publish, "snapshot_id", lambda value: f"20261126T0600{next(counter):02d}Z")


def fake_ingest(*uts, status="completed", failure_type=None, calls=None, run_id="new"):
    def ingest(backfill, max_pages, output_root, from_timestamp, to_timestamp):
        assert to_timestamp is not None and to_timestamp > (from_timestamp or 0)
        if calls is not None:
            calls.append(from_timestamp)
        tracks = [{"artist": {"#text": "Fictional Artist"}, "name": f"Track {t}", "album": {"#text": "Fictional Album"},
                   "date": {"uts": str(t)}} for t in uts]
        payload = {"recenttracks": {"track": tracks, "@attr": {"user": "fictional-user", "totalPages": "1" if tracks else "0"}}}
        save_page(payload, output_root, 1, run_id=run_id, run_date="2026-11-26")
        write_run_metadata(run_directory(output_root, "2026-11-26", run_id), {
            "run_id": run_id, "mode": "incremental", "started_at": "2026-11-26T06:00:00Z", "status": status,
            "failure_type": failure_type, "pages_saved": [1], "expected_pages": 1 if tracks else 0})
        return 1
    return ingest


def checkpoint_doc(lake):
    return json.loads(lake.blobs[cp.CHECKPOINT_BLOB])


def silver_rows(lake, prefix, tmp_path):
    path = tmp_path / "check.parquet"
    path.write_bytes(lake.blobs[f"{prefix}/scrobbles.parquet"])
    return pd.read_parquet(path)


def test_daily_run_restores_appends_publishes_and_commits(lake, tmp_path):
    calls = []
    code = cloud_run.run_job(lake, tmp_path / "work", 5, ingest=fake_ingest(1700000000, 1700000500, calls=calls))
    assert code == 0 and calls == [1700000000]  # watermark comes from the checkpoint
    doc = checkpoint_doc(lake)
    assert doc["watermark_uts"] == 1700000500 and doc["sequence"] == 1 and doc["last_run_id"] == "new"
    # Boundary scrobble refetched by the inclusive window is deduplicated, none lost.
    rows = silver_rows(lake, doc["snapshots"]["silver"]["prefix"], tmp_path)
    assert sorted(rows["scrobbled_at"].astype("int64") // 10**9) == [1700000000, 1700000500]
    assert doc["snapshots"]["gold"]["prefix"].startswith("gold/snapshot=")
    assert f"{doc['snapshots']['gold']['prefix']}/listening_daily/listening_daily.parquet" in lake.blobs
    assert any(n.startswith("bronze/lastfm/recent_tracks/ingestion_date=2026-11-26/run_new/") for n in lake.blobs)
    assert SILVER + "/scrobbles.parquet" in lake.blobs  # old snapshot kept
    assert not lake.lease_held


def test_second_day_continues_from_committed_state(lake, tmp_path, distinct_seconds):
    cloud_run.run_job(lake, tmp_path / "day1", 5, ingest=fake_ingest(1700000500))
    calls = []
    day2 = fake_ingest(1700000900, calls=calls, run_id="day2")
    assert cloud_run.run_job(lake, tmp_path / "day2", 5, ingest=day2) == 0
    doc = checkpoint_doc(lake)
    assert calls == [1700000500] and doc["watermark_uts"] == 1700000900 and doc["sequence"] == 2
    assert len(silver_rows(lake, doc["snapshots"]["silver"]["prefix"], tmp_path)) == 3


@pytest.mark.parametrize("status,failure,code", [("failed", "MaxPagesLimit", 2), ("failed", "IncompletePages", 3), ("running", None, 3)])
def test_partial_runs_commit_nothing(lake, tmp_path, status, failure, code):
    before = dict(lake.blobs)
    assert cloud_run.main_job(lake, tmp_path, fake_ingest(1800000000, status=status, failure_type=failure)) == code
    lake.blobs.pop(cp.LOCK_BLOB)  # the empty lock blob is created once, by design
    assert lake.blobs == before  # no Bronze, Silver, Gold or checkpoint writes
    assert not lake.lease_held


def test_empty_window_commits_without_new_snapshots(lake, tmp_path):
    assert cloud_run.run_job(lake, tmp_path, 5, ingest=fake_ingest()) == 0
    doc = checkpoint_doc(lake)
    assert doc["watermark_uts"] == 1700000000 and doc["snapshots"]["silver"]["prefix"] == SILVER
    assert "gold" not in doc["snapshots"]


def test_concurrent_run_is_refused(lake, tmp_path):
    lake.lease_held = True
    assert cloud_run.main_job(lake, tmp_path, fake_ingest(1800000000)) == 5
    assert checkpoint_doc(lake)["sequence"] == 0


def test_corrupted_restore_stops_before_ingestion(lake, tmp_path):
    lake.blobs[f"{SILVER}/scrobbles.parquet"] = b"corrupted"
    calls = []
    assert cloud_run.main_job(lake, tmp_path, fake_ingest(1800000000, calls=calls)) == 1
    assert calls == [] and checkpoint_doc(lake)["sequence"] == 0


def test_network_failure_while_publishing_keeps_old_checkpoint(lake, tmp_path, distinct_seconds):
    lake.fail_upload_of = "gold/"
    assert cloud_run.main_job(lake, tmp_path / "a", fake_ingest(1700000500)) == 1
    assert checkpoint_doc(lake)["watermark_uts"] == 1700000000
    lake.fail_upload_of = None
    # The retry is a new run (new run_id) over the same window.
    assert cloud_run.run_job(lake, tmp_path / "b", 5, ingest=fake_ingest(1700000500, run_id="retry")) == 0
    assert checkpoint_doc(lake)["watermark_uts"] == 1700000500


def test_lost_commit_race_is_reported(lake, tmp_path, monkeypatch):
    original = cp.commit
    def racing(storage, previous, document, **kw):
        lake.write_bytes_conditional(cp.CHECKPOINT_BLOB, b'{"schema_version": 1}', etag=previous.etag)
        return original(storage, previous, document, **kw)
    monkeypatch.setattr(cp, "commit", racing)
    assert cloud_run.main_job(lake, tmp_path, fake_ingest(1700000500)) == 1


def test_missing_checkpoint_requires_seed(tmp_path):
    assert cloud_run.main_job(FakeLake(), tmp_path, fake_ingest(1)) == 4


def test_seed_refuses_mismatched_snapshot(tmp_path):
    data = tmp_path / "data"
    make_run(data / "bronze", "run-one", 1700000000)
    transform(full=True, bronze_root=data / "bronze", silver_root=data / "silver")
    store = FakeLake()
    for name in ("scrobbles.parquet", "_metadata.json"):
        store._put(f"{SILVER}/{name}", (data / "silver" / "scrobbles" / name).read_bytes())
    document = cloud_run.seed_document(store, SILVER, data)
    assert document["watermark_uts"] == 1700000000 and document["sequence"] == 0
    store.blobs[f"{SILVER}/_metadata.json"] = b"{}"
    with pytest.raises(ValueError, match="differs"):
        cloud_run.seed_document(store, SILVER, data)


def test_snapshot_id_collision_fails_safely(lake, tmp_path, monkeypatch):
    from src.storage import publish
    monkeypatch.setattr(publish, "snapshot_id", lambda value: "20261126T060000Z")
    assert cloud_run.run_job(lake, tmp_path / "a", 5, ingest=fake_ingest(1700000500)) == 0
    first = checkpoint_doc(lake)
    assert cloud_run.main_job(lake, tmp_path / "b", fake_ingest(1700000900, run_id="b")) == 1
    assert checkpoint_doc(lake) == first  # nothing overwritten, nothing committed
