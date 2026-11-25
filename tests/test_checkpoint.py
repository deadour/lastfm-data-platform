import json
from unittest.mock import MagicMock

from azure.core import MatchConditions
from azure.core.exceptions import HttpResponseError, ResourceExistsError, ResourceModifiedError, ServiceRequestError
import pytest

from src.storage import checkpoint as cp
from src.storage.azure import AzureSettings, AzureStorage


class FakeBlobs:
    """In-memory blobs with ETag preconditions and one lease, like Azure."""

    def __init__(self):
        self.blobs, self.etags, self.counter, self.leased = {}, {}, 0, False
        self.fail_next_write = None

    def read_bytes(self, name):
        return (self.blobs[name], self.etags[name]) if name in self.blobs else None

    def write_bytes_conditional(self, name, data, *, etag):
        if self.fail_next_write:
            error, self.fail_next_write = self.fail_next_write, None
            raise error
        if etag is None and name in self.blobs:
            raise ResourceExistsError("exists")
        if etag is not None and self.etags.get(name) != etag:
            raise ResourceModifiedError("modified")
        self.counter += 1
        self.blobs[name], self.etags[name] = data, f'"{self.counter}"'
        return self.etags[name]

    def acquire_lease(self, name, seconds):
        if self.leased:
            error = HttpResponseError("lease already present")
            error.status_code = 409
            raise error
        self.leased = True
        return MagicMock()


def run(run_id="r1", status="completed", pages=(1, 2), expected=2, failure_type=None):
    return {"run_id": run_id, "status": status, "pages_saved": list(pages), "expected_pages": expected,
            "failure_type": failure_type}


def test_first_commit_creates_and_second_requires_matching_etag():
    store = FakeBlobs()
    empty = cp.read(store)
    assert empty.etag is None and empty.watermark is None
    etag = cp.commit(store, empty, cp.build_document(empty, run(), 100))
    current = cp.read(store)
    assert current.etag == etag and current.watermark == 100 and current.document["sequence"] == 1
    cp.commit(store, current, cp.build_document(current, run("r2"), 150))
    assert cp.read(store).watermark == 150


def test_concurrent_writers_cannot_both_commit():
    store = FakeBlobs()
    cp.commit(store, cp.read(store), cp.build_document(cp.read(store), run(), 100))
    a, b = cp.read(store), cp.read(store)
    cp.commit(store, a, cp.build_document(a, run("a"), 200))
    with pytest.raises(cp.CheckpointConflict):
        cp.commit(store, b, cp.build_document(b, run("b"), 300))
    assert cp.read(store).watermark == 200


def test_two_first_commits_race():
    store = FakeBlobs()
    a, b = cp.read(store), cp.read(store)
    cp.commit(store, a, cp.build_document(a, run("a"), 1))
    with pytest.raises(cp.CheckpointConflict):
        cp.commit(store, b, cp.build_document(b, run("b"), 2))


def test_lock_is_exclusive():
    store = FakeBlobs()
    cp.acquire_lock(store)
    with pytest.raises(cp.CheckpointConflict):
        cp.acquire_lock(store)


@pytest.mark.parametrize("metadata", [
    run(status="failed", pages=(1,), expected=5, failure_type="MaxPagesLimit"),
    run(status="running"),
    run(status="failed", failure_type="IncompletePages"),
    run(pages=(1,), expected=2),
])
def test_unfinished_runs_never_advance(metadata):
    with pytest.raises(cp.CheckpointRejected):
        cp.build_document(cp.Checkpoint({}, None), metadata, 999)


def test_watermark_never_moves_backwards():
    previous = cp.Checkpoint({"schema_version": 1, "watermark_uts": 500}, '"1"')
    with pytest.raises(cp.CheckpointRejected):
        cp.build_document(previous, run(), 400)
    assert cp.build_document(previous, run(), 500)["watermark_uts"] == 500  # empty window


def test_network_failure_leaves_checkpoint_untouched():
    store = FakeBlobs()
    cp.commit(store, cp.read(store), cp.build_document(cp.read(store), run(), 100))
    before = store.blobs.copy()
    store.fail_next_write = ServiceRequestError("connection reset")
    current = cp.read(store)
    with pytest.raises(ServiceRequestError):
        cp.commit(store, current, cp.build_document(current, run("r2"), 200))
    assert store.blobs == before
    # Retrying from a fresh read succeeds once the network is back.
    current = cp.read(store)
    cp.commit(store, current, cp.build_document(current, run("r2"), 200))
    assert cp.read(store).watermark == 200


def test_unknown_schema_is_rejected():
    store = FakeBlobs()
    store.blobs[cp.CHECKPOINT_BLOB], store.etags[cp.CHECKPOINT_BLOB] = json.dumps({"schema_version": 99}).encode(), '"x"'
    with pytest.raises(cp.CheckpointRejected):
        cp.read(store)


def test_adapter_sends_azure_preconditions():
    client = MagicMock()
    blob = client.get_blob_client.return_value
    blob.upload_blob.return_value = {"etag": '"2"'}
    storage = AzureStorage(AzureSettings("stlastfmedu"), container_client=client)
    assert storage.write_bytes_conditional("metadata/checkpoints/a.json", b"{}", etag=None) == '"2"'
    client.get_blob_client.assert_called_with("metadata/checkpoints/a.json")
    assert blob.upload_blob.call_args.kwargs["if_none_match"] == "*"
    assert blob.upload_blob.call_args.kwargs["overwrite"] is False
    assert storage.write_bytes_conditional("metadata/checkpoints/a.json", b"{}", etag='"1"') == '"2"'
    kwargs = blob.upload_blob.call_args.kwargs
    assert (kwargs["etag"], kwargs["match_condition"], kwargs["overwrite"]) == ('"1"', MatchConditions.IfNotModified, True)
    client.upload_blob.assert_not_called()  # ContainerClient.upload_blob returns no etag


def test_checkpoint_is_not_wired_into_local_pipeline():
    import pathlib
    sources = [p.read_text(encoding="utf-8") for p in pathlib.Path("src").rglob("*.py") if p.name != "checkpoint.py"]
    assert not any("checkpoint import" in s or "from .checkpoint" in s or "storage.checkpoint" in s for s in sources)
