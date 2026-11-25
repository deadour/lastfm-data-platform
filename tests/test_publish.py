import hashlib
import json
import socket
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from src.ingestion.bronze_storage import latest_completed_timestamp, run_directory, save_page, write_run_metadata
from src.storage import azure_cli, publish as pub
from src.storage.azure import AzureSettings, AzureStorage, sha256_file
from tests.test_silver_pipeline import make_run

QUIET = {"log": lambda _: None}


def page(uts):
    return {"recenttracks": {"@attr": {"totalPages": "1"}, "track": [{"date": {"uts": str(uts)}}]}}


@pytest.fixture
def data(tmp_path, monkeypatch):
    root = tmp_path / "data"
    silver = root / "silver" / "scrobbles"
    silver.mkdir(parents=True)
    (silver / "scrobbles.parquet").write_bytes(b"PAR1silver\x00PAR1")
    (silver / "_metadata.json").write_text(json.dumps({"last_transformed_at": "2026-10-02T22:39:40.667757Z"}))
    (root / "silver" / "rejected").mkdir()
    (root / "silver" / "rejected" / "records.jsonl").write_text("{}\n")
    gold = root / "gold"
    for mart in ("listening_yearly", "listening_daily"):
        (gold / mart).mkdir(parents=True)
        (gold / mart / f"{mart}.parquet").write_bytes(b"PAR1" + mart.encode() + b"PAR1")
    (gold / "_metadata.json").write_text(json.dumps({"generated_at": "2026-10-02T23:09:00+00:00"}))
    (gold / ".gold-build-x").mkdir()
    (gold / ".gold-build-x" / "tmp.parquet").write_bytes(b"x")
    bronze = root / "bronze"
    save_page(page(100), bronze, 1, run_id="20261002T221955Z", run_date="2026-10-02")
    write_run_metadata(run_directory(bronze, "2026-10-02", "20261002T221955Z"), {
        "run_id": "20261002T221955Z", "mode": "incremental", "status": "completed",
        "pages_saved": [1], "expected_pages": 1, "started_at": "2026-10-02T22:19:55Z"})
    save_page(page(999), bronze, 1, run_id="20261125T164024Z", run_date="2026-11-25")
    write_run_metadata(run_directory(bronze, "2026-11-25", "20261125T164024Z"), {
        "run_id": "20261125T164024Z", "mode": "incremental", "status": "failed", "failure_type": "MaxPagesLimit",
        "pages_saved": [1], "expected_pages": 5, "started_at": "2026-11-25T16:40:24Z"})
    (root.parent / ".env").write_text("LASTFM_API_KEY=do-not-upload\n")
    monkeypatch.setattr(pub, "DATA_ROOT", root)
    monkeypatch.setenv("AZURE_STORAGE_ACCOUNT", "stlastfmedu")
    return root


class FakeStorage:
    def __init__(self):
        self.blobs, self.metadata, self.writes = {}, {}, []

    def blob_properties(self, name):
        return SimpleNamespace(metadata=self.metadata.get(name)) if name in self.blobs else None

    def remote_sha256(self, name):
        return hashlib.sha256(self.blobs[name]).hexdigest()

    def upload_file(self, path, name, *, overwrite=False, metadata=None):
        if name in self.blobs and not overwrite:
            raise AssertionError("silent overwrite")
        self.writes.append(name)
        self.blobs[name], self.metadata[name] = path.read_bytes(), metadata


def test_silver_and_gold_paths_preserve_structure(data):
    silver = pub.discover_artifacts("silver", data_root=data)
    assert [a.blob_name for a in silver] == ["silver/scrobbles/snapshot=20261002T223940Z/scrobbles.parquet",
                                              "silver/scrobbles/snapshot=20261002T223940Z/_metadata.json"]
    gold = pub.discover_artifacts("gold", data_root=data)
    assert [a.blob_name for a in gold] == ["gold/snapshot=20261002T230900Z/listening_daily/listening_daily.parquet",
                                            "gold/snapshot=20261002T230900Z/listening_yearly/listening_yearly.parquet",
                                            "gold/snapshot=20261002T230900Z/_metadata.json"]
    one = pub.discover_artifacts("gold", data / "gold" / "listening_yearly", data_root=data)
    assert [a.source.name for a in one] == ["listening_yearly.parquet", "_metadata.json"]


def test_path_outside_layer_is_rejected(data):
    with pytest.raises(ValueError, match="inside"):
        pub.discover_artifacts("gold", data.parent / ".env", data_root=data)


def test_dry_run_performs_no_remote_writes(data, monkeypatch, capsys):
    factory = MagicMock()
    monkeypatch.setattr(azure_cli, "AzureStorage", factory)
    assert azure_cli.main(["publish-layer", "--layer", "gold", "--dry-run", "--verify"]) == 0
    assert azure_cli.main(["backup-state", "--dry-run"]) == 0
    factory.assert_not_called()
    assert "gold/snapshot=20261002T230900Z/listening_yearly/listening_yearly.parquet" in capsys.readouterr().out


def test_refuses_overwrite_of_different_bytes(data):
    storage = FakeStorage()
    artifact = pub.discover_artifacts("silver", data_root=data)[0]
    storage.blobs[artifact.blob_name] = b"other bytes"
    with pytest.raises(pub.PublishConflict):
        pub.publish(storage, artifact, **QUIET)
    assert storage.writes == [] and storage.blobs[artifact.blob_name] == b"other bytes"
    assert pub.publish(storage, artifact, overwrite=True, **QUIET) == "overwritten"


