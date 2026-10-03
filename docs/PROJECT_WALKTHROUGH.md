# Last.fm Data Platform — Project Walkthrough

This walkthrough describes the repository as it exists today. It is an
interview-oriented explanation of the implementation, not a proposal for a
different system.

## 1. Architecture at a glance

```text
Last.fm REST API
        |
        v
Python ingestion client
        |
        v
Bronze: immutable page-level JSON + run metadata
        |
        v
Silver: validated, deduplicated scrobble Parquet
        |
        +--------------------+
        |                    |
        v                    v
Gold analytical marts   Phase 4 enrichment
                        MusicBrainz + Last.fm tags
                        raw JSON cache + normalized Parquet
```

The source system is Last.fm. Bronze, Silver and Gold are local filesystem
layers. External artist metadata is deliberately a side layer: it does not
mutate trusted Silver listening events. The current real local dataset contains
116,871 Silver events, 4,956 unique artist entities, 16,465 artist-track pairs,
and 8 yearly Gold rows covering the available recorded years.

The implementation is a small Python batch pipeline using `requests`,
`python-dotenv`, `pandas`, `pyarrow` and `pytest`. There is no database,
orchestrator, Spark job, cloud storage, dashboard or production deployment.

## 2. Components at three levels

### Ingestion

Plain: downloads Last.fm pages and preserves the responses exactly enough to
audit what the provider returned.

Technical: a paginated REST client writes immutable raw page documents and
metadata-backed execution state to a Bronze directory.

Why: an API call should not be the only copy of historical source data. Raw
pages make transformation reproducible and allow failures to be resumed.

### Silver transformation

Plain: turns the raw pages into one clean row per completed listening event.

Technical: it discovers authoritative completed Bronze runs, normalizes fields,
creates a deterministic SHA-256 event key, quarantines malformed records and
deduplicates overlapping input before writing typed Parquet.

Why: downstream analytics need stable types, one event grain and explicit data
quality behavior rather than provider-shaped JSON.

### Gold analytics

Plain: summarizes Silver events into tables useful for listening analysis.

Technical: deterministic pandas aggregations produce daily, monthly, yearly,
artist, track, discovery, temporal-pattern and streak marts.

Why: reusable marts prevent every analysis from redefining counts, dates,
concentration or discovery logic.

### External enrichment

Plain: identifies artists and attaches MusicBrainz fields and Last.fm community
tags.

Technical: entity-first resolution uses a deterministic artist key, a raw
provider cache, direct MBID lookup, conservative MusicBrainz search matching,
and normalized artist/tag Parquet outputs.

Why: one request per artist is feasible and auditable; one request per scrobble
would be wasteful and would amplify rate-limit and matching problems.

### Metadata and tests

Plain: small JSON metadata files explain what was processed and how it was
classified; tests exercise failure behavior without requiring live APIs.

Technical: metadata records run state, processed run IDs, schema/profile data,
provider cache state and Gold quality checks. Unit tests use mocked sessions and
temporary local files.

Why: operational state and invariants must be inspectable without opening the
large generated datasets.

## 3. Phase 1 — ingestion and Bronze

Relevant files:

- `src/ingestion/lastfm_client.py`
- `src/ingestion/bronze_storage.py`
- `src/ingestion/ingest_scrobbles.py`
- `src/ingestion/config.py`
- `tests/test_lastfm_client.py`
- `tests/test_bronze_storage.py`
- `tests/test_ingest_scrobbles.py`

### Client and request shape

`LastFMClient.endpoint` is exactly `https://ws.audioscrobbler.com/2.0/`.
`get_recent_tracks` sends `method=user.getRecentTracks`, the configured
username, API key, `format=json`, page and limit, plus optional `from` and `to`
timestamps. This read-only endpoint does not use a session key or shared secret.

