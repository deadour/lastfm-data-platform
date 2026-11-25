"""Export public frontend statistics from committed Azure snapshots.

The pipeline checkpoint is read once, never leased or written. Only the separate
artwork catalog can be updated remotely; publication happens outside this job.
"""

import argparse
import json
import logging
from pathlib import Path
import re
import tempfile

import pandas as pd
import pyarrow.parquet as pq

from src.artwork import enrich
from src.artwork.export_frontend import build, write
from src.storage import checkpoint
from src.storage.azure import AzureStorage, load_settings, sha256_file


LOGGER = logging.getLogger(__name__)
CATALOG_BLOB = "artwork/frontend/catalog.json"
GOLD_FILES = (
    "_metadata.json",
    "listening_yearly/listening_yearly.parquet",
    "listening_monthly/listening_monthly.parquet",
    "listening_daily/listening_daily.parquet",
    "artist_stats/artist_stats.parquet",
    "track_stats/track_stats.parquet",
    "listening_patterns/listening_patterns.parquet",
    "listening_patterns/streaks.parquet",
)
SILVER_FILES = ("_metadata.json", "scrobbles.parquet")


class ExportRejected(ValueError):
    """A safe-to-log validation failure in the snapshot export contract."""


def restore(storage, record: dict, layer: str, files: tuple[str, ...], target: Path) -> None:
    """Restore only allowlisted files, checking the committed content hashes."""
    root = "gold" if layer == "gold" else "silver/scrobbles"
    prefix = record.get("prefix", "")
    if not re.fullmatch(rf"{root}/snapshot=\d{{8}}T\d{{6}}Z", prefix):
        raise ExportRejected(f"Invalid {layer} snapshot prefix")
    expected = record.get("files", {})
    for name in files:
        if not re.fullmatch(r"[a-f0-9]{64}", str(expected.get(name, ""))):
            raise ExportRejected(f"Missing or invalid {layer} snapshot checksum for {name}")
    for name in files:
        local = target / name
        local.parent.mkdir(parents=True, exist_ok=True)
        storage.download_file(f"{prefix}/{name}", local)
        if sha256_file(local) != expected[name]:
            raise ExportRejected(f"{layer} snapshot checksum mismatch for {name}")


def restore_catalog(storage, directory: Path) -> str | None:
    found = storage.read_bytes(CATALOG_BLOB)
    if found is None:
        return None
    content, etag = found
    records = json.loads(content)
    if not isinstance(records, list):
        raise ExportRejected("Artwork catalog must contain a list of records")
    catalog = pd.DataFrame(records, columns=enrich.COLUMNS)
    if (catalog["album_key"].isna().any() or catalog["album_key"].duplicated().any()
            or not catalog["status"].isin(["resolved", "needs_review", "not_found", "rejected"]).all()):
        raise ExportRejected("Artwork catalog has invalid keys or statuses")
    enrich.write_catalog(catalog, directory)
    return etag


def run_export(storage, work: Path, out: Path, *, artwork_limit: int = 100,
               top: int = 20, refresh_artwork: bool = True, enrich_fn=None) -> dict:
    if not 1 <= top <= 100 or not 1 <= artwork_limit <= 500:
        raise ExportRejected("top must be 1–100 and artwork_limit must be 1–500")
    current = checkpoint.read(storage)
    snapshots = current.document.get("snapshots", {})
    if not all(layer in snapshots for layer in ("gold", "silver")):
        raise ExportRejected("A committed checkpoint with Gold and Silver snapshots is required; run the pipeline separately")

    gold, silver, catalog_dir = work / "gold", work / "silver", work / "artwork"
    restore(storage, snapshots["gold"], "gold", GOLD_FILES, gold)
    restore(storage, snapshots["silver"], "silver", SILVER_FILES, silver)
    gold_meta = json.loads((gold / "_metadata.json").read_text(encoding="utf-8"))
    silver_meta = json.loads((silver / "_metadata.json").read_text(encoding="utf-8"))
    silver_path = silver / "scrobbles.parquet"
    if (gold_meta.get("source_silver_rows") != pq.read_metadata(silver_path).num_rows
            or gold_meta.get("source_silver_updated_at") != silver_meta.get("last_transformed_at")):
        raise ExportRejected("Gold and Silver snapshots do not describe the same dataset")

    etag = restore_catalog(storage, catalog_dir)
    if refresh_artwork:
        config = json.loads((Path(__file__).resolve().parents[2] / "config/enrichment.json").read_text(encoding="utf-8"))
        counts = (enrich_fn or enrich.run)(
            silver_path, artwork_limit, 30, config["musicbrainz_user_agent"],
            float(config["musicbrainz_interval_seconds"]), directory=catalog_dir,
        )
        if counts.get("checked"):
            # Separate catalog state, guarded against concurrent refresh/review.
            # A lost ETag race fails the export; no public artifact is published.
            content = enrich.read_catalog(catalog_dir).to_json(orient="records", force_ascii=False).encode("utf-8")
            storage.write_bytes_conditional(CATALOG_BLOB, content, etag=etag)
        if counts.get("stopped"):
            LOGGER.warning("Artwork provider unavailable; exporting with confirmed covers collected so far")

    document = build(gold, silver_path, enrich.read_catalog(catalog_dir), top)
    write(document, out)
    return {"scrobbles": document["totals"]["scrobbles"], "data_as_of": document["data_as_of"],
            "bytes": out.stat().st_size}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export frontend stats from Azure without advancing pipeline state")
    parser.add_argument("--account")
    parser.add_argument("--container")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--artwork-limit", type=int, default=100)
    parser.add_argument("--top", type=int, default=20)
    parser.add_argument("--skip-artwork-refresh", action="store_true", help="Use the existing remote catalog without provider calls or remote writes")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    logging.getLogger("azure").setLevel(logging.ERROR)
    try:
        with AzureStorage(load_settings(account=args.account, container=args.container)) as storage:
            with tempfile.TemporaryDirectory(prefix="lastfm-export-") as temporary:
                summary = run_export(storage, Path(temporary), args.out, artwork_limit=args.artwork_limit,
                                     top=args.top, refresh_artwork=not args.skip_artwork_refresh)
        print(json.dumps(summary))
        return 0
    except Exception as exc:
        # Provider/SDK errors can carry URLs and credentials; do not expose their
        # bodies or private lake content in public Actions logs.
        detail = str(exc) if isinstance(exc, ExportRejected) else type(exc).__name__
        LOGGER.error("Frontend export failed (%s); no deployment should follow", detail)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
