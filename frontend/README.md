# fm.eduramirez.dev

Static site (React + Vite + TypeScript + Tailwind) with one Cloudflare Pages
Function for "now playing". It lives next to the Python pipeline but does not
import it or touch its state.

```text
gold parquet ──(gold → json export, run by hand)──▶ public/data/stats.json ──▶ static site
last.fm api ◀──(functions/api/now-playing.ts, 30 s edge cache)── browser polls /api/now-playing
```

The browser never talks to Azure or Last.fm directly. The data lake stays
private; the Last.fm key is a Pages secret.

## Local

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, mock stats + mock now playing
npm test           # vitest: loader, formatting, now-playing function
npm run build      # typecheck + production build into dist/
```

Without `public/data/stats.json` the site shows invented data and a visible
"datos de ejemplo (mock)" notice. Real numbers come from the Gold → JSON
export with album artwork (`python -m src.artwork.export_frontend`, branch
`feature/artwork-enrichment`). Copy its output to `public/data/stats.json`.

The file is git-ignored on purpose. It holds only aggregates (yearly counts,
top artists, albums and tracks, a weekday × hour grid). It is still your listening
history, and it becomes public the moment it is deployed. Publish it on
purpose: commit it, or use a direct upload (below).

To try the real function locally, put the secrets in `frontend/.dev.vars`
(ignored) and run `npx wrangler pages dev -- npm run dev`.

## Stats contract

`src/data/types.ts` (`StatsFile`, `schema_version: 1`) is shared with the
exporter (`python -m src.artwork.export_frontend`). The required fields are:
- `range{first,last}`, `totals`;
- `years` with `partial`, `months` (last 24);
- `top_artists` and `top_tracks`;
- `rhythm` (168 weekday × hour shares);
- `longest_streak`.

The exporter also sends `data_as_of`, `totals.albums` and `top_albums`. The
loader rejects other versions or missing lists and falls back to the mock.

Covers:
- `top_tracks[].image` and `top_albums[].cover` stay `null` until the album is
  resolved in the artwork catalog. Until then the site shows a gradient made
  from the title.
- A real album cover is always shown with its `attribution`, linked to
  `source_url` (the MusicBrainz release or the Deezer page).
- Images are hotlinked, never rehosted. The CSP allows `coverartarchive.org`,
  `archive.org`, `*.archive.org` (CAA redirects there), `cdn-images.dzcdn.net`
  and `e-cdns-images.dzcdn.net`.

## Now playing

`GET /api/now-playing` calls `user.getRecentTracks&limit=1`.

- **Response.** Only title, artist, album, image, track URL and the timestamp
  of the last finished scrobble.
- **Caching.** The response is stored in the Cache API for 30 s
  (`s-maxage=30`; browsers get `max-age=15`). Errors are cached for 10 s.
  Last.fm therefore sees at most a couple of requests per minute per edge
  location.
- **Failures.** The upstream URL and error are never returned, because the URL
  contains the key.
- **Polling.** The page polls every 30 s only while the tab is visible.

## Deploy on Cloudflare Pages (free plan)

Nothing here has been created yet. These steps are for the owner.

1. Workers & Pages → Create → Pages → connect `deadour/lastfm-data-platform`.
2. Build settings:
   - production branch `main`;
   - root directory `frontend`;
   - build command `npm run build`;
   - output `dist`;
   - Node 22 (read from `.node-version`).
3. Settings → Variables and secrets → add **secrets** `LASTFM_API_KEY` and
   `LASTFM_USERNAME` for Production (and Preview if wanted).
4. Custom domains → add `fm.eduramirez.dev`.
   - `eduramirez.dev` is already on Cloudflare DNS (nameservers
     `boyd`/`lila.ns.cloudflare.com`), so Pages offers to create the
     `fm` CNAME itself.
   - Today `fm.eduramirez.dev` has no record. Check that before confirming,
     and do not edit the apex or `www` records.
5. Optional: Pages builds every push to `main`, including pipeline-only changes.
   To skip those, set a build watch path of `frontend/*`.

**Direct upload instead of git builds** (keeps `stats.json` out of git):

```bash
# after writing frontend/public/data/stats.json with the gold export
cd frontend && npm run build && npx wrangler pages deploy dist --project-name fm-eduramirez-dev
```

**Free-plan limits as of this writing:**
- 500 builds per month;
- 100 000 Function requests per day, which the cache keeps us far below;
- static requests unmetered.

No paid feature is used. `public/_headers` sets a strict CSP; `img-src` allows
Last.fm's image CDN only.
