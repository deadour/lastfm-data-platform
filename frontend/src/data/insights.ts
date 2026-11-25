import type { ArtistPage, InsightsFile } from "./types";

// light structural checks: these files only add detail, so anything odd simply hides a section.
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const httpsOrNull = (v: unknown) => v === null || (typeof v === "string" && v.startsWith("https://"));
const photo = (v: unknown) => v === null || (object(v) && httpsOrNull(v.url) && typeof v.url === "string");

export function isInsightsFile(v: unknown): v is InsightsFile {
  return object(v) && v.schema_version === 1 && Array.isArray(v.months) && Array.isArray(v.monthly) &&
    v.monthly.length === v.months.length && Array.isArray(v.years) &&
    Array.isArray(v.artists) && v.artists.every((a) => object(a) && typeof a.slug === "string" &&
      /^[a-z0-9-]+$/.test(a.slug) && photo(a.photo) && httpsOrNull(a.image)) &&
    object(v.habits) && Array.isArray(v.habits.hours) && v.habits.hours.length === 24 &&
    object(v.busiest_day) && object(v.obsession) && object(v.first_ever);
}

export function isArtistPage(v: unknown): v is ArtistPage {
  return object(v) && v.schema_version === 1 && typeof v.slug === "string" && typeof v.name === "string" &&
    photo(v.photo) && Array.isArray(v.years) && Array.isArray(v.months) && Array.isArray(v.hours) &&
    v.hours.length === 24 && Array.isArray(v.top_tracks) && Array.isArray(v.top_albums);
}

async function getJson<T>(url: string, check: (v: unknown) => v is T, fetcher: typeof fetch): Promise<T | null> {
  try {
    const response = await fetcher(url, { headers: { accept: "application/json" }, cache: "no-cache" });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("json")) return null;
    const body: unknown = await response.json();
    return check(body) ? body : null;
  } catch {
    return null;
  }
}

export const loadInsights = (fetcher: typeof fetch = fetch) => getJson("/data/insights.json", isInsightsFile, fetcher);

export function loadArtist(slug: string, fetcher: typeof fetch = fetch) {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return Promise.resolve(null);
  return getJson(`/data/artists/${slug}.json`, isArtistPage, fetcher);
}
