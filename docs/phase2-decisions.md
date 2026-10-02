# Phase 2 Engineering Decisions

## Silver grain

One Silver row represents one completed Last.fm scrobble. Currently playing records remain Bronze-only.

## Deduplication and scrobble ID

The observed Bronze data contains overlapping page-boundary records and overlap between the historical and incremental runs. MBIDs are frequently missing, so they are not part of event identity.

The canonical identity is the case-folded, whitespace-normalized user, artist name, track name, and Unix scrobble timestamp. A SHA-256 hash of that identity is `scrobble_id`. The first record in deterministic Bronze run/page order supplies lineage for duplicates.

This cannot distinguish two genuinely separate listens of the same track by the same user in the same second. That limitation is preferable to allowing known Bronze overlap into Silver.

## Timestamp strategy

The Last.fm Unix timestamp is converted to a timezone-aware UTC datetime. Derived calendar fields are also UTC-based. No historical local timezone is inferred.

## Null handling

Optional empty fields such as album names and MBIDs become proper Parquet nulls. Missing required user, artist, track, or timestamp fields are rejected with their Bronze run/page lineage instead of being silently discarded.

## Bronze run selection

Only Bronze runs with valid `run_metadata.json`, `status=completed`, complete page lists, and the expected page files are authoritative. Legacy directories without metadata and failed/running runs are excluded and preserved.

## Silver storage and partitioning

The current dataset is approximately 117k events, so Silver uses one typed Parquet file at `data/silver/scrobbles/scrobbles.parquet`. Partitioning by year is unnecessary at this scale and would add complexity. The layout can evolve later if volume or workload justifies it.

## Incremental strategy

`data/silver/scrobbles/_metadata.json` records processed Bronze run IDs. Incremental mode transforms only completed runs not listed there, merges them with existing Silver, and deduplicates by `scrobble_id`. Repeating the command without a new completed Bronze run is a no-op.

## Atomicity and rejects

Parquet, metadata, and rejected-record files are written through temporary same-directory files followed by replacement. Malformed records are quarantined under `data/silver/rejected/records.jsonl`; the current real dataset produced no rejects.

## Observed schema

Real Bronze pages contain artist, album, track name, MBIDs, URL, images, streamable flag, and date objects. `date.uts` is the canonical timestamp. `nowplaying` appears as an optional `@attr` object and is excluded from Silver.
