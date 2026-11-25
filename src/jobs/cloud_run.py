"""Stateless daily run against ADLS Gen2 (for GitHub Actions; Phase 6D).

The runner's disk is empty at start and discarded at the end, so ADLS holds
everything that must survive: Bronze runs, Silver/Gold snapshots and one
checkpoint document. One execution:

1. lock     lease ``metadata/checkpoints/lastfm_recent_tracks.lock`` (renewed in background)
2. restore  read the checkpoint; download the Silver snapshot it names; verify SHA-256
3. ingest   incremental from the checkpoint watermark, capped by --max-pages
4. build    Silver incremental (dedup on scrobble_id), Gold full rebuild from Silver
5. publish  new Bronze run, then Silver and Gold snapshots (no-overwrite, idempotent)
6. commit   checkpoint with If-Match; only for a completed run

Nothing is committed if any step fails, so the next run repeats the same
window from the old watermark; duplicates are removed by Silver dedup.

Exit codes: 0 success, 2 page cap reached (partial, not committed), 3 run not
completed, 4 checkpoint missing (seed it first), 5 lock held, 1 other failure.

``seed`` creates the first checkpoint from an already-published Silver
snapshot. It is a dry run unless ``--confirm`` is passed.
"""

import argparse
from contextlib import contextmanager
import json
import logging
from pathlib import Path
import sys
import tempfile
import threading
import time

from azure.core.exceptions import ResourceExistsError

from src.jobs.run_pipeline import JsonFormatter, event, new_run, run_metadata
from src.storage import checkpoint as cp
from src.storage.azure import sha256_file
from src.storage.publish import Artifact, discover_artifacts, publish

LOGGER = logging.getLogger("pipeline_job")
LEASE_SECONDS = 60


