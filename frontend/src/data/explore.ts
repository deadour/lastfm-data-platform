// /data/explore.json v1: deeper reads kept outside insights.json v1.
// light checks only; a malformed file hides these sections instead of breaking the page.

export interface FamilyShare { family: string; share: number }

export interface ExploreFile {
  schema_version: 1;
  generated_at: string;
  calendar: { start: string; end: string; counts: number[]; max: number };
  year_ranks: { year: number; top_artists: { name: string; plays: number }[]; top_family?: string | null }[];
  rarities: {
    one_day: { name: string; plays: number; date: string }[];
    off_genre: { name: string; plays: number; family: string; style: string | null; family_share: number }[];
  };
  genres: {
    /** share of plays whose artist has genre tags */
    coverage: number;
    families: FamilyShare[];
    by_year: { year: number; families: FamilyShare[] }[];
    artists_by_family: Record<string, { name: string; plays: number }[]>;
    styles: { style: string; plays: number }[];
  } | null;
}

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const date = (v: unknown): v is string => text(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const share = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const rows = (v: unknown, check: (r: Record<string, unknown>) => boolean) => Array.isArray(v) && v.every((r) => object(r) && check(r));
const artists = (v: unknown) => rows(v, (r) => text(r.name) && count(r.plays));
const families = (v: unknown) => rows(v, (r) => text(r.family) && share(r.share));

export function isExploreFile(v: unknown): v is ExploreFile {
  if (!object(v) || v.schema_version !== 1 || !text(v.generated_at) || !Number.isFinite(Date.parse(v.generated_at)) || !object(v.calendar) || !object(v.rarities)) return false;
  const cal = v.calendar;
  if (!date(cal.start) || !date(cal.end) || cal.start > cal.end || !count(cal.max) || !Array.isArray(cal.counts) || !cal.counts.length || !cal.counts.every(count)) return false;
  if (cal.counts.length !== (Date.parse(cal.end) - Date.parse(cal.start)) / 86400000 + 1 || cal.max !== Math.max(...cal.counts)) return false;
  if (!rows(v.year_ranks, (r) => count(r.year) && artists(r.top_artists) && (r.top_family === undefined || r.top_family === null || text(r.top_family)))) return false;
  if (!rows(v.rarities.one_day, (r) => text(r.name) && count(r.plays) && date(r.date)) ||
      !rows(v.rarities.off_genre, (r) => text(r.name) && count(r.plays) && text(r.family) && share(r.family_share) && (r.style === null || text(r.style)))) return false;
  if (v.genres !== null && !(object(v.genres) && share(v.genres.coverage) && families(v.genres.families) &&
      rows(v.genres.by_year, (r) => count(r.year) && families(r.families)) && object(v.genres.artists_by_family) &&
      Object.values(v.genres.artists_by_family).every(artists) && rows(v.genres.styles, (r) => text(r.style) && count(r.plays)))) return false;
  return true;
}

export async function loadExplore(fetcher: typeof fetch = fetch): Promise<ExploreFile | null> {
  try {
    const response = await fetcher("/data/explore.json", { headers: { accept: "application/json" }, cache: "no-cache" });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("json")) return null;
    const body: unknown = await response.json();
    return isExploreFile(body) ? body : null;
  } catch {
    return null;
  }
}
