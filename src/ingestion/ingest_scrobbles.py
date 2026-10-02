"""Command-line ingestion for Last.fm recent tracks."""

import argparse
from datetime import datetime, timezone
import logging
from pathlib import Path

from .bronze_storage import (
    find_latest_incomplete_backfill,
    latest_completed_timestamp,
    persisted_pages,
    run_directory,
    save_page,
    write_run_metadata,
)
from .config import load_settings
from .lastfm_client import LastFMClient, LastFMError

LOGGER = logging.getLogger("lastfm_ingestion")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _isoformat(timestamp: datetime) -> str:
    return timestamp.isoformat().replace("+00:00", "Z")


def _new_run(output_root: str | Path, mode: str, started_at: datetime) -> tuple[Path, dict]:
    run_id = started_at.strftime("%Y%m%dT%H%M%SZ")
    run_dir = run_directory(output_root, f"{started_at:%Y-%m-%d}", run_id)
    metadata = {
        "run_id": run_id,
        "mode": mode,
        "started_at": _isoformat(started_at),
        "completed_at": None,
        "status": "running",
        "pages_saved": [],
        "expected_pages": None,
    }
    write_run_metadata(run_dir, metadata)
    return run_dir, metadata


def _mark_failed(run_dir: Path, metadata: dict, exc: BaseException) -> None:
    metadata["status"] = "failed"
    metadata["completed_at"] = None
    metadata["failure_type"] = type(exc).__name__
    write_run_metadata(run_dir, metadata)


def ingest(backfill: bool, max_pages: int | None = None, output_root: str | Path = "data/bronze",
           resume: bool = False) -> int:
    settings = load_settings()
    client = LastFMClient(settings.api_key, settings.username)
    watermark = None if backfill else latest_completed_timestamp(output_root)
    mode = "backfill" if backfill else "incremental"
    started_at = _utc_now()

    if backfill and resume:
        existing = find_latest_incomplete_backfill(output_root)
        if existing:
            run_dir, metadata = existing
            metadata["status"] = "running"
            write_run_metadata(run_dir, metadata)
            run_id = metadata["run_id"]
            run_date = run_dir.parent.name.removeprefix("ingestion_date=")
            LOGGER.info("Resuming backfill run=%s", run_id)
        else:
            LOGGER.info("No incomplete metadata-backed backfill found; starting a new run")
            run_dir, metadata = _new_run(output_root, mode, started_at)
            run_id = metadata["run_id"]
            run_date = f"{started_at:%Y-%m-%d}"
    else:
        run_dir, metadata = _new_run(output_root, mode, started_at)
        run_id = metadata["run_id"]
        run_date = f"{started_at:%Y-%m-%d}"

    LOGGER.info("Starting Last.fm ingestion; mode=%s user=%s run=%s", mode, settings.username, run_id)
    if watermark is not None:
        LOGGER.info("Using latest completed scrobble timestamp as watermark: %s", watermark)

    saved_this_execution = 0
    try:
        existing_pages = set(persisted_pages(run_dir))
        expected_pages = metadata.get("expected_pages")
        if backfill:
            if isinstance(expected_pages, int) and expected_pages > 0:
                missing_pages = [page for page in range(1, expected_pages + 1) if page not in existing_pages]
                page = min(missing_pages) if missing_pages else expected_pages + 1
            else:
                page = max(existing_pages, default=0) + 1
        else:
            page = 1
        total_pages = expected_pages if isinstance(expected_pages, int) else None

        while True:
            LOGGER.info("Fetching page %s%s", page, f"/{total_pages}" if total_pages else "")
            payload = client.get_recent_tracks(page=page, from_timestamp=watermark)
            recent = payload["recenttracks"]
            attr = recent.get("@attr", {})
            try:
                total_pages = int(attr.get("totalPages", 1))
            except (TypeError, ValueError):
                total_pages = 1
            tracks = recent.get("track", [])
            path = save_page(payload, output_root, page, ingested_at=_utc_now(), run_id=run_id, run_date=run_date)
            existing_pages.add(page)
            metadata["pages_saved"] = sorted(existing_pages)
            metadata["expected_pages"] = total_pages
            write_run_metadata(run_dir, metadata)
            LOGGER.info("Received %s tracks; saved %s", len(tracks), path)
            saved_this_execution += 1

            if max_pages is not None and saved_this_execution >= max_pages:
                metadata["status"] = "failed"
                metadata["failure_type"] = "MaxPagesLimit"
                write_run_metadata(run_dir, metadata)
                LOGGER.info("Reached max-pages=%s", max_pages)
                return saved_this_execution
            if page >= total_pages or not tracks:
                break
            page += 1

        complete = all(number in existing_pages for number in range(1, total_pages + 1))
        metadata["status"] = "completed" if complete else "failed"
        if complete:
            metadata["completed_at"] = _isoformat(_utc_now())
        else:
            metadata["failure_type"] = "IncompletePages"
        write_run_metadata(run_dir, metadata)
    except Exception as exc:
        _mark_failed(run_dir, metadata, exc)
        raise

    LOGGER.info("%s ingestion completed; pages_saved=%s", mode.capitalize(), saved_this_execution)
    return saved_this_execution


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest Last.fm listening history into Bronze JSON")
    parser.add_argument("--backfill", action="store_true", help="Fetch all available historical pages")
    parser.add_argument("--resume", action="store_true", help="Resume the latest incomplete backfill run")
    parser.add_argument("--max-pages", type=int, help="Stop after this many pages (useful for development)")
    args = parser.parse_args()
    if args.max_pages is not None and args.max_pages < 1:
        parser.error("--max-pages must be positive")
    if args.resume and not args.backfill:
        parser.error("--resume requires --backfill")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        ingest(backfill=args.backfill, max_pages=args.max_pages, resume=args.resume)
    except LastFMError as exc:
        LOGGER.error("Ingestion failed: %s", exc)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
