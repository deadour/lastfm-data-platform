import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestGet, previewAudioUrl } from "../../functions/api/audio";

const call = (url: string, range?: string) => (onRequestGet as unknown as (c: { request: Request }) => Promise<Response>)({
  request: new Request(`https://fm.example/api/audio?${new URLSearchParams({ url })}`, { headers: range ? { range } : {} }),
});
afterEach(() => vi.unstubAllGlobals());
describe("preview audio streaming", () => {
  it("only accepts HTTPS previews on the provider CDN", async () => {
    for (const value of ["https://127.0.0.1/a", "http://x.dzcdn.net/a", "https://x.dzcdn.net.evil.test/a", "https://u:p@x.dzcdn.net/a", "https://x.dzcdn.net:8080/a"]) expect(previewAudioUrl(value)).toBeNull();
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await call("https://evil.test/a")).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("streams ranges and rejects redirects outside the CDN", async () => {
    const fetcher = vi.fn(async (_url: URL, _options: RequestInit) => new Response(new Uint8Array([1, 2]), { status: 206, headers: { "content-type": "audio/mpeg", "content-range": "bytes 0-1/2" } }));
    vi.stubGlobal("fetch", fetcher);
    const result = await call("https://x.dzcdn.net/a.mp3", "bytes=0-1");
    expect(result.status).toBe(206);
    expect(result.headers.get("content-range")).toBe("bytes 0-1/2");
    expect(new Headers(fetcher.mock.calls[0][1].headers).get("range")).toBe("bytes=0-1");
    expect(await result.arrayBuffer()).toHaveProperty("byteLength", 2);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.test/a" } })));
    expect((await call("https://x.dzcdn.net/a.mp3")).status).toBe(502);
  });
});
