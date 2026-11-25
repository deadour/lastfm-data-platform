# fm.eduramirez.dev

Static site (React + Vite + TypeScript + Tailwind) with one Cloudflare Pages
Function for "now playing". It lives next to the Python pipeline but does not
import it or touch its state.

```text
Azure Gold + Silver ──(Actions, OIDC)──▶ public/data/stats.json ──▶ complete Vite dist ──▶ existing Pages project
last.fm api ◀──(functions/api/now-playing.ts, 30 s edge cache)── browser polls /api/now-playing
```

The browser never talks to Azure or Last.fm directly. The data lake stays
private; the Last.fm key is a Pages secret.

## Local

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173; unpublished until real stats are supplied
npm test           # vitest: loader, formatting, now-playing function
npm run build      # typecheck + production build into dist/
```

Without valid Gold `public/data/stats.json`, the site shows its editorial
unpublished state. Production never substitutes fictional artists or now-playing
data. `src/data/mock.ts` is a test fixture, not imported by the application.
The production path is [cloud export via Actions](../docs/frontend-cloud-export.md):
the runner reads committed Azure snapshots and puts the validated file into the
complete build. There is no manual JSON-copying step in production.

The file is git-ignored on purpose. It holds only aggregates (yearly counts,
top artists, albums and tracks, a weekday × hour grid). It is still your listening
history, and it becomes public the moment it is deployed. Actions intentionally
publishes only these aggregates, without committing generated listening data.

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
loader rejects mock sources, unknown versions, malformed nested fields, private
fields and unsafe URLs. The same contract guards artifact upload and deployment;
rejected data produces an unavailable state.

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

## Existing Cloudflare Pages project

The existing project is **`lastfm-data-platform`**, serving
**`fm.eduramirez.dev`**. Do not create a replacement project or change DNS or
custom-domain settings. Its current Git production branch is `feature/frontend`.
The safe transition is documented in [cloud publication](../docs/frontend-cloud-export.md):
disable production and preview Git builds, cancel pending builds, then switch
the production branch to `main` while keeping Git builds disabled.

Actions publishes the complete Vite `dist`, with real `/data/stats.json` and
Pages Functions, to that same project using `--branch=main`. A read-only API
preflight blocks deployment if Git builds could replace it or the branch is
wrong. The post-deploy check verifies statistics and the compiled application
at the existing domain. Neither check changes Cloudflare settings.

Keep `LASTFM_API_KEY` and `LASTFM_USERNAME` in Cloudflare Production secrets for
now-playing. The GitHub `lastfm-prod` environment needs the account ID and a
least-privilege Pages Edit token for deployment; Azure authentication uses the
existing OIDC federation. Automatic publication stays off until the manual
export and deployment have passed. No local JSON copying, paid service or extra
hosting project is required.
