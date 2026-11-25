import hashlib
import json
from pathlib import Path
import shutil
import subprocess

from azure.core.exceptions import ResourceModifiedError
import pandas as pd
import pytest

from src.analytics.gold_builder import build_gold
from src.artwork import enrich
from src.jobs import export_stats as job
from src.storage import checkpoint
from src.transformation.transform_scrobbles import transform
from tests.test_cloud_run import FakeLake
from tests.test_silver_pipeline import make_run


@pytest.fixture
def lake(tmp_path):
    source = tmp_path / "source"
    make_run(source / "bronze", "fictional-run", 1700000000)
    transform(full=True, bronze_root=source / "bronze", silver_root=source / "silver")
    build_gold(silver_path=source / "silver/scrobbles/scrobbles.parquet", gold_root=source / "gold")
    store = FakeLake()
    snapshots = {}
    for layer, root, names, prefix in (
        ("silver", source / "silver/scrobbles", job.SILVER_FILES, "silver/scrobbles/snapshot=20261125T180000Z"),
        ("gold", source / "gold", job.GOLD_FILES, "gold/snapshot=20261125T180001Z"),
    ):
        files = {}
        for name in names:
            data = (root / name).read_bytes()
            store._put(f"{prefix}/{name}", data)
            files[name] = hashlib.sha256(data).hexdigest()
        snapshots[layer] = {"prefix": prefix, "files": files}
    store._put(checkpoint.CHECKPOINT_BLOB, json.dumps({"schema_version": 1, "sequence": 7, "snapshots": snapshots}).encode())
    return store


def export(lake, tmp_path, **kwargs):
    out = tmp_path / "public/stats.json"
    summary = job.run_export(lake, tmp_path / "work", out, **kwargs)
    return summary, json.loads(out.read_text(encoding="utf-8"))


def test_exports_real_gold_without_local_inputs_or_remote_writes(lake, tmp_path):
    before = dict(lake.blobs)
    summary, document = export(lake, tmp_path, refresh_artwork=False)
    assert summary["scrobbles"] == 1
    assert document["source"] == "gold"
    assert document["totals"]["scrobbles"] == 1
    assert len(document["rhythm"]) == 168
    assert lake.blobs == before
    assert list((tmp_path / "public").iterdir()) == [tmp_path / "public/stats.json"]
    text = json.dumps(document)
    for private in ("fictional-user", "scrobble_id", "snapshot=", "watermark", str(tmp_path), "blob.core.windows.net"):
        assert private not in text


def resolved_catalog(silver, limit, retry, ua, interval, directory):
    albums = enrich.albums_from_silver(pd.read_parquet(silver))
    row = {**{name: None for name in enrich.COLUMNS}, **albums.iloc[0].to_dict(),
           "status": "resolved", "provider": "coverartarchive", "checked_at": enrich.now(),
           "image_url": "https://coverartarchive.org/front.jpg", "source_url": "https://musicbrainz.org/release/example"}
    enrich.write_catalog(pd.DataFrame([row]), directory)
    return {"checked": 1}


def test_only_artwork_catalog_is_updated_and_checkpoint_stays_identical(lake, tmp_path):
    before, etags = dict(lake.blobs), dict(lake.etags)
    _, document = export(lake, tmp_path, enrich_fn=resolved_catalog)
    assert document["top_albums"][0]["cover"]["url"].startswith("https://")
    assert set(lake.blobs) - set(before) == {job.CATALOG_BLOB}
    assert all(lake.blobs[key] == value and lake.etags[key] == etags[key] for key, value in before.items())
    assert not lake.lease_held


def test_cached_catalog_is_used_without_provider_calls(lake, tmp_path):
    export(lake, tmp_path / "first", enrich_fn=resolved_catalog)
    before = dict(lake.blobs)
    _, document = export(lake, tmp_path / "second", refresh_artwork=False)
    assert document["top_albums"][0]["cover"]["provider"] == "coverartarchive"
    assert lake.blobs == before


def test_provider_failure_keeps_confirmed_covers_and_fresh_stats(lake, tmp_path):
    def partial(*args, **kwargs):
        return {**resolved_catalog(*args, **kwargs), "stopped": 1}
    _, document = export(lake, tmp_path, enrich_fn=partial)
    assert document["totals"]["scrobbles"] == 1
    assert document["top_albums"][0]["cover"] is not None


def test_concurrent_catalog_update_prevents_publication(lake, tmp_path):
    def conflict(*args, **kwargs):
        raise ResourceModifiedError("concurrent review")
    lake.write_bytes_conditional = conflict
    with pytest.raises(ResourceModifiedError):
        export(lake, tmp_path, enrich_fn=resolved_catalog)
    assert not (tmp_path / "public/stats.json").exists()


