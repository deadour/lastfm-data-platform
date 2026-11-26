import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestGet, shape } from "../../functions/api/now-playing";

const SECRET = "test-key-0000";

function lastfm(track: Record<string, unknown>) {
  return { recenttracks: { track: [track] } };
}

const playing = {
  name: "once de la noche",
  artist: { "#text": "marea baja" },
  album: { "#text": "verano largo" },
  image: [{ size: "extralarge", "#text": "https://lastfm.freetls.fastly.net/i/u/300x300/abc.jpg" }],
  url: "https://www.last.fm/music/x",
  "@attr": { nowplaying: "true" },
};

class MemoryCache {
  store = new Map<string, Response>();
  async match(req: Request) {
    return this.store.get(req.url)?.clone();
  }
  async put(req: Request, res: Response) {
    this.store.set(req.url, res);
  }
}

let cache: MemoryCache;
let pending: Promise<unknown>[];

function call(env = { LASTFM_API_KEY: SECRET, LASTFM_USERNAME: "someone" }) {
  pending = [];
  const ctx = {
    request: new Request("https://fm.example/api/now-playing?x=1"),
    env,
    waitUntil: (p: Promise<unknown>) => pending.push(p),
  };
  return (onRequestGet as unknown as (c: typeof ctx) => Promise<Response>)(ctx);
}

beforeEach(() => {
  cache = new MemoryCache();
  vi.stubGlobal("caches", { default: cache });
});
afterEach(() => vi.unstubAllGlobals());

describe("shape", () => {
  it("keeps only track fields", () => {
    expect(shape(lastfm(playing))).toEqual({
      playing: true,
      track: {
        title: "once de la noche",
        artist: "marea baja",
        album: "verano largo",
        image: "https://lastfm.freetls.fastly.net/i/u/300x300/abc.jpg",
        url: "https://www.last.fm/music/x",
      },
      played_at: null,
      source: "lastfm",
    });
  });

  it("reports the last finished scrobble and drops the placeholder star", () => {
    const done = { ...playing, "@attr": undefined, date: { uts: "1795606010" }, image: [{ size: "extralarge", "#text": "https://x/2a96cbd8b46e442fc41c2b86b821562f.png" }] };
    const result = shape(lastfm(done));
    expect(result.playing).toBe(false);
    expect(result.played_at).toBe(1795606010);
    expect(result.track?.image).toBeNull();
  });

  it("handles an empty history", () => {
    expect(shape({ recenttracks: { track: [] } }).track).toBeNull();
  });
});

describe("onRequestGet", () => {
  it("treats an API error inside HTTP 200 as unavailable rather than an empty history", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: 8, message: SECRET }))));
    const response = await call();
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ lastfm_error: 8, upstream_status: 200 });
    expect(body).not.toContain(SECRET);
  });
  it("serves from cache within the ttl and never leaks the key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(lastfm(playing))));
    vi.stubGlobal("fetch", fetchMock);

    const first = await call();
    await Promise.all(pending);
    const second = await call();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.headers.get("cache-control")).toContain("s-maxage=30");
    const body = await second.text();
    expect(JSON.parse(body).track.title).toBe("once de la noche");
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain("someone");
  });

  it("reports last.fm's error code, never the key, when last.fm refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: 10, message: `Invalid API key ${SECRET}` }), { status: 403 })));
    const response = await call();
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ upstream_status: 403, lastfm_error: 10 });
    expect(text).not.toContain(SECRET);
  });

  it("returns a short-lived 503 without upstream details on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(`boom ${SECRET}`); }));
    const response = await call();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("s-maxage=10");
    expect(await response.text()).not.toContain(SECRET);
  });

  it("refuses to call last.fm when secrets are missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await call({ LASTFM_API_KEY: "", LASTFM_USERNAME: "" });
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
