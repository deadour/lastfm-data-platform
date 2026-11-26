import { describe, expect, it } from "vitest";
import { isRecentFile, loadRecent, weekSoFarChange, type Period, type RecentFile } from "./recent";

// test fixture only: shaped like the contract, never shipped to the site
function period(start: string, end: string, complete: boolean, scrobbles = 10): Period {
  return {
    start, end_exclusive: end, complete, scrobbles, unique_artists: 3, unique_tracks: 8,
    top_artists: [{ name: "fixture artist", scrobbles: 5 }],
    top_albums: [{ artist: "fixture artist", title: "fixture album", scrobbles: 4, cover: null }],
    top_tracks: [{ artist: "fixture artist", title: "fixture track", scrobbles: 2 }],
  };
}

function days(values: (number | null)[], first = "2026-11-12") {
  const start = new Date(first + "T00:00:00Z");
  return values.map((scrobbles, i) => {
    const d = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    return { date: d, scrobbles, complete: i < values.length - 1 };
  });
}

function fixture(): RecentFile {
  return {
    schema_version: 1,
    generated_at: "2026-11-25T22:00:00Z",
    data_as_of: "2026-11-25T21:55:00Z",
    timezone: "America/Argentina/Cordoba",
    periods: {
      today: period("2026-11-25", "2026-11-26", false),
      this_week: period("2026-11-23", "2026-11-30", false),
      last_week: period("2026-11-16", "2026-11-23", true),
      this_month: period("2026-11-01", "2026-12-01", false),
      last_month: period("2026-10-01", "2026-11-01", true),
    },
    series: {
      // 12 nov .. 25 nov: this week (mon 23) has 3 elapsed days
      days: days([1, 1, 1, 1, 10, 20, 30, 1, 1, 1, 1, 20, 30, 40]),
      weeks: Array.from({ length: 12 }, (_, i) => ({ start: `2026-${String(9 + Math.floor((i * 7 + 1) / 31)).padStart(2, "0")}-${String(((i * 7) % 28) + 1).padStart(2, "0")}`, scrobbles: i, complete: i < 11 }))
        .map((w, i) => ({ ...w, start: new Date(Date.UTC(2026, 8, 7 + i * 7)).toISOString().slice(0, 10) })),
      months: Array.from({ length: 12 }, (_, i) => ({ month: `${i < 1 ? 2025 : 2026}-${String(i < 1 ? 12 : i).padStart(2, "0")}`, scrobbles: i * 100, complete: i < 11 })),
    },
  };
}

const respond = (body: unknown, type = "application/json") =>
  (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { headers: { "content-type": type } })) as unknown as typeof fetch;

describe("recent.json contract", () => {
  it("accepts the agreed shape", () => {
    expect(isRecentFile(fixture())).toBe(true);
  });

  it("rejects literal example records from the contract", () => {
    const data = fixture();
    data.periods.today.top_artists = [{ name: "example", scrobbles: 0 }];
    expect(isRecentFile(data)).toBe(false);
  });

  it("requires all five periods with the same shape", () => {
    const data = fixture() as unknown as { periods: Record<string, unknown> };
    data.periods.last_month = {};
    expect(isRecentFile(data)).toBe(false);
  });

  it("requires 14 days, 12 weeks and 12 months in ascending order", () => {
    const shortSeries = fixture();
    shortSeries.series.days = shortSeries.series.days.slice(1);
    expect(isRecentFile(shortSeries)).toBe(false);
    const unordered = fixture();
    unordered.series.months.reverse();
    expect(isRecentFile(unordered)).toBe(false);
  });

  it("keeps unknown buckets as null instead of zero", () => {
    const data = fixture();
    data.series.days[0].scrobbles = null;
    expect(isRecentFile(data)).toBe(true);
  });

  it("rejects non-https covers and more than five ranked items", () => {
    const http = fixture();
    http.periods.today.top_albums[0].cover = { url: "http://example.org/a.jpg" };
    expect(isRecentFile(http)).toBe(false);
    const long = fixture();
    long.periods.today.top_tracks = Array.from({ length: 6 }, (_, i) => ({ artist: "a", title: `t${i}`, scrobbles: 1 }));
    expect(isRecentFile(long)).toBe(false);
  });
});

describe("loadRecent", () => {
  it("returns ready data", async () => {
    expect((await loadRecent(respond(fixture()))).status).toBe("ready");
  });

  it("treats the html fallback as not published", async () => {
    expect(await loadRecent(respond("<!doctype html>", "text/html"))).toEqual({ status: "unavailable", reason: "not_published" });
  });

  it("treats a malformed file as invalid, never as zero", async () => {
    expect(await loadRecent(respond({ schema_version: 2 }))).toEqual({ status: "unavailable", reason: "invalid" });
  });

  it("survives network errors", async () => {
    const broken = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await loadRecent(broken)).toEqual({ status: "unavailable", reason: "network" });
  });
});

describe("weekSoFarChange", () => {
  it("compares the elapsed days with the same days of last week", () => {
    // this week mon-wed: 20+30+40 = 90; last week mon-wed: 1+1+1... (16-18 nov) = 10+20+30 = 60
    expect(weekSoFarChange(fixture())).toBeCloseTo(0.5);
  });

  it("is null when a compared day is unknown", () => {
    const data = fixture();
    data.series.days[4].scrobbles = null;
    expect(weekSoFarChange(data)).toBeNull();
  });
});