def test_idempotent_when_bytes_match(data):
    storage = FakeStorage()
    artifact = pub.discover_artifacts("silver", data_root=data)[0]
    assert pub.publish(storage, artifact, **QUIET) == "uploaded"
    assert pub.publish(storage, artifact, **QUIET) == "matched"
    storage.metadata[artifact.blob_name] = None  # uploaded earlier without a recorded hash
    assert pub.publish(storage, artifact, **QUIET) == "matched"
    assert storage.writes == [artifact.blob_name]


def test_verify_compares_actual_sha256(data):
    storage = FakeStorage()
    artifact = pub.discover_artifacts("silver", data_root=data)[0]
    storage.remote_sha256 = lambda name: "0" * 64
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        pub.publish(storage, artifact, verify=True, **QUIET)
    # With --verify a recorded (possibly stale) hash is not trusted; real bytes are hashed.
    storage = FakeStorage()
    storage.blobs[artifact.blob_name] = b"tampered"
    storage.metadata[artifact.blob_name] = {"sha256": sha256_file(artifact.source)}
    with pytest.raises(pub.PublishConflict):
        pub.publish(storage, artifact, verify=True, **QUIET)


def test_remote_sha256_streams_chunks():
    client = MagicMock()
    client.download_blob.return_value.chunks.return_value = [b"ab", b"c"]
    storage = AzureStorage(AzureSettings("stlastfmedu"), container_client=client)
    assert storage.remote_sha256("gold/a.parquet") == hashlib.sha256(b"abc").hexdigest()


def test_listing_excludes_hns_directory_entries():
    client = MagicMock()
    client.list_blobs.return_value = [
        SimpleNamespace(name="bronze/lastfm", size=0, metadata={"hdi_isfolder": "true"}),
        SimpleNamespace(name="bronze/lastfm/recent_tracks/ingestion_date=2026-11-25", size=0, metadata={}),
        SimpleNamespace(name="bronze/lastfm/recent_tracks/ingestion_date=2026-11-25/run_x/page_0001.json", size=224538, metadata={}),
        SimpleNamespace(name="bronze/x/a.parquet", size=10, metadata=None),
        SimpleNamespace(name="bronze/notes.txt", size=3, metadata=None),
    ]
    storage = AzureStorage(AzureSettings("stlastfmedu"), container_client=client)
    assert [name for name, _ in storage.list_files("bronze")] == [
        "bronze/lastfm/recent_tracks/ingestion_date=2026-11-25/run_x/page_0001.json", "bronze/x/a.parquet"]
    client.list_blobs.assert_called_once_with(name_starts_with="bronze/", include=["metadata"])


def test_list_files_rejects_unscoped_prefix(monkeypatch):
    factory = MagicMock()
    monkeypatch.setattr(azure_cli, "AzureStorage", factory)
    assert azure_cli.main(["--account", "stlastfmedu", "list-files", "--path-prefix", "metadata"]) == 1
    factory.assert_not_called()


def test_local_pipeline_needs_no_azure_or_network(tmp_path, monkeypatch):
    for name in ("AZURE_STORAGE_ACCOUNT", "AZURE_STORAGE_CONTAINER", "AZURE_STORAGE_PREFIX"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(socket, "create_connection", MagicMock(side_effect=AssertionError("network")))
    monkeypatch.setattr(socket.socket, "connect", MagicMock(side_effect=AssertionError("network")))
    monkeypatch.setattr("src.storage.azure.DefaultAzureCredential", MagicMock(side_effect=AssertionError("azure")))
    from src.transformation.transform_scrobbles import transform
    make_run(tmp_path / "bronze", "run-one", 1700000000)
    assert transform(full=True, bronze_root=tmp_path / "bronze", silver_root=tmp_path / "silver")["final_rows"] == 1


def test_state_snapshot_excludes_secrets_and_leaves_state_untouched(data):
    before = {p: p.read_bytes() for p in data.parent.rglob("*") if p.is_file()}
    snapshot = pub.build_state_snapshot(data)
    names = [a.blob_name for a in snapshot.artifacts]
    assert names and all(n.startswith(snapshot.prefix + "/") and n.endswith("metadata.json") for n in names)
    assert not any(".env" in n or "page_" in n or ".parquet" in n for n in names)
    storage = FakeStorage()
    assert pub.upload_state_snapshot(storage, snapshot, verify=True, **QUIET) == snapshot.prefix + "/manifest.json"
    assert b"do-not-upload" not in b"".join(storage.blobs.values())
    assert {p: p.read_bytes() for p in data.parent.rglob("*") if p.is_file()} == before
    with pytest.raises(pub.PublishConflict):  # snapshots are immutable
        pub.upload_state_snapshot(storage, snapshot, **QUIET)


def test_state_snapshot_refuses_credential_like_keys(data):
    (data / "gold" / "_metadata.json").write_text(json.dumps({"generated_at": "x", "api_key": "redacted"}))
    with pytest.raises(ValueError, match="credential-like"):
        pub.build_state_snapshot(data)


def test_real_state_upload_requires_confirm(data, monkeypatch):
    factory = MagicMock()
    monkeypatch.setattr(azure_cli, "AzureStorage", factory)
    assert azure_cli.main(["backup-state"]) == 1
    factory.assert_not_called()


def test_max_pages_failure_never_advances_completed_watermark(data):
    manifest = pub.build_state_snapshot(data).manifest
    statuses = {run["run_id"]: (run["status"], run["failure_type"]) for run in manifest["bronze_runs"]}
    assert statuses["20261125T164024Z"] == ("failed", "MaxPagesLimit")
    assert manifest["completed_runs"] == 1
    assert manifest["completed_watermark_uts"] == 100
    assert manifest["authoritative"] is False
    # Since Phase 6C the ingestion watermark uses the same completed-only rule.
    assert latest_completed_timestamp(data / "bronze") == 100
