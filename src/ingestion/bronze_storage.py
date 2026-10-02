"""Persistence for immutable raw Last.fm API responses."""

from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
from typing import Any


def save_page(payload: dict[str, Any], output_root: str | Path, page: int,
              ingested_at: datetime | None = None, run_id: str | None = None) -> Path:
    """Write one raw response with metadata and atomically return its path."""
    timestamp = ingested_at or datetime.now(timezone.utc)
    run_id = run_id or timestamp.strftime("%Y%m%dT%H%M%SZ")
    output_dir = Path(output_root) / "lastfm" / "recent_tracks" / f"ingestion_date={timestamp:%Y-%m-%d}" / f"run_{run_id}"
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
