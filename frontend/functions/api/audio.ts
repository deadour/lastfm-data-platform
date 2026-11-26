// Same-origin streaming for previews whose CDN does not expose CORS headers.
// This lets Web Audio analyse the actual sound instead of silencing the source.
export function previewAudioUrl(value: string | null): URL | null {
  try {
    if (!value || value.length > 4096) return null;
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
    if (!url.hostname.endsWith(".dzcdn.net")) return null;
    return url;
  } catch { return null; }
}

export const onRequestGet = async ({ request }: { request: Request }): Promise<Response> => {
  let url = previewAudioUrl(new URL(request.url).searchParams.get("url"));
  if (!url) return new Response(null, { status: 400 });
  try {
    const headers = new Headers();
    const range = request.headers.get("range");
    if (range && /^bytes=\d*-\d*$/.test(range)) headers.set("range", range);
    for (let redirects = 0; redirects < 3; redirects++) {
      const upstream: Response = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(8000) });
      if ([301, 302, 303, 307, 308].includes(upstream.status)) {
        const location: string | null = upstream.headers.get("location");
        url = location ? previewAudioUrl(new URL(location, url).href) : null;
        await upstream.body?.cancel();
        if (!url) return new Response(null, { status: 502 });
        continue;
      }
      const type = upstream.headers.get("content-type") ?? "";
      if (![200, 206].includes(upstream.status) || !(type.startsWith("audio/") || type === "application/octet-stream")) {
        await upstream.body?.cancel();
        return new Response(null, { status: 502 });
      }
      const output = new Headers({ "content-type": type, "cache-control": "public, max-age=120", "x-content-type-options": "nosniff" });
      for (const key of ["content-length", "content-range", "accept-ranges"]) {
        const value = upstream.headers.get(key);
        if (value) output.set(key, value);
      }
      return new Response(upstream.body, { status: upstream.status, headers: output });
    }
    return new Response(null, { status: 502 });
  } catch { return new Response(null, { status: 503 }); }
};
