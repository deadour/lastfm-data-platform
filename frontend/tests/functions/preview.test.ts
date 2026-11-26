import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestGet, selectPreview, selectApplePreview } from "../../functions/api/preview";

const track = { title: "Get Lucky (Radio Edit)", title_short: "Get Lucky", artist: { name: "Daft Punk" },
  preview: "https://cdnt-preview.dzcdn.net/audio.mp3?expires=123", link: "https://www.deezer.com/track/123" };
let stored: Map<string, Response>;
let pending: Promise<unknown>[];
function call(artist = "Daft Punk", title = "Get Lucky") {
  const context = { request: new Request(`https://fm.example/api/preview?${new URLSearchParams({ artist, title })}`),
    waitUntil: (promise: Promise<unknown>) => pending.push(promise) };
  return (onRequestGet as unknown as (value: typeof context) => Promise<Response>)(context);
}
beforeEach(() => {
  stored = new Map(); pending = [];
  vi.stubGlobal("caches", { default: {
    match: async (request: Request) => stored.get(request.url)?.clone(),
    put: async (request: Request, response: Response) => { stored.set(request.url, response); },
  } });
});
afterEach(() => vi.unstubAllGlobals());

describe("preview matching", () => {
  it("requires a matching artist and title, including short titles", () => {
    expect(selectPreview({ data: [track] }, "DAFT PUNK", "Get Lucky")?.url).toBe(track.preview);
    expect(selectPreview({ data: [track] }, "Tribute to Daft Punk", "Get Lucky")).toBeNull();
    expect(selectPreview({ data: [track] }, "Daft Punk", "Get Lucky Live")).toBeNull();
  });
  it.each([null, {}, { data: [null] }, { data: [{ ...track, preview: "https://evil.example/audio.mp3" }] },
    { data: [{ ...track, preview: "https://password@cdnt-preview.dzcdn.net/a.mp3" }] },
    { data: [{ ...track, link: "javascript:alert(1)" }] }, { data: [{ ...track, preview: "" }] }])("does not return untrusted or missing clips", (body) => {
    expect(selectPreview(body, "Daft Punk", "Get Lucky")).toBeNull();
  });
});

describe("preview endpoint", () => {
  it("uses an independent provider when Deezer is unavailable", async () => {
    const apple = { artistName: "Daft Punk, Pharrell Williams & Nile Rodgers", trackName: "Get Lucky",
      previewUrl: "https://audio-ssl.itunes.apple.com/clip.m4a", trackViewUrl: "https://music.apple.com/us/song/123" };
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [apple] })));
    vi.stubGlobal("fetch", fetcher);
    expect((await (await call()).json() as { preview: unknown }).preview).toMatchObject({ provider: "apple", url: apple.previewUrl });
    expect(selectApplePreview({ results: [{ ...apple, trackName: "Get Lucky (Live)" }] }, "Daft Punk", "Get Lucky")).toBeNull();
    expect(selectApplePreview({ results: [{ ...apple, previewUrl: "https://evil.example/clip.m4a" }] }, "Daft Punk", "Get Lucky")).toBeNull();
  });
  it("shares metadata briefly so signed audio URLs do not outlive their validity", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [track], private_internal_field: "not public" })));
    vi.stubGlobal("fetch", fetcher);
    const response = await call();
    await Promise.all(pending);
    const second = await call();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(response.headers.get("cache-control")).toContain("s-maxage=120");
    expect(await second.json()).toEqual({ preview: { url: track.preview, source_url: track.link, provider: "deezer" } });
  });
  it.each(["", "a".repeat(201), "a\nb"])("rejects invalid search terms", async (artist) => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await call(artist)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns an explicit unavailable result when no exact match exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }))));
    expect(await (await call()).json()).toEqual({ preview: null });
  });
  it("does not cache upstream errors or expose their details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "internal detail" } }))));
    const response = await call();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ preview: null });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(stored.size).toBe(0);
  });
});
