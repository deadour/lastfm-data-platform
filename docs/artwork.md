# Album artwork and frontend export

A separate, manual process that adds album covers for the future frontend. It
reads Silver and Gold and writes its own files only. Checkpoints, the daily
workflow, `cloud_run` and the existing layers are untouched.

## What the data already had (audit, local Silver of 2026-10-02)

| Layer | Album / visual data |
| --- | --- |
| Bronze | Raw Last.fm pages, including `image` URLs (small…extralarge). In a 50-page sample: 8 711 real, 1 043 empty, 246 Last.fm placeholder. Last.fm images are a hint only, not a licensed source, so they are not used. |
| Silver | `album_name` on 96.1 % of 116 871 scrobbles and `album_mbid` on 56.9 %. 9 075 distinct (artist, album) pairs as written; 3 833 have an MBID; none has two. No image columns. |
| Gold | No album mart (artist, track, calendar, discovery, patterns, streaks only). |
| Enrichment | Artist-level MusicBrainz identities and Last.fm tags; nothing per album. |

Play counts are concentrated: the top 100 albums are 39.9 % of album
scrobbles, the top 500 are 68.3 % and the top 1 000 are 79.7 %. A few hundred
lookups cover most of what a frontend shows.

## How covers are resolved

```powershell
python -m src.artwork.enrich --limit 100 --dry-run   # what would be queried, no network
python -m src.artwork.enrich --limit 100
python -m src.artwork.enrich --accept <album_key>    # confirm a needs_review match
python -m src.artwork.enrich --reject <album_key>
```

Albums are keyed by normalized artist + title, so case, accents, a leading "the",
`&` and edition suffixes like "(remastered 2015)" or "[deluxe edition]" collapse
into one key. They are processed most-played first. For each album:

1. **Cover Art Archive, release.** Uses the Last.fm `album_mbid` and picks the
   approved front image (500 px thumbnail). Confidence 1.0.
2. **Cover Art Archive, release-group.** If the release has no front image,
   MusicBrainz gives its release-group and that group's front is used.
   Confidence 0.95.
3. **Deezer search** (no key), when there is no MBID or no CAA image. The match
   score is `min(artist similarity, title similarity)`.
   - **resolved:** both names equal after normalization, and no other distinct
     title by the same artist is a close rival.
   - **needs_review:** a close but inexact match, or competing releases such as
     a deluxe box next to the original. Never accepted automatically.
   - **not_found:** nothing close enough.

`--accept` and `--reject` are the only way a `needs_review` row changes. The
export only uses `resolved` rows.

## Catalog

The catalog lives in `data/artwork/catalog.parquet` and `catalog.json`, one row
per album, and is ignored by Git.

| Column | Meaning |
| --- | --- |
| `album_key` | stable id (24 hex chars) |
| `artist_name`, `album_name`, `scrobbles` | most common spelling in Silver and its play count |
| `album_mbid`, `release_group_mbid` | MusicBrainz ids when known |
| `status` | `resolved`, `needs_review`, `not_found`, `rejected` |
| `provider`, `provider_id`, `image_url`, `source_url` | where the image URL came from, and the page to link back to |
| `match_confidence`, `match_reason` | why it was accepted or held |
| `license_note` | attribution rule for that provider |
| `checked_at`, `updated_at` | UTC timestamps |

**Incremental.** `resolved`, `needs_review` and `rejected` albums are never
queried again. `not_found` is retried after `--retry-days` (default 30). Raising
`--limit` only adds new albums.

**Crash-safe.** The catalog is saved every 20 albums. If a provider keeps
failing, the run stops, keeps what it resolved and exits 1.

## Rate limits, licenses, cost

- **Rate limits.**
  - MusicBrainz and Cover Art Archive: one request per second, with the
    project's User-Agent from `config/enrichment.json`, as MusicBrainz requires.
  - Deezer: one request per 0.5 s, well under its documented 50 per 5 s.
  - 429 and 5xx (plus Deezer's quota error) are retried with backoff and
    `Retry-After`. MusicBrainz 503s are retried too.
- **Cost.** One album takes 1 to 3 requests. The top 500 take roughly 10–25
  minutes and cost nothing; no infrastructure is involved.
- **Licenses.** Only URLs are stored; images are not downloaded or rehosted.
  - **Cover Art Archive:** the images are user-uploaded scans whose copyright
    stays with the rights holders. Show them small, as album identification,
    and link to the MusicBrainz release (`source_url`).
  - **Deezer:** API terms require attribution and a link to the Deezer page,
    and do not grant redistribution of the files.
  - Hotlinking means a cover can disappear if the provider removes it.

## Frontend export

```powershell
python -m src.artwork.export_frontend --out data/exports/frontend/stats.json
```

The export is one minified JSON (about 25 KB with the full history) meant to be
copied into the frontend as a static asset. It never reads the data lake. It
contains no username, API key, storage account or path. Gold has no album mart,
so album play counts are computed from Silver.

```text
schema_version: 1, source: "gold", generated_at, data_as_of, notes{tracking, albums}
range{first_day, last_day}
totals{scrobbles, artists, tracks, albums, active_days}
years[]       {year, scrobbles, active_days, artists, tracks, top_artist, era}
months[]      {month "YYYY-MM", scrobbles}          last 24
top_artists[] {name, scrobbles, first_seen, last_seen}
top_albums[]  {key, artist, title, scrobbles, cover: null | {url, provider, source_url, attribution}}
top_tracks[]  {artist, title, scrobbles, peak_year}
week_hours[]  {weekday 0=monday, hour, scrobbles}
```

`top_*` hold 50 items (`--top`). `cover` is `null` until an album is resolved, so
the UI needs a placeholder.

## Not done yet

- Not scheduled or wired into the cloud job. Run it locally; the cloud Silver is
  newer than the local copy (118 343 vs 116 871 rows).
- No artist images. Neither CAA nor Gold has them, and Deezer artist photos need
  the same review rules.
- `needs_review` items are handled by hand.
