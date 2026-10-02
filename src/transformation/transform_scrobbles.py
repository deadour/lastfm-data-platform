"""CLI for full and incremental Silver scrobble transformations."""

import argparse
from datetime import datetime, timezone
import logging
from pathlib import Path
from typing import Any

import pandas as pd

from .bronze_reader import BronzeRun, discover_completed_runs
from .scrobble_transformer import TransformStats, profile_dataframe, transform_runs, validate_dataframe
from .silver_storage import read_metadata, read_silver, write_metadata, write_rejected, write_silver

LOGGER = logging.getLogger("silver_transformation")


def _metadata_payload(processed_runs: list[str], dataframe: Any, stats: TransformStats,
                      profile: dict[str, Any], rejected_count: int) -> dict[str, Any]:
    return {
        "last_transformed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "processed_bronze_runs": processed_runs,
        "row_count": int(len(dataframe)),
        "schema_version": 1,
        "last_run": {
            "raw_records": stats.raw_records,
            "completed_scrobbles": stats.completed_scrobbles,
            "now_playing_skipped": stats.now_playing_skipped,
            "duplicates_removed": stats.duplicates_removed,
            "malformed_rejected": stats.malformed_rejected,
            "rejected_records": rejected_count,
            "profile": profile,
        },
    }


def _merge_stats(first: TransformStats, second: TransformStats) -> TransformStats:
    return TransformStats(
        raw_records=first.raw_records + second.raw_records,
        completed_scrobbles=first.completed_scrobbles + second.completed_scrobbles,
        now_playing_skipped=first.now_playing_skipped + second.now_playing_skipped,
        malformed_rejected=first.malformed_rejected + second.malformed_rejected,
        duplicates_removed=first.duplicates_removed + second.duplicates_removed,
    )


def transform(full: bool = False, bronze_root: str | Path = "data/bronze",
              silver_root: str | Path = "data/silver", show_profile: bool = False) -> dict[str, Any]:
    runs = discover_completed_runs(bronze_root)
    LOGGER.info("Found %s completed Bronze runs", len(runs))
    existing = read_silver(silver_root)
    previous_metadata = read_metadata(silver_root) or {}
    processed = set(previous_metadata.get("processed_bronze_runs", []))
    selected_runs = runs if full else [run for run in runs if run.run_id not in processed]

    if not full and not selected_runs:
        if existing is None:
            raise ValueError("No completed Bronze runs available for Silver transformation")
        validate_dataframe(existing)
        profile = profile_dataframe(existing)
        LOGGER.info("No new completed Bronze runs; Silver remains at %s rows", len(existing))
        if show_profile:
            LOGGER.info("Silver profile: %s", profile)
        return {"processed_runs": 0, "new_rows": 0, "final_rows": len(existing), "profile": profile}

    LOGGER.info("Transforming %s Bronze runs", len(selected_runs))
    new_dataframe, stats, rejected = transform_runs(selected_runs)
    if full or existing is None:
        combined = new_dataframe
        processed_runs = [run.run_id for run in runs]
    else:
        combined = existing
        if not new_dataframe.empty:
            combined = pd.concat([combined, new_dataframe], ignore_index=True)
        processed_runs = sorted(processed.union(run.run_id for run in selected_runs))

    before_dedup = len(combined)
    combined = combined.sort_values(["scrobbled_at", "bronze_run_id", "bronze_page", "scrobble_id"])
    combined = combined.drop_duplicates("scrobble_id", keep="first").reset_index(drop=True)
    stats.duplicates_removed += before_dedup - len(combined)
    validate_dataframe(combined)
    profile = profile_dataframe(combined)
    write_silver(combined, silver_root)
    write_rejected(rejected, silver_root)
    write_metadata(_metadata_payload(processed_runs, combined, stats, profile, len(rejected)), silver_root)

    LOGGER.info("Raw records read=%s; completed=%s; now-playing skipped=%s; malformed rejected=%s; duplicates removed=%s",
                stats.raw_records, stats.completed_scrobbles, stats.now_playing_skipped,
                stats.malformed_rejected, stats.duplicates_removed)
    LOGGER.info("Wrote %s Silver rows to %s", len(combined), Path(silver_root) / "scrobbles" / "scrobbles.parquet")
    if show_profile or full:
        LOGGER.info("Silver profile: %s", profile)
    return {"processed_runs": len(selected_runs), "new_rows": len(new_dataframe), "final_rows": len(combined),
            "stats": stats, "profile": profile}


def main() -> None:
    parser = argparse.ArgumentParser(description="Transform completed Last.fm Bronze runs into Silver Parquet")
    parser.add_argument("--full", action="store_true", help="Rebuild Silver from all completed Bronze runs")
    parser.add_argument("--profile", action="store_true", help="Log aggregate Silver profile metrics")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    transform(full=args.full, show_profile=args.profile)


if __name__ == "__main__":
    main()