The API key is kept in memory from `.env` but is redacted from debug parameter
representations and exceptions. Request exceptions are converted to generic
messages because a `requests` exception can contain a complete URL. HTTP errors
include status and safely extracted Last.fm body detail, while sensitive values
are redacted.

### Pagination and run execution

The CLI entry point is:

```text
python -m src.ingestion.ingest_scrobbles [--backfill] [--resume] [--max-pages N]
```

`ingest()` loads settings, creates a client, determines the mode and creates
one run ID from the execution start timestamp. All pages in that execution use
that same run directory. A page is stored as:

```text
data/bronze/lastfm/recent_tracks/
  ingestion_date=YYYY-MM-DD/run_YYYYMMDDTHHMMSSZ/page_0001.json
```

Each page contains a small metadata object and the raw `payload`. Page writes
are atomic temporary-file replacements.

For a historical backfill, the API-reported `totalPages` becomes
`expected_pages`. The command continues until all pages are present or the
response has no tracks. `--max-pages` intentionally marks a development run as
failed, so it cannot be mistaken for a complete authoritative backfill.

For incremental ingestion, Bronze is scanned for the greatest completed
scrobble timestamp, excluding now-playing records. That timestamp is passed as
the `from` watermark. The incremental execution itself still receives and
stores pages in a new run directory.

### Retry, failure and resume

The client retries HTTP 429, 500, 502, 503 and 504, and Last.fm API error 8.
The default is six total attempts with delays of approximately 1, 2, 4, 8 and
16 seconds. Permanent API/configuration errors are not retried. Retry warnings
contain status/reason and attempt number, never a URL or credential.

`run_metadata.json` contains `run_id`, mode, timestamps, status, saved page
numbers, expected page count and failure type. A failed or interrupted backfill
can be resumed with:

```text
python -m src.ingestion.ingest_scrobbles --backfill --resume
```

Resume selects the newest metadata-backed `running` or `failed` backfill,
reuses its run ID and requests the next missing page. Legacy page directories
without trustworthy metadata are preserved and are not automatically migrated.

Now-playing records remain in raw Bronze for auditability. They are excluded
from the watermark and Silver. Configuration requires `LASTFM_API_KEY` and
`LASTFM_USERNAME`; `LASTFM_SHARED_SECRET` is optional and currently unused.

## 4. Phase 2 — Silver

Relevant files:

- `src/transformation/bronze_reader.py`
- `src/transformation/scrobble_transformer.py`
- `src/transformation/silver_storage.py`
- `src/transformation/transform_scrobbles.py`
- `tests/test_bronze_reader.py`
- `tests/test_scrobble_transformer.py`
- `tests/test_silver_pipeline.py`
- `docs/phase2-decisions.md`

### Bronze discovery

`discover_completed_runs()` selects only runs with readable metadata,
`status=completed`, a valid integer `expected_pages`, matching `pages_saved`,
and exactly the expected page files. Failed, running, malformed and legacy
directories are skipped but not deleted.

### Silver grain

One Silver row represents one completed Last.fm scrobble after source-overlap
deduplication. Currently playing records are not Silver rows.

The canonical event identity is the case-folded, whitespace-normalized user,
artist, track and Unix timestamp joined with a separator. Its SHA-256 digest is
`scrobble_id`. This protects against page overlap and repeated ingestion. It
cannot distinguish two genuine listens of the same track in the same second;
that is an explicit documented trade-off.

### Actual Silver schema

```text
scrobble_id       string
user              string
track_name        string
artist_name       string
album_name        string | null
track_mbid        string | null
artist_mbid       string | null
album_mbid        string | null
lastfm_track_url  string | null
scrobbled_at      datetime64[ns, UTC]
scrobble_date     date
scrobble_year     Int64
scrobble_month    Int64
scrobble_day      Int64
scrobble_hour     Int64
scrobble_weekday  Int64
source            string
bronze_run_id     string
bronze_page       Int64
transformed_at    datetime64[ns, UTC]
```

