"""One bounded, local-first pipeline execution for a scheduled job.

ingest (incremental, page-capped) -> Silver (incremental) -> Gold.
Exit codes: 0 success, 2 ingestion stopped by the page cap (not a success),
3 ingestion finished without a completed run, 1 any other failure.

Azure publication and the remote checkpoint are deliberately not wired in yet
(Phase 6D); this runner never writes outside the local data directories.
"""

import argparse
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import sys
import time

LOGGER = logging.getLogger("pipeline_job")


class JsonFormatter(logging.Formatter):
    def format(self, record):
        entry = {"ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat().replace("+00:00", "Z"),
                 "level": record.levelname, "logger": record.name, "message": record.getMessage()}
        entry.update(getattr(record, "fields", {}))
        return json.dumps(entry, ensure_ascii=False)


def event(message: str, **fields) -> None:
    LOGGER.info(message, extra={"fields": fields})


def run_metadata(bronze_root: Path) -> dict[str, dict]:
    runs = {}
    for path in bronze_root.glob("lastfm/recent_tracks/ingestion_date=*/run_*/run_metadata.json"):
        try:
            metadata = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        runs[str(path.parent)] = metadata
    return runs


def new_run(before: dict[str, dict], after: dict[str, dict]) -> dict | None:
    created = [metadata for key, metadata in after.items() if key not in before]
    return max(created, key=lambda item: str(item.get("started_at", "")), default=None)


def run(max_pages: int, bronze_root: Path, silver_root: Path, skip_gold: bool = False) -> int:
    from src.analytics.gold_builder import build_gold
    from src.ingestion.ingest_scrobbles import ingest
    from src.transformation.transform_scrobbles import transform

    clock = time.monotonic()
    before = run_metadata(bronze_root)
    pages = ingest(backfill=False, max_pages=max_pages, output_root=bronze_root)
    metadata = new_run(before, run_metadata(bronze_root)) or {}
    status, failure = metadata.get("status"), metadata.get("failure_type")
    event("ingestion finished", run_id=metadata.get("run_id"), status=status, failure_type=failure, pages=pages)
    if failure == "MaxPagesLimit":
        event("page cap reached; run is partial and will not be transformed or advance any watermark",
              max_pages=max_pages)
        return 2
    if status != "completed":
        return 3
    result = transform(bronze_root=bronze_root, silver_root=silver_root)
    event("silver finished", processed_runs=result["processed_runs"], new_rows=result["new_rows"],
          final_rows=int(result["final_rows"]))
    if not skip_gold:
        gold = build_gold(silver_path=silver_root / "scrobbles" / "scrobbles.parquet")
        event("gold finished", marts=gold["marts"])
    event("job succeeded", seconds=round(time.monotonic() - clock, 1))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one bounded incremental pipeline execution")
    parser.add_argument("--max-pages", type=int, default=25, help="Page cap (200 scrobbles each); default 25")
    parser.add_argument("--bronze-root", type=Path, default=Path("data/bronze"))
    parser.add_argument("--silver-root", type=Path, default=Path("data/silver"))
    parser.add_argument("--skip-gold", action="store_true")
    args = parser.parse_args(argv)
    if args.max_pages < 1:
        parser.error("--max-pages must be positive")
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    logging.getLogger("azure").setLevel(logging.WARNING)  # no HTTP traces in public CI logs
    try:
        return run(args.max_pages, args.bronze_root, args.silver_root, args.skip_gold)
    except Exception as exc:  # report and exit non-zero; never a silent success
        LOGGER.error("job failed", extra={"fields": {"error_type": type(exc).__name__}})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
