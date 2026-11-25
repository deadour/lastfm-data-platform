"""Remote incremental checkpoint for future cloud jobs (Phase 6C design, inactive).

Nothing in the local pipeline imports this module, and no command writes the
checkpoint yet. It exists so the commit protocol can be reviewed and tested
before Phase 6D deploys a job.

Protocol for one job execution:

1. ``acquire_lock`` takes a blob lease on ``LOCK_BLOB`` (single writer).
2. ``read`` returns the current checkpoint and its ETag.
3. The job ingests, transforms and publishes snapshots (all idempotent).
4. ``commit`` validates the finished run and writes the new document only if
   the ETag is unchanged (``If-Match``), or only if absent on first commit
   (``If-None-Match: *``). A lost race raises ``CheckpointConflict``.

A crash before step 4 leaves the previous checkpoint untouched, so the next
run repeats the same window; Bronze runs are new directories and Silver
deduplicates by ``scrobble_id``, which makes the retry safe.

This is distinct from ``backup-state``: backups are immutable copies for
humans, the checkpoint is the single mutable document a job trusts.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from typing import Any

from azure.core.exceptions import ResourceExistsError, ResourceModifiedError, HttpResponseError


CHECKPOINT_BLOB = "metadata/checkpoints/lastfm_recent_tracks.json"
LOCK_BLOB = "metadata/checkpoints/lastfm_recent_tracks.lock"
SCHEMA_VERSION = 1


class CheckpointConflict(RuntimeError):
    """Another writer changed the checkpoint, or the lock is held."""


class CheckpointRejected(ValueError):
    """The proposed commit is not a valid advancement."""


@dataclass(frozen=True)
class Checkpoint:
    document: dict[str, Any]
    etag: str | None  # None: no checkpoint exists yet

    @property
    def watermark(self) -> int | None:
        return self.document.get("watermark_uts")


def read(storage, name: str = CHECKPOINT_BLOB) -> Checkpoint:
    found = storage.read_bytes(name)
    if found is None:
        return Checkpoint({}, None)
    content, etag = found
    document = json.loads(content)
    if document.get("schema_version") != SCHEMA_VERSION:
        raise CheckpointRejected(f"Unsupported checkpoint schema: {document.get('schema_version')}")
    return Checkpoint(document, etag)


def acquire_lock(storage, seconds: int = 60, name: str = LOCK_BLOB):
    """Return a lease; the caller must release it. Fails fast if another job holds it."""
    try:
        return storage.acquire_lease(name, seconds)
    except HttpResponseError as exc:
        if getattr(exc, "status_code", None) == 409:
            raise CheckpointConflict("Another job holds the checkpoint lock") from exc
        raise


def build_document(previous: Checkpoint, run_metadata: dict[str, Any], watermark: int | None,
                   snapshots: dict[str, str] | None = None, now: datetime | None = None) -> dict[str, Any]:
    """Validate a finished run and return the next checkpoint document."""
    if run_metadata.get("status") != "completed":
        raise CheckpointRejected(
            f"Run {run_metadata.get('run_id')} is {run_metadata.get('status')}"
            f"{' / ' + run_metadata['failure_type'] if run_metadata.get('failure_type') else ''}; "
            "only completed runs may advance the checkpoint")
    expected = run_metadata.get("expected_pages")
    # An empty window reports totalPages=0 yet saves page 1, so require a superset.
    if not isinstance(expected, int) or expected < 0 or not set(range(1, expected + 1)) <= set(run_metadata.get("pages_saved") or []):
        raise CheckpointRejected("Completed run metadata does not list every expected page")
    if previous.watermark is not None:
        if watermark is None or watermark < previous.watermark:
            raise CheckpointRejected("The watermark may never move backwards")
    stamp = (now or datetime.now(timezone.utc)).isoformat().replace("+00:00", "Z")
    return {
        "schema_version": SCHEMA_VERSION,
        "watermark_uts": watermark,
        "last_run_id": run_metadata.get("run_id"),
        "committed_at": stamp,
        "snapshots": snapshots or previous.document.get("snapshots", {}),
        "sequence": int(previous.document.get("sequence", 0)) + 1,
    }


def commit(storage, previous: Checkpoint, document: dict[str, Any], name: str = CHECKPOINT_BLOB) -> str:
    data = (json.dumps(document, indent=2, sort_keys=True) + "\n").encode("utf-8")
    try:
        return storage.write_bytes_conditional(name, data, etag=previous.etag)
    except (ResourceExistsError, ResourceModifiedError) as exc:
        raise CheckpointConflict("Checkpoint changed since it was read; not overwriting") from exc
    except HttpResponseError as exc:
        if getattr(exc, "status_code", None) in {409, 412}:
            raise CheckpointConflict("Checkpoint changed since it was read; not overwriting") from exc
        raise