Required user, artist, track and timestamp values are rejected when missing.
Optional empty values become null. Bad timestamps and non-object records are
quarantined in `data/silver/rejected/records.jsonl` with Bronze lineage.
Timestamps are converted to UTC; calendar fields are UTC calendar fields, not
historical local-time claims.

### Processing and idempotency

The full command is:

```text
python -m src.transformation.transform_scrobbles --full
```

Without `--full`, the Silver metadata manifest selects completed Bronze run IDs
not already processed. New rows are combined with existing Silver and
deduplicated again. Re-running without a new completed Bronze run is a no-op.
Parquet, metadata and rejects are written atomically. The real Silver dataset
contains 116,871 rows and produced no current reject file.

## 5. Phase 3 — Gold

Relevant files:

- `src/analytics/gold_builder.py`
- `src/analytics/build_gold.py`
- `config/analytics.json`
- `tests/test_gold_builder.py`
- `docs/phase3-decisions.md`

Gold is rebuilt deterministically from the current Silver Parquet:

```text
python -m src.analytics.build_gold --full --profile
```

The CLI currently calls the same full builder whether or not `--full` is
present. Outputs are staged, read back for validation and then replaced.

### Tracking eras and historical context

`config/analytics.json` sets `2020-01-01` as the consistent-tracking boundary.
Events before it are `partial_tracking`; events on or after it are
`consistent_tracking`. The real distribution has 999 partial-tracking rows and
115,872 consistent-tracking rows. 2017–2019 have no recorded events, but that
does not mean zero listening: pre-2020 tracking is incomplete. Any comparison
of recorded volume across the boundary must preserve that context.

The current Silver reaches into calendar year 2026, but that year is incomplete
at the time of the local build. A partial current calendar year must not be
interpreted as a full-year decline or change in consumption.

### Gold marts

| Dataset | Grain | Current local rows | Purpose and important columns |
|---|---:|---:|---|
| `listening_daily` | one recorded date and tracking era | 2,334 | daily scrobbles, unique artists/tracks, UTC year/month/weekday |
| `listening_monthly` | one year-month and era | 85 | scrobbles, active days, unique entities, scrobbles per active day |
| `listening_yearly` | one year and era | 8 | volume, activity, discovery, top artist, concentration and diversity |
| `artist_stats` | one artist-year and era | 9,600 | annual count/rank/share plus all-time totals, first/last seen and persistence |
| `track_stats` | one artist-track pair | 16,465 | total count, first/last seen, active days/years, peak year |
| `discovery` | one year and era | 8 | observed unique entities, newly observed entities, returning artists and discovery rate |
| `listening_patterns` | one era, UTC weekday and UTC hour | 281 | event count, unique artists and share of era events |
| `streaks` | one consecutive recorded-date streak since 2020 | 91 | start, end, length and consistent-tracking label |

Days with no recorded events are not materialized. A missing date is not proof
that no music was heard.

Gold validates that daily and yearly scrobble totals conserve all 116,871 Silver
rows, rejects negative counts and invalid calendar values, checks tracking-era
values and bounds artist shares to [0, 1]. The local metadata records the
longest recorded post-2020 streak as 186 days and the latest recorded streak as
61 days. These are recorded-event measures, not claims about unrecorded days.

## 6. Phase 4 — artist enrichment

Relevant files:

- `src/enrichment/enrich.py`
- `src/enrichment/cache.py`
- `src/enrichment/musicbrainz_client.py`
- `src/enrichment/lastfm_tags_client.py`
- `src/enrichment/artist_resolver.py`
- `src/enrichment/storage.py`
- `config/enrichment.json`
- `tests/test_enrichment.py`
- `docs/phase4-decisions.md`

### Entity-first identity and resolution

The workflow extracts unique artist names from Silver, orders them by recorded
scrobble count and assigns a deterministic SHA-256 `artist_key` from Unicode-
normalized, whitespace-collapsed source name. Case is preserved in the local
key so source entities are not silently merged.

