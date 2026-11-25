import { describe, expect, it } from "vitest";
import { ago, hash, monthLabel, n, secureImage, shortDate } from "../utils/format";
import { isStatsFile, loadStats } from "./load";
import { mockStats } from "./mock";

const ok = (body: unknown) =>
  (async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

describe("loadStats", () => {
  it("uses exported gold stats when they match the contract", async () => {
    const gold = { ...mockStats, source: "gold" as const };
    const result = await loadStats(ok(gold));
    expect(result.fallback).toBeNull();
    expect(result.stats?.source).toBe("gold");
  });

  it("bypasses the browser cache so a stale copy can't hide published stats", async () => {
    let init: RequestInit | undefined;
    const spy = (async (_url: string, options?: RequestInit) => {
      init = options;
      return new Response(JSON.stringify({ ...mockStats, source: "gold" }), { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    await loadStats(spy);
    expect(init?.cache).toBe("no-cache");
  });

  it("reports missing real statistics without substituting a mock", async () => {
    const missing = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const result = await loadStats(missing);
    expect(result.stats).toBeNull();
    expect(result.fallback).toContain("404");
  });

  it("treats the html fallback pages serves for a missing file as unpublished", async () => {
    const html = (async () =>
      new Response("<!doctype html><div id=root></div>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })) as unknown as typeof fetch;
    const result = await loadStats(html);
    expect(result.stats).toBeNull();
    expect(result.fallback).toBe("todavía no hay estadísticas publicadas");
  });

  it("rejects unknown schema versions", async () => {
    const result = await loadStats(ok({ ...mockStats, schema_version: 2 }));
    expect(result.stats).toBeNull();
  });

  it("survives network errors", async () => {
    const broken = (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    expect((await loadStats(broken)).stats).toBeNull();
  });

  it("rejects mock documents even when served as successful JSON", async () => {
    expect((await loadStats(ok(mockStats))).stats).toBeNull();
  });
});

describe("mock data", () => {
  it("is marked as mock", () => {
    expect(mockStats.source).toBe("mock");
  });

  it("has a full, normalised week grid", () => {
    expect(mockStats.rhythm).toHaveLength(168);
    expect(mockStats.rhythm.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 6);
  });

  it("uses no artwork", () => {
    expect(mockStats.top_albums?.every((a) => a.cover === null && !a.image)).toBe(true);
    expect(mockStats.top_tracks.every((t) => !t.image)).toBe(true);
  });
});

describe("contract", () => {
  it.each([
    { totals: { scrobbles: -1 } },
    { top_artists: [{ name: "fictional", scrobbles: null }] },
    { range: { first: "2026-02-30", last: "2026-03-01" } },
    { rhythm: [] },
    { months: [{ month: "2026-13", scrobbles: 1 }] },
    { username: "private-user" },
    { totals: { ...mockStats.totals, checkpoint: "private" } },
    { top_tracks: [{ title: "t", artist: "a", scrobbles: 1, image: "https://example.blob.core.windows.net/a?sig=secret" }] },
  ])("rejects malformed or private fields: %j", (override) => {
    expect(isStatsFile({ ...mockStats, source: "gold", ...override })).toBe(false);
  });

  it("rejects duplicate rhythm cells", () => {
    expect(isStatsFile({ ...mockStats, source: "gold", rhythm: Array(168).fill({ weekday: 0, hour: 0, share: 0 }) })).toBe(false);
  });

  it("rejects files missing a required list", () => {
    const { rhythm: _omit, ...rest } = mockStats;
    expect(isStatsFile({ ...rest, source: "gold" })).toBe(false);
  });

  it("accepts files without the optional album list", () => {
    const { top_albums: _omit, ...rest } = mockStats;
    expect(isStatsFile({ ...rest, source: "gold" })).toBe(true);
  });

  it("accepts the exporter's shape with covers", () => {
    const withCover = {
      ...mockStats,
      source: "gold",
      top_albums: [{ key: "k", artist: "a", title: "t", scrobbles: 1, image: null,
        cover: { url: "https://coverartarchive.org/x-500.jpg", provider: "coverartarchive", source_url: "https://musicbrainz.org/release/x", attribution: "cover art archive" } }],
    };
    expect(isStatsFile(withCover)).toBe(true);
  });
});

describe("format", () => {
  it("formats numbers the argentine way", () => {
    expect(n(118343)).toBe("118.343");
  });

  it("writes relative times plainly", () => {
    const now = 1_800_000_000_000;
    expect(ago(now / 1000 - 30, now)).toBe("recién");
    expect(ago(now / 1000 - 12 * 60, now)).toBe("hace 12 min");
    expect(ago(now / 1000 - 3 * 3600, now)).toBe("hace 3 h");
    expect(ago(now / 1000 - 26 * 3600, now)).toBe("ayer");
  });

  it("labels dates and months in lowercase spanish", () => {
    expect(shortDate("2026-10-02T22:39:40Z")).toBe("2 oct 2026");
    expect(monthLabel("2026-01")).toBe("ene 26");
    expect(monthLabel("2026-05")).toBe("may");
  });

  it("hashes stably", () => {
    expect(hash("marea baja")).toBe(hash("marea baja"));
    expect(hash("marea baja")).not.toBe(hash("marea alta"));
  });
});

describe("secureImage", () => {
  it("upgrades cover art archive http urls and drops non-web ones", () => {
    expect(secureImage("http://coverartarchive.org/release/x/1-500.jpg")).toBe("https://coverartarchive.org/release/x/1-500.jpg");
    expect(secureImage("https://cdn-images.dzcdn.net/images/cover/a/500x500.jpg")).toBe("https://cdn-images.dzcdn.net/images/cover/a/500x500.jpg");
    expect(secureImage("javascript:alert(1)")).toBeNull();
    expect(secureImage(null)).toBeNull();
  });
});
