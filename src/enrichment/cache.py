"""Small filesystem cache for external enrichment responses."""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import tempfile
from typing import Any


class EnrichmentCache:
    def __init__(self, root: str | Path = "data/enrichment/raw"):
        self.root = Path(root)

    def _path(self, provider: str, entity_type: str, request_identity: str) -> Path:
        key = hashlib.sha256(f"{provider}\x1f{entity_type}\x1f{request_identity}".encode("utf-8")).hexdigest()
        return self.root / provider / f"{entity_type}s" / f"{key}.json"

    def load(self, provider: str, entity_type: str, request_identity: str) -> dict[str, Any] | None:
        path = self._path(provider, entity_type, request_identity)
        if not path.exists():
            return None
        try:
            cached = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if not isinstance(cached, dict) or cached.get("status") not in {"success", "not_found", "error"}:
            return None
        return cached

    def store(self, provider: str, entity_type: str, request_identity: str, status: str,
              response: Any = None, error: str | None = None) -> Path:
        path = self._path(provider, entity_type, request_identity)
        path.parent.mkdir(parents=True, exist_ok=True)
        document = {
            "provider": provider,
            "entity_type": entity_type,
            "request_identity": request_identity,
            "retrieved_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "status": status,
            "response": response,
        }
        if error:
            document["error"] = error
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as temporary:
            json.dump(document, temporary, ensure_ascii=False, indent=2)
            temporary.write("\n")
            temporary_path = Path(temporary.name)
        temporary_path.replace(path)
        return path
