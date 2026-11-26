import { describe, expect, it } from "vitest";
import { isExploreFile, loadExplore } from "./explore";

const fixture = () => ({ schema_version: 1, generated_at: "2026-11-25T12:00:00Z",
  calendar: { start: "2026-11-25", end: "2026-11-25", counts: [3], max: 3 },
  year_ranks: [{ year: 2026, top_artists: [{ name: "fixture artist", plays: 3 }], top_family: null }],
  rarities: { one_day: [], off_genre: [] }, genres: null });

describe("exploration contract", () => {
  it("accepts the export shape without genre coverage", () => expect(isExploreFile(fixture())).toBe(true));
  it.each([
    { calendar: { start: "2026-11-25", end: "2026-11-25", counts: [], max: 0 } },
    { year_ranks: [{ year: 2026, top_artists: null }] },
    { rarities: {} }, { genres: { families: [], by_year: [] } },
  ])("rejects data that would break a chart: %j", (patch) => expect(isExploreFile({ ...fixture(), ...patch })).toBe(false));
  it("treats the Pages HTML fallback as unavailable", async () => {
    const fetcher = (async () => new Response("<html/>", { headers: { "content-type": "text/html" } })) as typeof fetch;
    expect(await loadExplore(fetcher)).toBeNull();
  });
});
