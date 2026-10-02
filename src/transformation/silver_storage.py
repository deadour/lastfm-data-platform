"""Safe local storage for Silver Parquet and metadata."""

import json
from pathlib import Path
import tempfile
from typing import Any

import pandas as pd


PARQUET_NAME = "scrobbles.parquet"
METADATA_NAME = "_metadata.json"


def parquet_path(silver_root: str | Path) -> Path:
    return Path(silver_root) / "scrobbles" / PARQUET_NAME


def metadata_path(silver_root: str | Path) -> Path:
    return Path(silver_root) / "scrobbles" / METADATA_NAME


def read_silver(silver_root: str | Path) -> pd.DataFrame | None:
    path = parquet_path(silver_root)
    return pd.read_parquet(path) if path.exists() else None


def read_metadata(silver_root: str | Path) -> dict[str, Any] | None:
    path = metadata_path(silver_root)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _atomic_replace(source: Path, target: Path) -> None:
    source.replace(target)


def write_silver(dataframe: pd.DataFrame, silver_root: str | Path) -> Path:
    """Write Parquet through a same-directory temporary file and replace."""
    target = parquet_path(silver_root)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".parquet", dir=target.parent, delete=False) as temporary:
        temporary_path = Path(temporary.name)
    try:
        dataframe.to_parquet(temporary_path, engine="pyarrow", index=False)
        pd.read_parquet(temporary_path, engine="pyarrow")
        _atomic_replace(temporary_path, target)
    finally:
        temporary_path.unlink(missing_ok=True)
    return target


def write_metadata(metadata: dict[str, Any], silver_root: str | Path) -> Path:
    target = metadata_path(silver_root)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=target.parent, delete=False) as temporary:
        json.dump(metadata, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    try:
        _atomic_replace(temporary_path, target)
    finally:
        temporary_path.unlink(missing_ok=True)
    return target


def write_rejected(records: list[dict[str, Any]], silver_root: str | Path) -> Path | None:
    """Write rejected raw records atomically; omit the file when there are none."""
    directory = Path(silver_root) / "rejected"
    target = directory / "records.jsonl"
    if not records:
        target.unlink(missing_ok=True)
        return None
    directory.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=directory, delete=False) as temporary:
        for record in records:
            temporary.write(json.dumps(record, ensure_ascii=False) + "\n")
        temporary_path = Path(temporary.name)
    try:
        _atomic_replace(temporary_path, target)
    finally:
        temporary_path.unlink(missing_ok=True)
    return target