@pytest.mark.parametrize("problem", ["checksum", "path", "missing_gold", "missing_hash", "mismatch"])
def test_invalid_snapshots_fail_before_any_remote_write(lake, tmp_path, problem):
    cp = json.loads(lake.blobs[checkpoint.CHECKPOINT_BLOB])
    gold = cp["snapshots"]["gold"]
    name = gold["prefix"] + "/_metadata.json"
    if problem == "checksum":
        lake.blobs[name] = b"tampered"
    elif problem == "path":
        gold["prefix"] = "gold/../../private"
    elif problem == "missing_gold":
        del cp["snapshots"]["gold"]
    elif problem == "missing_hash":
        del gold["files"][job.GOLD_FILES[-1]]
    else:
        meta = json.loads(lake.blobs[name])
        meta["source_silver_rows"] += 1
        lake.blobs[name] = json.dumps(meta).encode()
        gold["files"]["_metadata.json"] = hashlib.sha256(lake.blobs[name]).hexdigest()
    lake.blobs[checkpoint.CHECKPOINT_BLOB] = json.dumps(cp).encode()
    before = dict(lake.blobs)
    with pytest.raises(ValueError):
        export(lake, tmp_path, refresh_artwork=False)
    assert lake.blobs == before
    assert not (tmp_path / "public/stats.json").exists()


def test_missing_checkpoint_does_not_trigger_ingestion(tmp_path):
    with pytest.raises(ValueError, match="committed checkpoint"):
        export(FakeLake(), tmp_path, refresh_artwork=False)


def test_errors_do_not_log_provider_secrets(monkeypatch, tmp_path, caplog):
    def unavailable(**kwargs):
        raise ValueError("SECRET from provider")
    monkeypatch.setattr(job, "load_settings", unavailable)
    assert job.main(["--out", str(tmp_path / "stats.json")]) == 1
    assert "SECRET" not in caplog.text


def test_cloud_export_passes_the_actual_react_contract(lake, tmp_path):
    export(lake, tmp_path, enrich_fn=resolved_catalog)
    node = shutil.which("node")
    assert node is not None, "Install Node 22 to run the Python/React compatibility test"
    script = Path(__file__).resolve().parents[1] / "frontend/scripts/check-stats.ts"
    result = subprocess.run([node, "--experimental-strip-types", str(script), str(tmp_path / "public/stats.json")],
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert "Verified public StatsFile v1" in result.stdout


def test_checkpoint_is_read_once_even_if_the_pipeline_advances(lake, tmp_path):
    original = lake.read_bytes
    reads = []
    def read(name):
        reads.append(name)
        found = original(name)
        if name == checkpoint.CHECKPOINT_BLOB:
            lake.blobs[name] = b'{"schema_version":1,"snapshots":{}}'
        return found
    lake.read_bytes = read
    _, document = export(lake, tmp_path, refresh_artwork=False)
    assert document["totals"]["scrobbles"] == 1
    assert reads.count(checkpoint.CHECKPOINT_BLOB) == 1


def test_cli_removes_private_temporaries_after_failure(monkeypatch, tmp_path):
    from unittest.mock import MagicMock
    storage = MagicMock()
    monkeypatch.setattr(job, "AzureStorage", lambda settings: storage)
    monkeypatch.setattr(job, "load_settings", lambda **kwargs: None)
    directories = []
    def fail(store, work, *args, **kwargs):
        directories.append(work)
        (work / "private.parquet").write_bytes(b"private fixture")
        raise RuntimeError("private provider response")
    monkeypatch.setattr(job, "run_export", fail)
    assert job.main(["--out", str(tmp_path / "stats.json")]) == 1
    assert directories and not directories[0].exists()


def test_missing_consistency_timestamp_is_rejected(lake, tmp_path):
    cp = json.loads(lake.blobs[checkpoint.CHECKPOINT_BLOB])
    for layer, field in (("silver", "last_transformed_at"), ("gold", "source_silver_updated_at")):
        record = cp["snapshots"][layer]
        name = record["prefix"] + "/_metadata.json"
        meta = json.loads(lake.blobs[name])
        meta.pop(field)
        lake.blobs[name] = json.dumps(meta).encode()
        record["files"]["_metadata.json"] = hashlib.sha256(lake.blobs[name]).hexdigest()
    lake.blobs[checkpoint.CHECKPOINT_BLOB] = json.dumps(cp).encode()
    with pytest.raises(job.ExportRejected, match="same dataset"):
        export(lake, tmp_path, refresh_artwork=False)
