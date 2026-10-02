# Last.fm Personal Data Platform

Personal data engineering project for collecting my Last.fm listening history.

Current status: Phase 3 — Gold analytical marts

## Architecture

```text
Last.fm API
     ↓
Python ingestion
     ↓
Bronze / Raw JSON
     ↓
Silver transformation
     ↓
Silver / Typed Parquet
     ↓
Gold analytical marts
```

Bronze stores immutable, auditable `user.getRecentTracks` responses. Silver extracts completed scrobbles, normalizes optional fields, converts timestamps to UTC, deduplicates overlapping events, preserves Bronze lineage, and writes typed Parquet. Gold builds local analytical marts for activity, artists, tracks, discovery, temporal patterns, streaks, concentration, and diversity.

The available history begins in 2016, although tracking was intermittent before 2020. Consistent Last.fm usage begins approximately in 2020. Low or absent pre-2020 scrobble counts must not be interpreted as low music consumption.

## Setup

```bash
git clone <repository>
cd lastfm-data-platform
python -m venv .venv
```

Activate the virtual environment using the command for your operating system, then install dependencies:

```bash
pip install -r requirements.txt
cp .env.example .env
```

Set these values in `.env`:

```text
LASTFM_API_KEY
LASTFM_SHARED_SECRET
LASTFM_USERNAME
```

The shared secret is retained for configuration completeness but is not needed for this read-only endpoint.

## Usage

Run a small development ingestion:

```bash
python -m src.ingestion.ingest_scrobbles --backfill --max-pages 2
```

Run the complete historical backfill:

```bash
python -m src.ingestion.ingest_scrobbles --backfill
```

If a backfill stops after a transient failure, resume the latest incomplete metadata-backed run:

```bash
python -m src.ingestion.ingest_scrobbles --backfill --resume
```

Each execution has one run ID shared by all of its pages and writes `run_metadata.json` with `running`, `failed`, or `completed` state. Older Bronze directories created before run metadata was introduced are preserved and are not automatically migrated or resumed.

Transform all completed metadata-backed Bronze runs into Silver:

```bash
python -m src.transformation.transform_scrobbles --full
```

Process only completed Bronze runs not already recorded in the Silver manifest:

```bash
python -m src.transformation.transform_scrobbles
```

Silver output is local and ignored by Git. See [`docs/phase2-decisions.md`](docs/phase2-decisions.md) for the event identity, run selection, timestamp, null handling, storage, and incremental processing decisions.

Build Gold analytical marts from Silver:

```bash
python -m src.analytics.build_gold --full
```

The Gold build is a deterministic full rebuild because the local Silver dataset is small enough for inexpensive aggregation. Outputs remain local under `data/gold/` and are ignored by Git. See [`docs/phase3-decisions.md`](docs/phase3-decisions.md) for grains, coverage eras, UTC handling, discovery definitions, streaks, concentration, and limitations.

Run incremental ingestion using the latest completed scrobble found in Bronze as its watermark:

```bash
python -m src.ingestion.ingest_scrobbles
```

Each execution writes to a unique run directory under `data/bronze/lastfm/recent_tracks/`. Overlapping raw responses between runs are intentional; event-level deduplication belongs in a future Silver layer. Now-playing tracks are preserved in raw payloads but are excluded from watermark calculation.

## Tests

Tests use mocked HTTP responses and never call Last.fm:

```bash
pytest
```

## Roadmap

- Phase 1 — Bronze ingestion
- Phase 2 — Silver normalization, data quality and incremental processing
- Phase 3 — Gold analytical marts
- Phase 4 — Microsoft Fabric / PySpark
- Phase 5 — Orchestration, observability and data quality
- Phase 6 — Mood/context analytics
