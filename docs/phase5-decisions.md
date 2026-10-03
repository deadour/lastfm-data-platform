# Phase 5 decisions

Phase 5 adds a separate local analytical product under `data/gold_enriched/`
and a Streamlit consumer under `dashboard/`. Bronze, Silver, Phase 3 Gold,
raw enrichment cache and normalized Phase 4 outputs are read-only inputs.
Generated enriched Parquet, metadata and insights remain ignored by Git.

## Join strategy and cardinality

Silver artist names are converted with the same deterministic `artist_key`
function used by Phase 4. The artist profile table is unique on `artist_key`,
so the event-to-profile bridge is many-to-one. On the real data:

```text
Silver events before join: 116,871
events after artist join: 116,871
matched events: 116,871
unmatched events: 0
```

Tags are intentionally not joined into the event fact. The artist-tag input is
one-to-many and would produce 1,059,727 rows if all tags were attached to
events. Phase 5 keeps tag associations separate and uses them only to create
weighted artist/genre aggregates. The top-five working association contains
542,039 rows; no scrobble count is summed from that multiplied table.

The build uses pandas `validate="many_to_one"` for the artist bridge and
explicitly records both join cardinalities in enriched metadata.

## Tag taxonomy

`config/tag_taxonomy.json` is a deliberately small, explicit mapping. It has
the categories `genre_style`, `geography`, `era`, `descriptor`, `noise` and
`other`, with genre families such as rock, pop, hip-hop, electronic, metal,
punk, folk, jazz, classical, latin, reggae, r&b, country and blues. The lists
were chosen after profiling the real 4,196 normalized tags; unknown tags remain
`other` rather than being guessed by a model.

Raw `tag` and normalized `tag_normalized` values remain in the Phase 4 output.
The taxonomy is our analytical interpretation and does not replace Last.fm
source labels. Tags such as `sad`, `happy`, `melancholic` and `energetic` are
music descriptors only; no user mood or psychological state is inferred.

## Tag weighting

For each artist, only the five highest-ranked provider tags are used in the
analytical association. A tag receives `1 / tag_rank`, then all selected tag
weights for that artist are normalized to sum to one. Genre contribution is:

```text
artist scrobbles × normalized tag weight
```

Genre shares are normalized across genre-family contributions within each
year/era, while `genre_tag_coverage` reports weighted genre contribution as a
fraction of recorded events. This keeps multi-tag artists interpretable and
prevents ten tags from becoming ten complete scrobbles.

## New mart grains

| Mart | Grain | Real rows | Purpose |
|---|---|---:|---|
| `artist_profile` | one artist entity | 4,956 | artist metadata, totals, activity span, primary tag/family |
| `genre_evolution` | year + tracking era + genre family | 110 | weighted style contribution and share |
| `artist_evolution` | year + tracking era + artist | 9,600 | scrobbles, share, rank, first-seen age and lifecycle |
| `concentration` | year + tracking era | 8 | top 1/5/10/25/50 shares and HHI |
| `diversity` | year + tracking era | 8 | unique entities and entities per 100 scrobbles |
| `discovery_enriched` | year + tracking era | 8 | new artists/tracks and share from new artists |
| `geography_evolution` | year + tracking era + provider country | 355 | event volume and share where country metadata exists |
| `time_patterns` | year + month + era + UTC weekday + UTC hour | 8,862 | prepared dashboard time data |
| `era_comparison` | year + tracking era | 8 | annual rates, year-over-year context and completeness flag |

Existing Phase 3 marts remain the source for base listening calculations;
Phase 5 adds only metrics that combine events with enrichment or extend those
metrics for consumption.

## Lifecycle definitions

`artist_evolution.lifecycle` is deterministic and mutually prioritized:

1. `new`: first recorded appearance is the current year;
2. `resurgent`: the artist returns after at least two full calendar years
   without a recorded appearance;
3. `persistent`: the artist appears in the current and preceding two calendar
   years;
4. `returning`: previously seen but not one of the above.

These labels describe recorded artist presence, not a subjective phase of the
listener's life. The real output contains 4,956 new artist-year rows, 2,167
persistent rows, 2,091 returning rows and 386 resurgent rows.

## Concentration and diversity

Concentration is measured by the share of recorded scrobbles belonging to the
top 1, 5, 10, 25 and 50 artists for each year/era. HHI is also included:

```text
HHI = sum((artist scrobbles / year scrobbles)²)
```

Higher HHI means more concentration. Diversity is intentionally transparent:
unique artists, unique tracks, artists per 100 scrobbles and tracks per 100
scrobbles. These are musical listening metrics, not personality or openness
scores.

## Coverage and real-data validation

The local build analyzed 116,871 events and 4,956 artists. It found:

```text
tagged-event coverage: 95.024%
genre-family event coverage: 90.767%
geographic event coverage: 82.563%
partial-tracking events: 999
consistent-tracking events: 115,872
```

Country is a MusicBrainz provider field, not a claim about nationality. Unknown
country remains explicit. The 2020-01-01 tracking boundary is preserved in all
new marts. Calendar year 2026 is marked `partial_calendar_year=true`; its raw
volume is not compared as if it were a complete year.

## Real findings

These are aggregate recorded-data findings, not claims about total consumption
or personal psychology:

- Rock is the largest weighted genre family in every consistent-tracking year;
  its within-classified-genre share is about 34.3% in 2023 and 53.1% in 2025.
- The 2020 discovery share is 59.6% of recorded scrobbles from artists first
  observed that year, consistent with the beginning of the reliable tracking
  period rather than proof of a sudden complete change in taste.
- New-artist share falls to 8.3% in 2021, then is 12.8% in 2022 and 13.7% in
  2023; these are observed re-entry/discovery patterns in the available data.
- Top-1 artist concentration ranges from 4.8% in 2023 to 13.4% in 2025 among
  complete consistent years. The 2016 value, 22.0%, belongs to partial tracking.
- Artists per 100 recorded scrobbles rise from 5.8 in 2021 to 10.1 in 2025.
  2026 is 11.8 so far, but that calendar year is incomplete.
- Known-country coverage is 82.563% of events. Argentina represents 31,539
  recorded events and the United States 24,750; unresolved/unknown metadata is
  not assigned to a country.
- The all-time leading recorded artists are Los Piojos, Patricio Rey y sus
  Redonditos de Ricota and The Strokes. This is a ranking of the local recorded
  dataset, not a statement about all listening.

## Dashboard architecture and privacy

`dashboard/app.py` only reads prepared Parquet and metadata from
`data/gold_enriched/`. It does not call APIs, read `.env`, recalculate the
pipeline or require raw Bronze/Silver/cache files. The views are:

- Overview: recorded totals, year activity and top artists;
- Taste evolution: weighted genre families and artist evolution;
- Discovery & loyalty: new artists/tracks, concentration, diversity and
  lifecycle rows;
- Patterns & geography: UTC time heatmap and provider-country coverage;
- Methodology: source, weighting, tracking and interpretation caveats.

Run locally with:

```text
python -m src.analytics.build_enriched --profile
streamlit run dashboard/app.py
```

The dashboard was smoke-tested on the real local outputs with Streamlit's
testing API (zero app exceptions) and a localhost HTTP request returning 200.
No public deployment is part of Phase 5. The generated personal aggregates,
raw data, caches and `.env` are ignored and are not committed.

## Scope decisions

Phase 5 does not add cloud services, Spark, Airflow/Prefect/Dagster, a database,
React/Django, ML mood classification or Phase 6 functionality. The local
116k-event scale and provider-latency-bound enrichment do not justify those
components yet.