For each artist, a valid existing Silver MBID is looked up directly first. If
there is no usable MBID, MusicBrainz search results are compared conservatively:
one exact candidate resolves, multiple exact candidates remain ambiguous, and a
unique sufficiently high-score candidate can resolve as a search match. The
statuses are `resolved`, `ambiguous`, `not_found` and `error`. Methods include
`existing_mbid`, `exact_name` and `search_match`; candidate counts and
categorical confidence are retained.

MusicBrainz uses a meaningful User-Agent and waits at least one second between
requests. Last.fm `artist.getTopTags` responses are fetched once per artist,
with a bounded client retry policy. The raw cache is hashed by provider,
entity type and request identity; it never uses raw artist names as filenames.
Normalized outputs are:

```text
data/enrichment/normalized/artists.parquet
data/enrichment/normalized/artist_tags.parquet
```

`artists.parquet` has one row per artist entity. `artist_tags.parquet` has one
row per artist and normalized tag, preserving raw tag text, tag count, rank,
source and retrieval time. Tags use Unicode normalization, whitespace collapse
and case folding; duplicate artist/tag rows are removed. Checkpoints are
written every ten artists. A normal rerun reuses successful cache/normalized
state and retries previous errors; `--from-cache` is an offline rebuild.

### Verified real results

The full local run evaluated all 4,956 artists:

```text
resolved: 3,349
ambiguous: 287
not found: 1,316
persistent errors: 4
MusicBrainz entity coverage: 67.575%
MusicBrainz event-weighted coverage: 88.860%
Artists with Last.fm tags: 3,654
Last.fm event-weighted tag coverage: 95.024%
Unique tags: 4,196
```

Entity coverage weights every artist equally. Event-weighted coverage weights
an artist by the number of Silver scrobbles represented by it. The higher event
coverage shows the long-tail effect: popular artists are more likely to be
resolved or tagged, while many unresolved entities contribute few events.

Enrichment is not joined back into Silver because Silver is the trusted record
of listening events and source lineage. External metadata can change, be
ambiguous or disappear; keeping it separate makes both layers independently
rebuildable and auditable.

## 7. Storage formats

JSON is used for raw API pages, run state, configuration and metadata because
it preserves nested provider responses and is easy to inspect. Bronze is raw
and auditable, so flattening it early would lose source shape.

Parquet is used for Silver, Gold and normalized enrichment because these are
tabular analytical datasets. Parquet is columnar: readers can load only needed
columns, types are stored with the data, and repeated values compress well.
For this local scale it also gives simple portable files without introducing a
database.

## 8. Engineering glossary

