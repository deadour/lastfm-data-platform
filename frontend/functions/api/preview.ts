interface Track {
  title?: string;
  title_short?: string;
  artist?: { name?: string };
  preview?: string;
  link?: string;
}

const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function selectApplePreview(data: unknown, artist: string, title: string) {
  const tracks = (data as { results?: { artistName?: string; trackName?: string; previewUrl?: string; trackViewUrl?: string }[] } | null)?.results;
  if (!Array.isArray(tracks)) return null;
  for (const track of tracks) {
    if (typeof track.artistName !== "string" || typeof track.trackName !== "string") continue;
    const mainArtist = track.artistName.split(",")[0];
    if (![track.artistName, mainArtist].some((name) => fold(name) === fold(artist))) continue;
    const name = track.trackName.replace(/\s*[\[(](?:feat\.?|featuring|ft\.)[^\])]*[\])]/gi, "");
    if (![track.trackName, name].some((value) => fold(value) === fold(title))) continue;
    try {
      const url = new URL(track.previewUrl ?? "");
      const link = new URL(track.trackViewUrl ?? "");
      if (url.protocol !== "https:" || (url.hostname !== "audio-ssl.itunes.apple.com" && !url.hostname.endsWith(".mzstatic.com")) || url.username || url.password || url.port) continue;
      if (link.protocol !== "https:" || !["music.apple.com", "itunes.apple.com"].includes(link.hostname) || link.username || link.password || link.port) continue;
      return { url: url.href, source_url: link.href, provider: "apple" };
    } catch { /* Ignore invalid provider metadata. */ }
  }
  return null;
}

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

/** artist-only mode: the first playable track whose artist matches exactly (deezer ranks by popularity) */
export function selectArtistPreview(data: unknown, artist: string) {
  const tracks = (data as { data?: Track[] } | null)?.data;
  if (!Array.isArray(tracks)) return null;
  for (const track of tracks) {
    if (!track || typeof track.artist?.name !== "string" || fold(track.artist.name) !== fold(artist) || typeof track.title !== "string") continue;
    const found = selectPreview({ data: [track] }, artist, track.title);
    if (found) return { ...found, title: track.title };
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
  const valid = (value: string) => value.length > 0 && value.length <= 200 && !/[\x00-\x1f]/.test(value);
  // title is optional: without it, any playable song by the artist
  if (!valid(artist) || (title !== "" && !valid(title))) return json({ preview: null }, 400, 0);
  const key = new URL("/api/preview", request.url);
  key.search = new URLSearchParams({ artist, title }).toString();
  key.searchParams.set("version", "2");
  const cacheKey = new Request(key.href);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  try {
    const clean = (value: string) => value.replace(/["\\]/g, " ");
    const upstream = new URL("https://api.deezer.com/search");
    upstream.search = new URLSearchParams({ q: title ? `artist:"${clean(artist)}" track:"${clean(title)}"` : `artist:"${clean(artist)}"`, limit: "15" }).toString();
    let preview = null;
    let providerWorked = false;
    try {
      const response = await fetch(upstream.href, { signal: AbortSignal.timeout(2500), redirect: "follow",
        headers: { accept: "application/json", "user-agent": "lastfm-data-platform/0.1 (+https://fm.eduramirez.dev)" } });
      if (response.ok) {
        const body = await response.json() as { error?: unknown };
        if (!body?.error) { providerWorked = true; preview = title ? selectPreview(body, artist, title) : selectArtistPreview(body, artist); }
      }
    } catch { /* Try the independent catalog below. */ }
    if (!preview && title) {
      try {
        const apple = new URL("https://itunes.apple.com/search");
        apple.search = new URLSearchParams({ term: `${artist} ${title}`, entity: "song", media: "music", limit: "15", country: "US" }).toString();
        const response = await fetch(apple.href, { signal: AbortSignal.timeout(4000), headers: { accept: "application/json" } });
        if (response.ok) {
          const body = await response.json();
          if (Array.isArray((body as { results?: unknown })?.results)) { providerWorked = true; preview = selectApplePreview(body, artist, title); }
        }
      } catch { /* Do not substitute a different recording or leak provider errors. */ }
    }
    if (!preview && !providerWorked) return json({ preview: null }, 503, 0);
    const result = json({ preview });
    // Deezer preview URLs are signed and short-lived; do not retain them for days.
    waitUntil(cache.put(cacheKey, result.clone()).catch(() => undefined));
    return result;
  } catch (error) {
    const result = json({ preview: null }, 503, 0);
    result.headers.set("x-preview-failure", error instanceof SyntaxError ? "invalid-response" : "request-failed");
    return result;
  }
};
