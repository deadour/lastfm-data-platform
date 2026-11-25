import { describe, expect, it } from "vitest";
import { ago, hash, monthLabel, n, shortDate } from "../lib/format";
import { isStatsFile, loadStats } from "./load";
import { mockStats } from "./mock";

const ok = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;

describe("loadStats", () => {
  it("uses exported gold stats when they match the contract", async () => {
    const gold = { ...mockStats, source: "gold" as const };
    const result = await loadStats(ok(gold));
    expect(result.fallback).toBeNull();
    expect(result.stats.source).toBe("gold");
  });

  it("falls back to the mock, flagged, when the file is missing", async () => {
    const missing = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const result = await loadStats(missing);
    expect(result.stats.source).toBe("mock");
    expect(result.fallback).toContain("404");
  });

  it("rejects unknown schema versions", async () => {
    const result = await loadStats(ok({ ...mockStats, schema_version: 2 }));
    expect(result.stats.source).toBe("mock");
  });

  it("survives network errors", async () => {
    const broken = (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    expect((await loadStats(broken)).stats.source).toBe("mock");
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
