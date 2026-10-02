# Phase 3 Gold Decisions

## Gold purpose and grains

Gold contains analytical marts derived from trusted Silver events:

- `listening_daily`: one row per date with recorded scrobble activity.
- `listening_monthly`: one row per year-month.
- `listening_yearly`: one row per year with activity, discovery, concentration, and diversity metrics.
- `artist_stats`: one row per artist-year, with all-time persistence fields repeated for convenient analysis.
- `track_stats`: one row per artist-track pair.
- `discovery`: one row per year with first-observed artist/track metrics.
- `listening_patterns`: one row per tracking era, UTC weekday, and UTC hour.
- `listening_patterns/streaks`: one row per recorded consecutive-date streak since the reliable period boundary.

Days without recorded scrobbles are not materialized as zero rows. A missing day means no event was recorded, not proof that no music was heard.

## Tracking coverage

The operational boundary is `2020-01-01`, configured in `config/analytics.json`. Events before that date are `partial_tracking`; events on or after it are `consistent_tracking`.

The real Silver distribution supports this as a useful classification: 2016 contains a small partial sample, 2017–2019 contain no recorded events, and recorded activity increases substantially from 2020. This does not establish that no listening occurred in the missing years. Pre-2020 counts must not be compared with post-2020 counts as equivalent measures of consumption.

## UTC limitation

All temporal Gold metrics use the UTC timestamp from Silver. Weekdays and hours are UTC-based and are not claims about local clock behavior. Historical timezone enrichment is outside Phase 3.

## Discovery definitions

`newly_observed_artists` and `newly_observed_tracks` count entities whose first appearance in the available Silver dataset occurs in that year. They do not mean the first time the user ever heard an artist or track, especially because pre-2020 tracking is incomplete.

## Streak definition

A recorded streak is a sequence of consecutive calendar dates with at least one completed Silver scrobble. Streaks are calculated only from `consistent_tracking` dates. A broken streak means no scrobble was recorded that day; it does not prove that no listening occurred.

## Concentration and diversity

Yearly concentration is represented transparently by the share of recorded scrobbles belonging to the top 1, 5, and 10 artists. Diversity uses unique artists, unique tracks, and scrobbles per unique artist. No proprietary score or psychological interpretation is introduced.

## Rebuild strategy

Gold is rebuilt deterministically from the current Silver Parquet because the dataset is approximately 117k rows and the aggregations are inexpensive. `build_gold` accepts both the default command and `--full`; both perform a complete rebuild. Outputs are staged, validated, and then replaced, with metadata written last.

## Storage and metadata

Gold uses one Parquet file per mart family under `data/gold/` plus `data/gold/_metadata.json`. The streak companion lives under `listening_patterns/`. Generated personal data is ignored by Git.

## Known limitations

- Pre-2020 tracking is incomplete and cannot support equivalent longitudinal volume comparisons.
- UTC is not historical local time.
- First observed is not first ever listened.
- No external metadata enrichment, mood inference, dashboards, cloud, Spark, or machine learning is implemented.
