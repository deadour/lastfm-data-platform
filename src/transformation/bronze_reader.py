"""Discovery and reading of metadata-backed Bronze runs."""

from dataclasses import dataclass
import json
import logging
from pathlib import Path
from typing import Any, Iterator

LOGGER = logging.getLogger(__name__)


class BronzeReadError(ValueError):
    """Raised when an authoritative Bronze page is malformed."""


@dataclass(frozen=True)
class BronzeRun:
    run_id: str
    run_dir: Path
    started_at: str
    pages: tuple[Path, ...]


def _page_number(path: Path) -> int:
    try:
        return int(path.stem.removeprefix("page_"))
    except ValueError as exc:
        raise BronzeReadError(f"Invalid Bronze page filename: {path.name}") from exc


def discover_completed_runs(bronze_root: str | Path) -> list[BronzeRun]:
    """Return only complete, metadata-backed Bronze runs in deterministic order."""
    root = Path(bronze_root)
    runs: list[BronzeRun] = []
    for metadata_path in sorted(root.glob("lastfm/recent_tracks/ingestion_date=*/run_*/run_metadata.json")):
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            LOGGER.warning("Skipping unreadable Bronze metadata: %s", metadata_path.name)
            continue
        if metadata.get("status") != "completed":
            LOGGER.info("Skipping non-completed Bronze run: %s", metadata_path.parent.name)
            continue
        run_id = metadata.get("run_id")
        expected_pages = metadata.get("expected_pages")
        pages_saved = metadata.get("pages_saved")
        if not isinstance(run_id, str) or not isinstance(expected_pages, int) or not isinstance(pages_saved, list):
            LOGGER.warning("Skipping invalid Bronze metadata: %s", metadata_path.parent.name)
            continue
        expected_numbers = set(range(1, expected_pages + 1))
        saved_numbers = {page for page in pages_saved if isinstance(page, int)}
        page_paths = sorted(metadata_path.parent.glob("page_*.json"), key=_page_number)
        actual_numbers = {_page_number(path) for path in page_paths}
        if saved_numbers != expected_numbers or actual_numbers != expected_numbers:
            LOGGER.warning("Skipping incomplete Bronze run: %s", run_id)
            continue
        runs.append(BronzeRun(run_id, metadata_path.parent, str(metadata.get("started_at", "")), tuple(page_paths)))
    return sorted(runs, key=lambda run: (run.started_at, run.run_id))


def read_page(path: Path) -> dict[str, Any]:
    """Read and minimally validate one raw Last.fm page."""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise BronzeReadError(f"Could not read Bronze page: {path.name}") from exc
    if not isinstance(document, dict) or not isinstance(document.get("payload"), dict):
        raise BronzeReadError(f"Bronze page has no payload: {path.name}")
    recent_tracks = document["payload"].get("recenttracks")
    if not isinstance(recent_tracks, dict) or not isinstance(recent_tracks.get("track"), list):
        raise BronzeReadError(f"Bronze page has no recenttracks.track list: {path.name}")
    return document


def iter_run_pages(run: BronzeRun) -> Iterator[tuple[int, dict[str, Any]]]:
    """Yield page number and raw document for a valid Bronze run."""
    for path in run.pages:
        yield _page_number(path), read_page(path)
