# Recent listening data contract for fm.

## Scope

The frontend is being redesigned around **what I listened to lately**. Please add a compact recent analytics export to the existing cloud pipeline after the architecture work is complete. Do not change `stats.json` or `insights.json` v1 without a separately reviewed migration. Produce a new public `/data/recent.json` as part of the same verified Cloudflare Pages deployment.

The site is an audio diary, not a Spotify Wrapped clone. UI strings are short, lowercase Spanish, first person where appropriate. Facts and numbers must be computed from scrobbles, never invented by an LLM.

## Required JSON (v1)

```json
{
  "schema_version": 1,
  "generated_at": "2026-11-25T22:00:00Z",
  "data_as_of": "2026-11-25T21:55:00Z",
  "timezone": "America/Argentina/Cordoba",
  "periods": {
    "today": {
      "start": "2026-11-25",
      "end_exclusive": "2026-11-26",
      "complete": false,
      "scrobbles": 0,
      "unique_artists": 0,
      "unique_tracks": 0,
      "top_artists": [{"name": "example", "scrobbles": 0}],
      "top_albums": [{"artist": "example", "title": "example", "scrobbles": 0, "cover": null}],
      "top_tracks": [{"artist": "example", "title": "example", "scrobbles": 0}]
    },
    "this_week": {},
    "last_week": {},
    "this_month": {},
    "last_month": {}
  },
  "series": {
    "days": [{"date": "2026-11-25", "scrobbles": 0, "complete": false}],
    "weeks": [{"start": "2026-11-23", "scrobbles": 0, "complete": false}],
    "months": [{"month": "2026-11", "scrobbles": 0, "complete": false}]
  }
}
```

The example contains placeholders for field names and types **only**. Never export literal `example` records, fictitious names or invented statistics. When a period has no plays, use zero counts and empty top lists. When source data is unavailable or tracking coverage is unknown, expose an explicit `coverage` or `status` marker rather than treating missing data as a real zero.

### Exact requirements

- Every period object has `start` and `end_exclusive` as local calendar dates, `complete`, `scrobbles`, `unique_artists`, `unique_tracks`, `top_artists`, `top_albums`, and `top_tracks`. Use the *same* shape for all five periods; the empty objects above indicate repetition of the schema, not permissible output.
- `today` = today in `America/Argentina/Cordoba`; `this_week` starts Monday 00:00; `this_month` starts on the 1st. `last_week` and `last_month` are *completed* calendar periods. Current windows are marked `complete: false` until they really finish.
- `series.days` = last 14 calendar days including today; `series.weeks` = last 12 calendar weeks including the current week; `series.months` = last 12 calendar months including the current month. Ascending chronological order; fill zero only inside known, covered tracking periods.
- Count scrobbles, not necessarily unique songs or minutes. Do **not** derive listening minutes or genre/language from play counts; only show such metrics when properly sourced.
- Use *committed* Silver/Gold snapshots pinned by the existing checkpoint. Dedup according to the existing Silver contract. Convert event timestamps to the agreed local timezone before bucketing, and document DST/offset boundaries. The date/time handling of historical French listening must remain honest and must not silently change existing historical insights.
- `top_artists`, `top_albums`, `top_tracks` are ranked by actual scrobble count within their period (at most five entries each), with deterministic tie-breaking. Reuse already reviewed artwork metadata; no unvalidated image URLs or new requests per page view.
- If a new/returning artist insight is added, calculate it from the recorded history and label it `based on recorded listens`; 2017–2019 were not tracked and must NOT be interpreted as listening inactivity.
- If percentage change is shown, compare like-for-like durations (e.g. elapsed portion of this week against the same duration last week). Prefer omission over a misleading full previous week vs incomplete current week comparison; use null for undefined denominators.
- Preserve the existing private ADLS storage model, SHA-256 validation, Azure OIDC, checkpoint/lease semantics, and daily ingest cron. Never publish raw event-level scrobbles, checkpoints, Parquet or secrets.
- Add unit tests for local midnight, week and month boundaries, missing versus true-zero data, tie-breaking, incomplete periods, snapshots, and empty periods. Export and deploy `recent.json` together with `stats.json` and `insights.json` as one consistent release.

## Frontend tasks after export exists

1. Read `/data/recent.json` with typed validation and graceful unavailable/loading states.
2. Replace the current "últimamente" total and 12-month chart with a selector **hoy / semana / mes** using the corresponding real period counts and top artists/albums/tracks; expose a clear partial-period label.
3. Add small, readable bar/line plots for days/weeks/months (zero baseline; avoid rainbow palettes). The historical weekday chart is **historical**, not a claim about this week.
4. Keep the archive of previous years below recent listening in the interactive year selector. Do not add endless full-history lists.
5. Keep phrases short, personal, lowercase, and grounded in data. Don't use chatbot-sounding taglines. No mock data in production.
6. Test mobile layouts and use accessible chart labels and reduced-motion behavior.

## Ownership

The architecture session owns cloud snapshot export and the `recent.json` producer. The frontend session owns React, CSS, visualization and frontend loader. Avoid simultaneous edits to the same files. No additional infrastructure, direct browser access to Azure, or per-visitor LLM call is needed.
