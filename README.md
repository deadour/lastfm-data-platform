# Last.fm Personal Data Platform

Personal data engineering project for collecting my Last.fm listening history.

Current status: Phase 1 — Bronze ingestion

## Architecture

```text
Last.fm API
     ↓
Python ingestion
     ↓
Bronze / Raw JSON
```

The current phase retrieves `user.getRecentTracks` responses and stores them as immutable, auditable JSON files. It does not build analytics or transformed datasets yet.

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
- Phase 2 — Silver normalization and dimensional modeling
- Phase 3 — Gold analytical marts
- Phase 4 — Microsoft Fabric / PySpark
- Phase 5 — Orchestration, observability and data quality
- Phase 6 — Mood/context analytics