| Term | Plain definition | Technical definition and repository example |
|---|---|---|
| API | A programmatic service interface | Last.fm REST endpoint consumed by `LastFMClient`. |
| REST | HTTP resource-style integration | GET requests to Last.fm with query parameters. |
| Data ingestion | Bringing source data into the platform | Last.fm pages written to Bronze. |
| Batch processing | Work performed in bounded runs | Backfill, Silver transform and Gold rebuild CLIs. |
| Historical backfill | Loading all available past pages | `--backfill` paginates the complete recent-track history. |
| Incremental load | Loading data after a remembered point | Bronze watermark uses the latest completed timestamp. |
| Watermark | Progress marker for incremental work | Greatest completed Bronze `date.uts`. |
| Bronze | Raw immutable landing layer | Page JSON plus `run_metadata.json`. |
| Silver | Validated canonical event layer | One completed scrobble per row. |
| Gold | Consumer-oriented analytical layer | Daily, yearly, artist and track marts. |
| Medallion Architecture | Layered raw-to-curated organization | Bronze → Silver → Gold in this repository. |
| Schema | Field names and types | `SILVER_COLUMNS` and Parquet dtypes. |
| Parquet | Typed columnar file format | Silver and every Gold mart use Parquet. |
| Columnar storage | Data stored by column rather than row | Gold queries can read only selected metrics. |
| Deduplication | Removing repeated representations | Silver drops duplicate `scrobble_id` values. |
| Deterministic ID | Same input always produces same ID | SHA-256 event and artist keys. |
| Idempotency | Repeating work does not change the result | Silver manifest and event-key deduplication. |
| Lineage | Where a row came from | Silver stores Bronze run ID and page. |
| Provenance | Source and retrieval history | Enrichment stores provider, source and retrieval timestamps. |
| Data quality | Rules that identify invalid data | Silver rejects malformed records; Gold conservation checks. |
| Data mart | Purpose-built analytical table | `listening_yearly` and `artist_stats`. |
| Grain | What one row represents | `track_stats` is one artist-track pair. |
| Enrichment | Adding external descriptive data | MusicBrainz fields and Last.fm tags. |
| Entity resolution | Matching imperfect names to entities | MusicBrainz MBID/name candidate resolution. |
| MBID | MusicBrainz entity identifier | Existing Silver artist MBIDs are used for direct lookup. |
| Cache | Stored response reused later | Hashed raw provider JSON under `data/enrichment/raw`. |
| Rate limiting | Restricting request frequency | MusicBrainz interval is one second. |
| Retry | Trying a transient failure again | Last.fm transient HTTP/API failures are bounded retries. |
| Exponential backoff | Increasing retry delay | 1, 2, 4, 8, 16 seconds in ingestion. |
| Checkpoint | Durable partial progress | Bronze run metadata and enrichment checkpoints. |
| Resume | Continue incomplete work | `--backfill --resume` and enrichment reruns. |
| Long tail | Many low-frequency entities | 67.575% artist coverage but 88.860% event coverage. |
| Entity coverage | Fraction of entities enriched | Resolved artists divided by 4,956 artists. |
| Event-weighted coverage | Fraction of events tied to enriched entities | Silver scrobble share represented by resolved artists. |

## 9. Tests and protected failure scenarios

Tests are grouped by responsibility:

- Ingestion tests cover configuration validation, endpoint/request shape,
  redaction, HTTP/API errors, transient retry, one-run-ID page storage,
  metadata state and resume selection.
- Silver tests cover page discovery, now-playing exclusion, malformed-record
  rejection, deterministic IDs, deduplication, schema, metadata and
  full/incremental idempotency.
- Gold tests cover mart grains, tracking eras, streaks, conservation and
  deterministic output behavior.
- Enrichment tests cover cache identity, safe storage, ambiguous candidates,
  User-Agent/rate waiting, normalized output reuse and tag deduplication.

The complete local suite currently reports 30 passed and one warning from the
global Python `requests`/dependency environment. Tests mock HTTP and do not
call Last.fm, MusicBrainz or Last.fm tags.

### Failure behavior

- HTTP 500 from Last.fm: transient statuses are retried with bounded
  exponential backoff; exhaustion becomes a safe `LastFMHTTPError` and the run
  is marked failed.
- Last.fm rate limiting: HTTP 429 is retried; request secrets and URLs are not
  included in logs or exceptions.
- Backfill stopped halfway: metadata remains failed/running and resume reuses
  the run directory, saved pages and expected page count.
- Same ingestion run twice: separate Bronze executions are allowed; Silver
  event IDs remove overlapping event representations.
- Duplicated Bronze events: deterministic event IDs collapse them in Silver;
  Bronze itself remains auditable.
- MusicBrainz artist not found: the entity receives `not_found` and does not
  stop the complete enrichment run.
- Multiple MusicBrainz candidates: the entity remains `ambiguous` unless the
  conservative resolver has a unique acceptable match.
- MusicBrainz temporarily unavailable: the entity is recorded as `error`, raw
  error state is safe, and a later normal run can retry it.
