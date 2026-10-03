"""Normalized enrichment storage and cache-safe manifests."""

import json
from pathlib import Path
import tempfile
from typing import Any

import pandas as pd


def normalized_root(root: str | Path = "data/enrichment/normalized") -> Path:
    return Path(root)


def read_artists(root: str | Path) -> pd.DataFrame | None:
    path = normalized_root(root) / "artists.parquet"
    return pd.read_parquet(path) if path.exists() else None


def read_artist_tags(root: str | Path) -> pd.DataFrame | None:
    path = normalized_root(root) / "artist_tags.parquet"
    return pd.read_parquet(path) if path.exists() else None


def read_metadata(root: str | Path) -> dict[str, Any]:
    path = normalized_root(root) / "_metadata.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _atomic_parquet(dataframe: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".parquet", dir=path.parent, delete=False) as temporary:
        temporary_path = Path(temporary.name)
    try:
        dataframe.to_parquet(temporary_path, engine="pyarrow", index=False)
        pd.read_parquet(temporary_path, engine="pyarrow")
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)


def write_normalized(artists: pd.DataFrame, tags: pd.DataFrame, root: str | Path) -> None:
    target = normalized_root(root)
    _atomic_parquet(artists, target / "artists.parquet")
    _atomic_parquet(tags, target / "artist_tags.parquet")


def write_metadata(metadata: dict[str, Any], root: str | Path) -> None:
    target = normalized_root(root)
    target.mkdir(parents=True, exist_ok=True)
    path = target / "_metadata.json"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=target, delete=False) as temporary:
        json.dump(metadata, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    temporary_path.replace(path)
