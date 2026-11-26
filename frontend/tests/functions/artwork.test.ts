import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "../../functions/api/artwork";

const SOURCE = "https://coverartarchive.org/release/abc/front-500.jpg";
let stored: Map<string, Response>;
let pending: Promise<unknown>[];

function call(source = SOURCE, extra = "") {
  const context = {
    request: new Request(`https://fm.example/api/artwork?url=${encodeURIComponent(source)}${extra}`),
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  };
  return (onRequestGet as unknown as (value: typeof context) => Promise<Response>)(context);
}

beforeEach(() => {
  stored = new Map();
  pending = [];
  vi.stubGlobal("caches", { default: {
    match: async (request: Request) => stored.get(request.url)?.clone(),
    put: async (request: Request, response: Response) => { stored.set(request.url, response); },
  } });
});
afterEach(() => vi.unstubAllGlobals());

describe("shared artwork cache", () => {
  it("shares image bytes between visits, canonicalizes the key and strips upstream cookies", async () => {
    const fetcher = vi.fn(async () => new Response("image bytes", { headers: {
      "content-type": "image/jpeg", "set-cookie": "private=value", "cache-control": "private",
    } }));
    vi.stubGlobal("fetch", fetcher);
    const first = await call();
    await Promise.all(pending);
    const second = await call(SOURCE, "&ignored=1");
    expect(first.headers.get("x-artwork-cache")).toBe("MISS");
    expect(second.headers.get("x-artwork-cache")).toBe("HIT");
    expect(await second.text()).toBe("image bytes");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second.headers.get("cache-control")).toBe("public, max-age=86400, s-maxage=604800");
    expect(second.headers.get("set-cookie")).toBeNull();
    expect(fetcher.mock.calls[0]).toHaveLength(2);
  });

  it.each([
    "https://private.blob.core.windows.net/lake/a.jpg?sig=secret",
    "https://127.0.0.1/a.jpg", "http://archive.org/a.jpg", "https://archive.org.evil.example/a.jpg",
    "https://user:password@archive.org/a.jpg", "https://archive.org:444/a.jpg",
    "https://archive.org/a.jpg?token=secret", "not a url",
  ])("rejects private or unsupported sources without fetching: %s", async (source) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await call(source)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("follows archive redirects and caches under the original cover URL", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "https://ia800001.us.archive.org/image.jpg" } }))
      .mockResolvedValueOnce(new Response("cover", { headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetcher);
    expect((await call()).status).toBe(200);
    await Promise.all(pending);
    expect((await call()).headers.get("x-artwork-cache")).toBe("HIT");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("blocks redirects outside the public provider allowlist", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/internal" } }));
    vi.stubGlobal("fetch", fetcher);
    expect((await call()).status).toBe(502);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(stored.size).toBe(0);
  });

  it.each(["text/html", "image/svg+xml"])("does not cache non-raster content: %s", async (type) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not an album cover", { headers: { "content-type": type } })));
    expect((await call()).status).toBe(502);
    expect(stored.size).toBe(0);
  });

  it("bounds image size even when the provider omits content-length", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(3 * 1024 * 1024 + 1), { headers: { "content-type": "image/jpeg" } })));
    expect((await call()).status).toBe(502);
    expect(stored.size).toBe(0);
  });

  it("does not cache provider failures or reveal their details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("internal provider detail"); }));
    const response = await call();
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(stored.size).toBe(0);
  });
});
