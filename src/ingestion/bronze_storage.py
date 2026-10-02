"""Persistence for immutable raw Last.fm API responses."""

from datetime import datetime, timezone
import json
from pathlib import Path
import re
import tempfile
from typing import Any


RUN_METADATA_NAME = "run_metadata.json"
_PAGE_NAME = re.compile(r"page_(\d{4})\.json$")


def run_directory(output_root: str | Path, run_date: str, run_id: str) -> Path:
    """Return the directory for one ingestion execution."""
    return Path(output_root) / "lastfm" / "recent_tracks" / f"ingestion_date={run_date}" / f"run_{run_id}"


def save_page(payload: dict[str, Any], output_root: str | Path, page: int,
              ingested_at: datetime | None = None, run_id: str | None = None,
              run_date: str | None = None) -> Path:
    """Write one raw response with metadata and atomically return its path."""
    timestamp = ingested_at or datetime.now(timezone.utc)
    run_id = run_id or timestamp.strftime("%Y%m%dT%H%M%SZ")
    ingestion_date = run_date or f"{timestamp:%Y-%m-%d}"
    output_dir = run_directory(output_root, ingestion_date, run_id)
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / f"page_{page:04d}.json"
    document = {"metadata": {"source": "lastfm", "endpoint": "user.getRecentTracks",
                              "ingested_at": timestamp.isoformat().replace("+00:00", "Z"), "page": page},
                "payload": payload}
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=output_dir, delete=False) as temporary:
        json.dump(document, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    temporary_path.replace(target)
    return target


def write_run_metadata(run_dir: str | Path, metadata: dict[str, Any]) -> Path:
    """Atomically write the small state document for one ingestion run."""
    directory = Path(run_dir)
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / RUN_METADATA_NAME
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=directory, delete=False) as temporary:
        json.dump(metadata, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    temporary_path.replace(target)
    return target


def read_run_metadata(run_dir: str | Path) -> dict[str, Any]:
    """Read one run's metadata document."""
    return json.loads((Path(run_dir) / RUN_METADATA_NAME).read_text(encoding="utf-8"))


def persisted_pages(run_dir: str | Path) -> list[int]:
    """Return valid page numbers already persisted in a run directory."""
    pages = []
    for path in Path(run_dir).glob("page_*.json"):
        match = _PAGE_NAME.fullmatch(path.name)
        if match:
            pages.append(int(match.group(1)))
    return sorted(set(pages))


def find_latest_incomplete_backfill(output_root: str | Path) -> tuple[Path, dict[str, Any]] | None:
    """Find the newest metadata-backed backfill that is not completed."""
    candidates = []
    for metadata_path in Path(output_root).glob("lastfm/recent_tracks/ingestion_date=*/run_*/run_metadata.json"):
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if metadata.get("mode") == "backfill" and metadata.get("status") in {"running", "failed"}:
            candidates.append((str(metadata.get("started_at", "")), metadata_path.parent, metadata))
    if not candidates:
        return None
    _, run_dir, metadata = max(candidates, key=lambda item: item[0])
    return run_dir, metadata
def latest_completed_timestamp(output_root: str | Path) -> int | None:
    """Return the greatest completed scrobble timestamp found in Bronze."""
    latest = None
    for path in Path(output_root).glob("lastfm/recent_tracks/ingestion_date=*/run_*/page_*.json"):
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
            tracks = document["payload"]["recenttracks"]["track"]
        except (OSError, ValueError, KeyError, TypeError):
            continue
        for track in tracks:
            if not isinstance(track, dict) or track.get("@attr", {}).get("nowplaying") == "true":
                continue
            try:
                value = int(track["date"]["uts"])
            except (KeyError, TypeError, ValueError):
                continue
            latest = value if latest is None else max(latest, value)
    return latest
