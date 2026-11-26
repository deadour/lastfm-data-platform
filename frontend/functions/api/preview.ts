interface Track {
  title?: string;
  title_short?: string;
  artist?: { name?: string };
  preview?: string;
  link?: string;
}

const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function selectPreview(data: unknown, artist: string, title: string) {
  const tracks = (data as { data?: Track[] } | null)?.data;
  if (!Array.isArray(tracks)) return null;
  for (const track of tracks) {
    if (!track || typeof track.artist?.name !== "string" || fold(track.artist.name) !== fold(artist)) continue;
    if (![track.title, track.title_short].some((name) => typeof name === "string" && fold(name) === fold(title))) continue;
    try {
      const url = new URL(track.preview ?? "");
      if (url.protocol !== "https:" || !url.hostname.endsWith(".dzcdn.net") || url.username || url.password || url.port) continue;
      const link = new URL(track.link ?? "");
      if (link.protocol !== "https:" || !["www.deezer.com", "deezer.com"].includes(link.hostname) || link.username || link.password || link.port) continue;
      return { url: url.href, source_url: link.href, provider: "deezer" };
    } catch {
      // A missing, malformed or untrusted preview is not playable.
    }
  }
  return null;
}

const json = (body: unknown, status = 200, ttl = 120) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": ttl ? `public, max-age=30, s-maxage=${ttl}` : "no-store", "x-content-type-options": "nosniff" },
});

export const onRequestGet: PagesFunction = async ({ request, waitUntil }) => {
  const params = new URL(request.url).searchParams;
  const artist = params.get("artist")?.trim() ?? "";
  const title = params.get("title")?.trim() ?? "";
  if (![artist, title].every((value) => value.length > 0 && value.length <= 200 && !/[\x00-\x1f]/.test(value))) {
    return json({ preview: null }, 400, 0);
  }
  const key = new URL("/api/preview", request.url);
  key.search = new URLSearchParams({ artist, title }).toString();
  const cacheKey = new Request(key.href);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  try {
    const clean = (value: string) => value.replace(/["\\]/g, " ");
    const upstream = new URL("https://api.deezer.com/search");
    upstream.search = new URLSearchParams({ q: `artist:"${clean(artist)}" track:"${clean(title)}"`, limit: "10" }).toString();
    const response = await fetch(upstream.href, { signal: AbortSignal.timeout(6000), redirect: "error" });
    if (!response.ok) return json({ preview: null }, 503, 0);
    const body = await response.json() as { error?: unknown };
    if (body?.error) return json({ preview: null }, 503, 0);
    const result = json({ preview: selectPreview(body, artist, title) });
    // Deezer preview URLs are signed and short-lived; do not retain them for days.
    waitUntil(cache.put(cacheKey, result.clone()).catch(() => undefined));
    return result;
  } catch {
    return json({ preview: null }, 503, 0);
  }
};
