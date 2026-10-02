"""Command-line ingestion for Last.fm recent tracks."""

import argparse
import logging
from pathlib import Path

from .bronze_storage import latest_completed_timestamp, save_page
from .config import load_settings
from .lastfm_client import LastFMClient

LOGGER = logging.getLogger("lastfm_ingestion")


def ingest(backfill: bool, max_pages: int | None = None, output_root: str | Path = "data/bronze") -> int:
    settings = load_settings()
    client = LastFMClient(settings.api_key, settings.username)
    watermark = None if backfill else latest_completed_timestamp(output_root)
    mode = "backfill" if backfill else "incremental"
    LOGGER.info("Starting Last.fm ingestion; mode=%s user=%s", mode, settings.username)
    if watermark is not None:
        LOGGER.info("Using latest completed scrobble timestamp as watermark: %s", watermark)

    page = 1
    saved = 0
    total_pages = None
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
        path = save_page(payload, output_root, page)
        LOGGER.info("Received %s tracks; saved %s", len(tracks), path)
        saved += 1
        if max_pages is not None and saved >= max_pages:
            LOGGER.info("Reached max-pages=%s", max_pages)
            break
        if page >= total_pages or not tracks:
            break
        page += 1
    LOGGER.info("%s ingestion completed; pages_saved=%s", mode.capitalize(), saved)
    return saved


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest Last.fm listening history into Bronze JSON")
    parser.add_argument("--backfill", action="store_true", help="Fetch all available historical pages")
    parser.add_argument("--max-pages", type=int, help="Stop after this many pages (useful for development)")
    args = parser.parse_args()
    if args.max_pages is not None and args.max_pages < 1:
        parser.error("--max-pages must be positive")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ingest(backfill=args.backfill, max_pages=args.max_pages)


if __name__ == "__main__":
    main()
