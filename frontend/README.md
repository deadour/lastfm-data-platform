# fm.eduramirez.dev

Static site (React + Vite + TypeScript + Tailwind) with one Cloudflare Pages
Function for "now playing". It lives next to the Python pipeline but does not
import it or touch its state.

```text
gold parquet ──(src/exports/frontend_stats.py, by hand)──▶ public/data/stats.json ──▶ static site
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
"datos de ejemplo (mock)" notice. To use real numbers, export them from Gold:

```bash
python -m src.exports.frontend_stats --gold-root data/gold --out frontend/public/data/stats.json
```

The file is git-ignored on purpose. It holds only aggregates (yearly counts,
top 20 artists and tracks, a weekday × hour grid). It is still your listening
history, and it becomes public the moment it is deployed. Publish it on
purpose: commit it, or use a direct upload (below).

To try the real function locally, put the secrets in `frontend/.dev.vars`
(ignored) and run `npx wrangler pages dev -- npm run dev`.

## Stats contract

`src/data/types.ts` (`StatsFile`, `schema_version: 1`) is the source of truth.
`tests/test_frontend_stats.py` checks that the exporter writes exactly those
keys. The loader rejects other versions and falls back to the mock. Image
fields are optional: Gold has no artwork URLs yet, so covers use a gradient
generated from the name.

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
python -m src.exports.frontend_stats --out frontend/public/data/stats.json
cd frontend && npm run build && npx wrangler pages deploy dist --project-name fm-eduramirez-dev
```

**Free-plan limits as of this writing:**
- 500 builds per month;
- 100 000 Function requests per day, which the cache keeps us far below;
- static requests unmetered.

No paid feature is used. `public/_headers` sets a strict CSP; `img-src` allows
Last.fm's image CDN only.