- Enrichment stopped after 2,000 artists: normalized checkpoints and raw cache
  preserve progress; a later run skips successful work and continues.

## 10. Interview walkthrough

### 30-second explanation

This is a local Last.fm data platform built in Python. It preserves paginated
API responses in Bronze, converts them into deduplicated UTC Silver scrobbles,
builds deterministic Gold listening marts, and enriches unique artists through
MusicBrainz and Last.fm tags. The design emphasizes raw-data auditability,
idempotency, safe retries and explicit limitations around incomplete tracking
before 2020.

### 2-minute explanation

Last.fm is a paginated external source, so each ingestion execution gets one
run ID and immutable JSON pages with run metadata. Backfills can retry transient
provider failures and resume missing pages. Silver reads only completed
metadata-backed runs, excludes now-playing records, validates required fields,
creates a SHA-256 event identity and deduplicates overlaps. Gold is rebuilt from
Silver into time, artist, track, discovery, pattern and streak marts, with
conservation checks back to Silver. Artist enrichment is entity-first and
separate from the trusted event layer; direct MBIDs are preferred, name
matches remain conservative and provider responses are cached. The local data
has 116,871 events, but pre-2020 tracking is partial and 2026 is an incomplete
calendar year, so recorded activity is not presented as total consumption.

### 5-minute technical explanation

The pipeline has explicit contracts at each boundary. Bronze uses a REST
client with safe request diagnostics and bounded retries, and its metadata
defines whether a run is authoritative. Silver's grain is one completed
scrobble; its identity deliberately excludes unreliable MBIDs and uses the
canonical user/artist/track/timestamp tuple. This handles page and run overlap
while preserving first-source lineage. Optional provider fields become nulls,
bad source records are quarantined, timestamps become UTC, and atomic Parquet
and metadata writes make a rerun safe.

Gold prepares UTC calendar fields and a configured 2020 boundary, then builds
small deterministic pandas marts. It checks event conservation and metric
invariants. Enrichment operates at the 4,956-entity level, not the 116,871-event
level. MusicBrainz is rate-limited at one request per second and uses raw hashed
cache entries. Resolution states are explicit, and event-weighted coverage is
reported alongside entity coverage to show the long tail. For production, I
would add orchestration, object storage, secret management, monitoring and
possibly distributed processing only if measured scale justified them; none of
those claims apply to this local implementation.

Phase 5 adds a separate Gold Enriched product and local Streamlit consumer. Its
canonical event timestamp remains UTC, while `time_patterns` derives local
calendar fields from the explicit historical periods in
`config/timezone_periods.json`: Argentina uses `America/Argentina/Cordoba`,
France uses `Europe/Paris`, and the France period is interpreted as
2026-01-28 through 2026-06-24 inclusive. Exact travel times are unknown, so
this is a documented historical interpretation rather than a claim of exact
physical location. The main dashboard temporal view uses consistent tracking
from 2020 onward and a 24-hour local-time heatmap.

## 11. Interview questions and grounded answers

1. **Why preserve Bronze?** It preserves source evidence and enables repeatable
   transformations after an API response changes.
2. **Why Parquet instead of CSV?** Silver/Gold are typed analytical tables and
   Parquet is columnar, compact and supported by pandas/pyarrow.
3. **What is the Silver grain?** One completed Last.fm scrobble after event-key
   deduplication.
4. **What makes the event ID deterministic?** The canonical tuple is hashed
   with SHA-256, so the same source event produces the same ID.
5. **Why use a watermark?** Incremental ingestion avoids requesting history
   before the latest completed timestamp.
6. **Why implement resume?** A hundreds-page backfill should not lose durable
   progress after one transient failure.
7. **What does run metadata provide?** It tells discovery whether a run is
   complete and which pages are authoritative.
8. **Why exclude now-playing from Silver?** It is not a completed scrobble and
   has no reliable event timestamp for the history model.