class JobStop(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


@contextmanager
def held_lock(storage, renew_every: float = 20):
    try:
        storage.write_bytes_conditional(cp.LOCK_BLOB, b"", etag=None)
    except ResourceExistsError:
        pass  # normal after the first run
    try:
        lease = cp.acquire_lock(storage, LEASE_SECONDS)
    except cp.CheckpointConflict as exc:
        raise JobStop(5, str(exc)) from exc
    stop = threading.Event()

    def renew():
        while not stop.wait(renew_every):
            try:
                lease.renew()
            except Exception:  # the commit's If-Match still guards correctness
                LOGGER.warning("lease renewal failed")

    keeper = threading.Thread(target=renew, daemon=True)
    keeper.start()
    try:
        yield lease
    finally:
        stop.set()
        keeper.join(timeout=5)
        try:
            lease.release()
        except Exception:
            LOGGER.warning("lease release failed; it expires in %ss", LEASE_SECONDS)


def restore_snapshot(storage, snapshot: dict, target_dir: Path) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    for name, expected in snapshot["files"].items():
        local = storage.download_file(f"{snapshot['prefix']}/{name}", target_dir / name)
        if sha256_file(local) != expected:
            raise ValueError(f"Restored {name} does not match the checkpoint SHA-256")


def snapshot_record(artifacts: list[Artifact]) -> dict:
    prefix = artifacts[-1].blob_name.rsplit("/", 1)[0]  # metadata file is last
    return {"prefix": prefix, "files": {a.blob_name[len(prefix) + 1:]: sha256_file(a.source) for a in artifacts}}


def run_job(storage, work: Path, max_pages: int, *, ingest=None, transform=None, build_gold=None) -> int:
    from src.ingestion.bronze_storage import latest_completed_timestamp
    if ingest is None:
        from src.ingestion.ingest_scrobbles import ingest
    if transform is None:
        from src.transformation.transform_scrobbles import transform
    if build_gold is None:
        from src.analytics.gold_builder import build_gold

    bronze, silver, gold = work / "bronze", work / "silver", work / "gold"
    with held_lock(storage):
        current = cp.read(storage)
        if current.etag is None:
            raise JobStop(4, "No remote checkpoint; run `seed` first")
        restore_snapshot(storage, current.document["snapshots"]["silver"], silver / "scrobbles")
        event("restored", watermark=current.watermark, silver=current.document["snapshots"]["silver"]["prefix"])

        before = run_metadata(bronze)
        window_end = int(time.time())
        ingest(backfill=False, max_pages=max_pages, output_root=bronze,
               from_timestamp=current.watermark, to_timestamp=window_end)
        metadata = new_run(before, run_metadata(bronze)) or {}
        event("ingestion finished", run_id=metadata.get("run_id"), status=metadata.get("status"),
              failure_type=metadata.get("failure_type"))
        if metadata.get("failure_type") == "MaxPagesLimit":
            raise JobStop(2, "Page cap reached; nothing committed. Rerun with a higher --max-pages")
        if metadata.get("status") != "completed":
            raise JobStop(3, "Ingestion did not complete; nothing committed")

        run_dir = next(bronze.glob(f"lastfm/recent_tracks/ingestion_date=*/run_{metadata['run_id']}"))
        for path in sorted(run_dir.iterdir()):
            relative = path.relative_to(bronze).as_posix()
            publish(storage, Artifact(path, f"bronze/{relative}", path.stat().st_size), verify=True, log=LOGGER.info)

        snapshots = dict(current.document["snapshots"])
        result = transform(bronze_root=bronze, silver_root=silver)
        if result["new_rows"]:
            build_gold(silver_path=silver / "scrobbles" / "scrobbles.parquet", gold_root=gold)
            for layer in ("silver", "gold"):
                artifacts = discover_artifacts(layer, data_root=work)
                for artifact in artifacts:
                    publish(storage, artifact, verify=True, log=LOGGER.info)
                snapshots[layer] = snapshot_record(artifacts)
        event("built", new_rows=result["new_rows"], final_rows=int(result["final_rows"]))

        fetched = latest_completed_timestamp(bronze)
        watermark = max(filter(None, (current.watermark, fetched)), default=None)
        document = cp.build_document(current, metadata, watermark, snapshots)
        cp.commit(storage, current, document)
        event("checkpoint committed", sequence=document["sequence"], watermark=watermark)
    return 0


def main_job(storage, work: Path, ingest=None, max_pages: int = 25, **steps) -> int:
    """run_job with exit-code mapping; never reports success on failure."""
    try:
        return run_job(storage, work, max_pages, ingest=ingest, **steps)
    except JobStop as stop:
        LOGGER.error(str(stop), extra={"fields": {"exit_code": stop.code}})
        return stop.code
    except Exception as exc:
        LOGGER.error("job failed; checkpoint unchanged", extra={"fields": {"error_type": type(exc).__name__}})
        return 1


def seed_document(storage, silver_prefix: str, data_root: Path) -> dict:
    """First checkpoint: an existing Silver snapshot plus the local completed watermark."""
    from src.ingestion.bronze_storage import latest_completed_timestamp
    from src.transformation.bronze_reader import discover_completed_runs

    files = {}
    for name in ("scrobbles.parquet", "_metadata.json"):
        local = data_root / "silver" / "scrobbles" / name
        remote = storage.remote_sha256(f"{silver_prefix}/{name}")
        if remote != sha256_file(local):
            raise ValueError(f"{silver_prefix}/{name} differs from local Silver; seed from a matching snapshot")
        files[name] = remote
    processed = set(json.loads((data_root / "silver/scrobbles/_metadata.json").read_text(encoding="utf-8"))["processed_bronze_runs"])
    completed = {run.run_id for run in discover_completed_runs(data_root / "bronze")}
    if not completed <= processed:
        raise ValueError(f"Silver is missing completed runs {sorted(completed - processed)}; transform first")
    return {"schema_version": cp.SCHEMA_VERSION, "watermark_uts": latest_completed_timestamp(data_root / "bronze"),
            "last_run_id": None, "committed_at": None, "sequence": 0,
            "snapshots": {"silver": {"prefix": silver_prefix, "files": files}}}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Stateless pipeline run against ADLS Gen2")
    parser.add_argument("--account", help="Override AZURE_STORAGE_ACCOUNT")
    parser.add_argument("--container", help="Override AZURE_STORAGE_CONTAINER")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run")
    run.add_argument("--max-pages", type=int, default=25)
    seed = commands.add_parser("seed")
    seed.add_argument("--silver-snapshot", required=True, help="e.g. silver/scrobbles/snapshot=20261002T223940Z")
    seed.add_argument("--confirm", action="store_true", help="Write the checkpoint (default: print only)")
    args = parser.parse_args(argv)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    logging.getLogger("azure").setLevel(logging.WARNING)  # no HTTP traces in public CI logs

    from src.storage.azure import AzureStorage, load_settings
    try:
        settings = load_settings(account=args.account, container=args.container)
        with AzureStorage(settings) as storage:
            if args.command == "seed":
                document = seed_document(storage, args.silver_snapshot.rstrip("/"), Path("data"))
                print(json.dumps(document, indent=2))
                if not args.confirm:
                    print("Dry run: checkpoint not written. Review, then pass --confirm.")
                    return 0
                cp.commit(storage, cp.Checkpoint({}, None), document)
                print(f"Checkpoint created: {cp.CHECKPOINT_BLOB}")
                return 0
            if args.max_pages < 1:
                parser.error("--max-pages must be positive")
            with tempfile.TemporaryDirectory(prefix="lastfm-job-") as directory:
                return main_job(storage, Path(directory), max_pages=args.max_pages)
    except JobStop as stop:
        LOGGER.error(str(stop), extra={"fields": {"exit_code": stop.code}})
        return stop.code
    except Exception as exc:
        LOGGER.error(f"{args.command} failed", extra={"fields": {"error_type": type(exc).__name__}})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
