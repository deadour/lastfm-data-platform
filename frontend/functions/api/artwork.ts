import { artworkSource } from "../../src/utils/artwork";

const MAX_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);

function error(status: number): Response {
  return new Response(null, { status, headers: { "cache-control": "no-store" } });
}

function served(response: Response, hit: boolean): Response {
  const result = new Response(response.body, response);
  result.headers.set("x-artwork-cache", hit ? "HIT" : "MISS");
  return result;
}

export const onRequestGet: PagesFunction = async ({ request, waitUntil }) => {
  let source = artworkSource(new URL(request.url).searchParams.get("url"));
  if (!source) return error(400);
  const key = new URL("/api/artwork", request.url);
  key.searchParams.set("url", source.href);
  const cacheKey = new Request(key.href);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return served(cached, true);

  try {
    const signal = AbortSignal.timeout(8000);
    for (let redirects = 0; redirects <= 4; redirects++) {
      const upstream = await fetch(source.href, {
        redirect: "manual", signal,
        headers: { accept: "image/avif,image/webp,image/*", "user-agent": "fm.eduramirez.dev artwork cache" },
      });
      if ([301, 302, 303, 307, 308].includes(upstream.status)) {
        const location = upstream.headers.get("location");
        await upstream.body?.cancel();
        source = location ? artworkSource(new URL(location, source).href) : null;
        if (!source) return error(502);
        continue;
      }
      const type = upstream.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
      if (!upstream.ok || !IMAGE_TYPES.has(type) || !upstream.body ||
          Number(upstream.headers.get("content-length")) > MAX_BYTES) {
        await upstream.body?.cancel();
        return error(502);
      }
      const reader = upstream.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          return error(502);
        }
        chunks.push(value);
      }
      if (!size) return error(502);
      const response = new Response(new Blob(chunks), { headers: {
        "content-type": type,
        "content-length": String(size),
        "cache-control": "public, max-age=86400, s-maxage=604800",
        "x-content-type-options": "nosniff",
      } });
      waitUntil(cache.put(cacheKey, response.clone()).catch(() => undefined));
      return served(response, false);
    }
  } catch {
    // Do not echo upstream URLs, bodies or request headers into the public response.
  }
  return error(502);
};
