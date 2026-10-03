# Last.fm Personal Data Platform

Current implemented scope: Phase 4 — artist metadata enrichment. The repository
contains a local Bronze → Silver → Gold pipeline plus separate MusicBrainz and
Last.fm artist enrichment. See [`docs/PROJECT_WALKTHROUGH.md`](docs/PROJECT_WALKTHROUGH.md)
for the technical walkthrough.

Personal data engineering project for collecting my Last.fm listening history.

Current status: Phase 4 — Artist metadata enrichment

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
     ↘
      Separate artist enrichment: MusicBrainz + Last.fm tags
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

Build the Phase 5 enriched analytical product from local Silver and Phase 4 outputs:

```bash
python -m src.analytics.build_enriched --profile
streamlit run dashboard/app.py
```

Phase 5 writes ignored local outputs under `data/gold_enriched/` and consumes
them in a Streamlit dashboard without reading raw personal data. It validates
the artist bridge, keeps tags as a one-to-many association, profiles genre,
geography, lifecycle, diversity, concentration and discovery, and labels the
incomplete 2026 calendar year. See [`docs/phase5-decisions.md`](docs/phase5-decisions.md)
for the actual grains, weighting policy, coverage and findings.

## Tests

Tests use mocked HTTP responses and never call Last.fm:

```bash
pytest
```

## Roadmap

Phase 4 artist enrichment is implemented separately from Bronze and Silver:

```bash
python -m src.enrichment.enrich --profile --resume
python -m src.enrichment.enrich --from-cache --profile --resume
```

The second command rebuilds normalized outputs from the local raw cache without
network calls. The real local snapshot contains 116,871 Silver events and 4,956
artist entities. Tracking before 2020 is incomplete, and calendar year 2026 is
incomplete; recorded counts must not be interpreted as complete consumption.

See [`docs/phase4-decisions.md`](docs/phase4-decisions.md) and the [project
walkthrough](docs/PROJECT_WALKTHROUGH.md) for grains, coverage and limitations.

Phase 4 artist metadata enrichment is implemented separately from Bronze and
Silver using cache-first MusicBrainz identity resolution and Last.fm artist tags.

- Phase 1 — Bronze ingestion
- Phase 2 — Silver normalization, data quality and incremental processing
- Phase 3 — Gold analytical marts
- Phase 4 — Artist metadata enrichment
- Phase 5 — Enriched analytics and local portfolio dashboard
- Phase 6 — Future architecture and productionization (not implemented)
