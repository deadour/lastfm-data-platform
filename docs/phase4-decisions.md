# Phase 4 decisions

Phase 4 adds a separate, cache-first enrichment layer. Bronze and Silver remain
unchanged; normalized enrichment is joined to listening data only when needed.

## Scope

This phase implements artist enrichment only:

- MusicBrainz artist identity and descriptive fields;
- Last.fm `artist.getTopTags`, retaining raw and conservatively normalized tags;
- no track enrichment, mood inference, taxonomy, dashboard, cloud, Spark, or Phase 5 work.

## Identity and matching

Artists are extracted from the real Silver dataset and assigned a deterministic
SHA-256 `artist_key` based on Unicode-normalized, whitespace-collapsed source
name. Case is preserved in the key so distinct Silver source names are not
silently merged. MusicBrainz matching itself is case-insensitive and conservative:
existing MBIDs are looked up directly first, followed by exact-name or high-score
search matches. Ambiguous and not-found entities remain explicit and do not fail
the run.

## Provider and cache policy

MusicBrainz requests use a meaningful configurable User-Agent and a one-second
minimum interval between requests. Provider responses are cached under
`data/enrichment/raw/` using hashed request identities; normalized outputs are
`artists.parquet` and `artist_tags.parquet`. Successful cache entries are reused,
while previous error entries are retryable in normal mode. `--from-cache` is an
offline rebuild mode. Checkpoints are written every ten artists.

## Real-data validation

The pilots were run against the local Silver data before the full run:

| evaluated artists | resolved | ambiguous | not found | MB event coverage | tagged |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 9 | 1 | 0 | 92.125% | 10 |
| 50 | 47 | 3 | 0 | 93.369% | 50 |
| 100 | 93 | 5 | 2 | 92.973% | 99 |

The completed full run produced 4,956 artist rows and 31,054 tag rows. Its
resolution result was 3,349 resolved, 287 ambiguous, 1,316 not-found, and 4
persistent provider errors. MusicBrainz coverage was 67.575% by artist and
88.860% event-weighted. Last.fm tags covered 3,654 artists (73.729%) and
95.024% of events, with 4,196 unique raw and normalized tags. These values are
also recorded in the generated metadata file.
The low pre-2020 Silver volume remains a tracking-coverage limitation; these
enrichment metrics describe recorded scrobbles and must not be interpreted as
historical music-consumption estimates.

## Track-enrichment gate

Track enrichment was not started. Phase 4 stops after artist enrichment and the
decision gate is documented in the final run metadata and handoff; no Phase 5
work is included.
