// GET /api/now-playing — the latest scrobble, cached at the edge.
//
// The Last.fm key never reaches the browser: it lives in the Pages project as a
// secret and the response carries only track fields. Every visitor inside the
// same TTL gets the cached copy, so Last.fm sees at most ~2 requests a minute
// per edge location no matter how many people have the page open.

export interface Env {
  LASTFM_API_KEY: string;
  LASTFM_USERNAME: string;
}

interface LastfmTrack {
  name?: string;
  artist?: { "#text"?: string };
  album?: { "#text"?: string };
  image?: { size?: string; "#text"?: string }[];
  url?: string;
  date?: { uts?: string };
  "@attr"?: { nowplaying?: string };
}

export const TTL_SECONDS = 30;
const ERROR_TTL_SECONDS = 10;
const ENDPOINT = "https://ws.audioscrobbler.com/2.0/";

function json(body: unknown, status: number, ttl: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${Math.min(ttl, 15)}, s-maxage=${ttl}`,
      "x-content-type-options": "nosniff",
    },
  });
}

function pickImage(images: LastfmTrack["image"]): string | null {
  const order = ["extralarge", "large", "medium", "small"];
  for (const size of order) {
    const url = images?.find((i) => i.size === size)?.["#text"];
    // last.fm returns this placeholder star when there is no artwork
    if (url && !url.includes("2a96cbd8b46e442fc41c2b86b821562f")) return url;
  }
  return null;
}

export function shape(payload: unknown) {
  const tracks = (payload as { recenttracks?: { track?: LastfmTrack[] | LastfmTrack } })?.recenttracks?.track;
  const latest = Array.isArray(tracks) ? tracks[0] : tracks;
  if (!latest?.name) return { playing: false, track: null, played_at: null, source: "lastfm" as const };
  const playing = latest["@attr"]?.nowplaying === "true";
  const uts = Number(latest.date?.uts);
  return {
    playing,
    track: {
      title: latest.name,
      artist: latest.artist?.["#text"] ?? "",
      album: latest.album?.["#text"] || null,
      image: pickImage(latest.image),
      url: latest.url ?? null,
    },
    played_at: playing || !Number.isFinite(uts) ? null : uts,
    source: "lastfm" as const,
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const cache = caches.default;
  const key = new Request(new URL("/api/now-playing", request.url).toString(), { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit;

  if (!env.LASTFM_API_KEY || !env.LASTFM_USERNAME) {
    return json({ playing: false, track: null, played_at: null, source: "lastfm", error: "not configured" }, 503, ERROR_TTL_SECONDS);
  }

  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    method: "user.getrecenttracks",
    user: env.LASTFM_USERNAME,
    api_key: env.LASTFM_API_KEY,
    format: "json",
    limit: "1",
  }).toString();

  let response: Response;
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { "user-agent": "fm.eduramirez.dev" } });
    if (!upstream.ok) {
      // last.fm explains failures with a numeric code (10 bad key, 6 unknown user, 29 rate limit).
      // only that number is kept: the url and message can carry the key.
      const body = (await upstream.json().catch(() => null)) as { error?: unknown } | null;
      const code = typeof body?.error === "number" ? body.error : null;
      response = json({ playing: false, track: null, played_at: null, source: "lastfm", error: "unavailable",
        upstream_status: upstream.status, lastfm_error: code }, 503, ERROR_TTL_SECONDS);
    } else {
      response = json(shape(await upstream.json()), 200, TTL_SECONDS);
    }
  } catch {
    // never echo the upstream url or error: it contains the api key.
    // 503, not 502: cloudflare swaps 502 bodies for its own error page.
    response = json({ playing: false, track: null, played_at: null, source: "lastfm", error: "unavailable",
      upstream_status: null, lastfm_error: null }, 503, ERROR_TTL_SECONDS);
  }

  waitUntil(cache.put(key, response.clone()));
  return response;
};
