"""Opt-in publication of local Silver/Gold snapshots and state backups.

Nothing here runs during ingestion or transformation. Remote objects are
written without overwrite unless the caller explicitly asks for it, and the
local pipeline state is only read, never modified.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import tempfile
from typing import Any, Callable

from .azure import DATA_SUFFIXES, normalize_blob_name, sha256_file


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = PROJECT_ROOT / "data"


@dataclass(frozen=True)
class Layer:
    """A local output directory and the metadata file that versions it."""
    name: str
    root: str
    metadata: str  # relative to root
    version_key: str


LAYERS = {
    # Silver keeps one canonical table plus metadata; rejected raw records stay local.
    "silver": Layer("silver", "silver", "scrobbles/_metadata.json", "last_transformed_at"),
    "gold": Layer("gold", "gold", "_metadata.json", "generated_at"),
    "gold_enriched": Layer("gold_enriched", "gold_enriched", "_metadata.json", "generated_at"),
}


@dataclass(frozen=True)
class Artifact:
    source: Path
    blob_name: str
    size: int


def snapshot_id(timestamp: str) -> str:
    """Turn an ISO timestamp from layer metadata into a compact UTC identifier."""
    parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Layer metadata timestamp must include a timezone")
    return parsed.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def layer_snapshot(layer: Layer, data_root: Path) -> str:
    path = data_root / layer.root / layer.metadata
    try:
        value = json.loads(path.read_text(encoding="utf-8"))[layer.version_key]
    except (KeyError, TypeError) as exc:
        raise ValueError(f"{path} has no {layer.version_key}; rebuild the layer before publishing") from exc
    return snapshot_id(value)


def destination(layer: Layer, relative: Path, snapshot: str) -> str:
    """silver/scrobbles/x.parquet -> silver/scrobbles/snapshot=<id>/x.parquet;
    gold/<mart>/x.parquet -> gold/snapshot=<id>/<mart>/x.parquet."""
    parts = relative.parts
    if layer.name == "silver":
        return normalize_blob_name("/".join(("silver", parts[0], f"snapshot={snapshot}", *parts[1:])))
    return normalize_blob_name("/".join((layer.name, f"snapshot={snapshot}", *parts)))


def discover_artifacts(layer_name: str, path: str | Path | None = None,
                       data_root: Path | None = None) -> list[Artifact]:
    """Return existing data files in deterministic order; metadata goes last."""
    data_root = data_root or DATA_ROOT
    layer = LAYERS[layer_name]
    root = (data_root / layer.root).resolve()
    selected = Path(path).resolve(strict=True) if path is not None else root
    if not selected.is_relative_to(root):
        raise ValueError(f"--path must be inside {root}")
    snapshot = layer_snapshot(layer, data_root)
    candidates = [selected] if selected.is_file() else sorted(selected.rglob("*"))
    metadata = (root / layer.metadata).resolve()
    files = [item for item in candidates if item.is_file() and item.suffix.lower() in DATA_SUFFIXES
             and not any(part.startswith(".") for part in item.relative_to(root).parts)
             and (layer.name != "silver" or item.relative_to(root).parts[0] == "scrobbles")]
    if not files:
        raise ValueError(f"No publishable {layer_name} files found under {selected}")
    if metadata not in files:
        files.append(metadata)  # always ship the version manifest of the snapshot
    files.sort(key=lambda item: (item == metadata, item.relative_to(root).as_posix()))
    return [Artifact(item, destination(layer, item.relative_to(root), snapshot), item.stat().st_size)
            for item in files]


class PublishConflict(ValueError):
    """A remote object exists with different bytes and overwrite was not requested."""


def publish(storage, artifact: Artifact, *, overwrite: bool = False, verify: bool = False,
            log: Callable[[str], None] = print) -> str:
    """Upload one file idempotently. Returns uploaded, matched or overwritten."""
    local = sha256_file(artifact.source)
    properties = storage.blob_properties(artifact.blob_name)
    outcome = "uploaded"
    if properties is not None:
        recorded = (properties.metadata or {}).get("sha256")
        # The SHA-256 recorded at upload time avoids a download; without it, hash the remote bytes.
        remote = recorded if recorded and not verify else storage.remote_sha256(artifact.blob_name)
        if remote == local:
            log(f"Already matches: {artifact.blob_name} (sha256 {local})")
            return "matched"
        if not overwrite:
            raise PublishConflict(f"Remote {artifact.blob_name} differs from {artifact.source.name}; "
                                  "refusing to overwrite without --overwrite")
        outcome = "overwritten"
    storage.upload_file(artifact.source, artifact.blob_name, overwrite=properties is not None,
                        metadata={"sha256": local})
    log(f"{outcome.capitalize()}: {artifact.blob_name} ({artifact.size} bytes)")
    if verify:
        remote = storage.remote_sha256(artifact.blob_name)
        if remote != local:
            raise ValueError(f"SHA-256 mismatch for {artifact.blob_name}: local {local}, remote {remote}")
        log(f"SHA-256 verified: {local}")
    return outcome


# --- State snapshots -------------------------------------------------------

STATE_FILES = ("silver/scrobbles/_metadata.json", "gold/_metadata.json",
               "gold_enriched/_metadata.json", "enrichment/normalized/_metadata.json")
_SENSITIVE_KEY = re.compile(r"api[_-]?key|secret|token|password|credential|session[_-]?key", re.IGNORECASE)


def _sensitive_keys(value: Any) -> set[str]:
    found = set()
    if isinstance(value, dict):
        for key, item in value.items():
            if _SENSITIVE_KEY.search(str(key)):
                found.add(str(key))
            found |= _sensitive_keys(item)
    elif isinstance(value, list):
        for item in value:
            found |= _sensitive_keys(item)
    return found


def completed_watermark(bronze_root: Path) -> int | None:
    """Greatest scrobble timestamp from completed runs only.

    Unlike the ingestion watermark, pages from failed runs (including
    failed/MaxPagesLimit) are excluded, so a partial run can never advance it.
    """
    from src.transformation.bronze_reader import discover_completed_runs, read_page

    latest = None
    for run in discover_completed_runs(bronze_root):
        for page in run.pages:
            for track in read_page(page)["payload"]["recenttracks"]["track"]:
                if not isinstance(track, dict) or track.get("@attr", {}).get("nowplaying") == "true":
                    continue
                try:
                    value = int(track["date"]["uts"])
                except (KeyError, TypeError, ValueError):
                    continue
                latest = value if latest is None else max(latest, value)
    return latest


@dataclass
class StateSnapshot:
    prefix: str
    artifacts: list[Artifact]
    manifest: dict[str, Any]


def build_state_snapshot(data_root: Path | None = None, now: datetime | None = None) -> StateSnapshot:
    """Collect allow-listed metadata files; reads only, never writes local state."""
    data_root = data_root or DATA_ROOT
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
    prefix = f"metadata/state_backups/{stamp}"
    runs, files, skipped = [], [], []
    paths = sorted((data_root / "bronze").glob("lastfm/recent_tracks/ingestion_date=*/run_*/run_metadata.json"))
    paths += [data_root / name for name in STATE_FILES if (data_root / name).exists()]
    for path in paths:
        relative = path.relative_to(data_root).as_posix()
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            skipped.append({"path": relative, "reason": type(exc).__name__})
            continue
        if keys := _sensitive_keys(document):
            raise ValueError(f"{relative} contains credential-like keys {sorted(keys)}; refusing to back it up")
        if path.name == "run_metadata.json":
            runs.append({"run_id": document.get("run_id"), "mode": document.get("mode"),
                         "status": document.get("status"), "failure_type": document.get("failure_type")})
        files.append(Artifact(path, f"{prefix}/{relative}", path.stat().st_size))
    manifest = {
        "kind": "lastfm_state_backup",
        "authoritative": False,
        "note": "Snapshot only. Restore is manual; this does not move any checkpoint.",
        "created_at": f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]}T{stamp[9:11]}:{stamp[11:13]}:{stamp[13:15]}Z",
        "bronze_runs": runs,
        "completed_runs": sum(run["status"] == "completed" for run in runs),
        "completed_watermark_uts": completed_watermark(data_root / "bronze"),
        "files": [{"path": item.source.relative_to(data_root).as_posix(), "size": item.size,
                   "sha256": sha256_file(item.source)} for item in files],
        "skipped": skipped,
    }
    return StateSnapshot(prefix, files, manifest)


def upload_state_snapshot(storage, snapshot: StateSnapshot, *, verify: bool = False,
                          log: Callable[[str], None] = print) -> str:
    """Upload files then the manifest, never overwriting; returns manifest blob name."""
    for artifact in snapshot.artifacts:
        if storage.blob_properties(artifact.blob_name) is not None:
            raise PublishConflict(f"State backup already exists: {artifact.blob_name}")
        publish(storage, artifact, verify=verify, log=log)
    with tempfile.TemporaryDirectory(prefix="lastfm-state-") as directory:
        path = Path(directory) / "manifest.json"
        path.write_text(json.dumps(snapshot.manifest, indent=2) + "\n", encoding="utf-8")
        name = f"{snapshot.prefix}/manifest.json"
        if storage.blob_properties(name) is not None:
            raise PublishConflict(f"State backup already exists: {name}")
        publish(storage, Artifact(path, name, path.stat().st_size), verify=verify, log=log)
    return name