9. **Why UTC?** Last.fm provides a Unix timestamp; UTC is deterministic without
   inventing historical local timezone information.
10. **Why not treat missing days as zero?** No recorded event is not proof of no
    listening, especially with incomplete tracking.
11. **Why is 2020 a boundary?** The real distribution shows a reliable tracking
    era from 2020; it is a data-coverage boundary, not a behavioral claim.
12. **Why not interpret 2017–2019 as zero consumption?** The source was not
    consistently tracked then.
13. **Why not call MusicBrainz once per scrobble?** Artists are entities shared
    across events, so entity-first enrichment reduces requests and ambiguity.
14. **Why is entity coverage lower than event coverage?** Unresolved artists
    are concentrated in the low-frequency long tail.
15. **Why are ambiguous matches retained?** A false positive is worse than an
    explicit unresolved entity for analytical trust.
16. **Why keep enrichment outside Silver?** Provider metadata is mutable and
    uncertain; Silver remains an auditable event layer.
17. **How is MusicBrainz rate limiting enforced?** The client waits at least one
    second between actual requests and uses a meaningful User-Agent.
18. **How does enrichment resume?** Successful raw cache and normalized rows
    are reused; checkpoints are written every ten artists.
19. **What happens after HTTP 500?** Ingestion retries bounded transient
    failures with exponential backoff, then marks the run failed if exhausted.
20. **What happens with duplicate Bronze pages?** Silver's deterministic event
    ID removes duplicate representations while retaining Bronze.
21. **Why no Spark?** The current workload is local and dominated by external
    API latency, not distributed computation.
22. **Why no Kafka?** The source is batch pagination, not a live event stream.
23. **What would change in production?** Object storage, orchestration,
    centralized observability, secret management and stronger deployment tests.
24. **How would cloud evolution work?** Move immutable data to object storage or
    OneLake, add a lakehouse and orchestration, and introduce Spark only for a
    measured workload need.
25. **What is the current data volume?** 116,871 Silver events, not a claim of
    big-data scale.
26. **What is a current-year caveat?** 2026 is incomplete, so its count cannot
    be compared with complete prior years as a full-year measure.
27. **What does Gold validate?** Daily/yearly conservation, nonnegative counts,
    valid eras/calendar values and bounded concentration shares.
28. **What happens when a MusicBrainz lookup fails?** The artist is marked
    `error` and a later normal run can retry the cached failure.
29. **Why retain Last.fm raw tag text?** Community labels are source data; the
    pipeline normalizes conservatively without pretending to create an official
    genre taxonomy.
30. **What is not implemented?** No dashboard, track enrichment, mood
    inference, cloud, Spark, Airflow or Phase 6 functionality.

## 12. Current limitations

- Execution and storage are local; generated Bronze, Silver, Gold and
  enrichment data are intentionally ignored by Git.
- There is no production orchestrator, scheduler, alerting system or cloud
  deployment.
- The transformations are pandas-based and not distributed.
- Gold Phase 3 calendar marts remain UTC-based; Gold Enriched additionally
  derives historical local-time fields from the versioned timezone periods.
- Tracking before 2020 is intermittent; 2017–2019 absence is not zero
  consumption.
- Calendar year 2026 is incomplete in the current local snapshot.
- MusicBrainz matching is imperfect: the full run contains ambiguous,
  not-found and persistent-error states.
- Last.fm tags are community-generated and should not be treated as an
  authoritative taxonomy.
- The dashboard is a local Streamlit consumer, not a deployed production BI
  layer.

## 13. Future architecture (not implemented)

```text
Current local files
        |
        v
Cloud object storage / OneLake
        |
        v
Lakehouse / Delta tables
        |
        v
Orchestration and observability
        |
        v
BI or dashboard consumers
```

This is future architecture only. It is not a description of the current
repository and should not be confused with implemented Phase 5 or Phase 6
work.
