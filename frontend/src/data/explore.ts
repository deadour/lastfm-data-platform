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

export function isExploreFile(v: unknown): v is ExploreFile {
  if (!object(v) || v.schema_version !== 1 || !object(v.calendar) || !Array.isArray(v.year_ranks) || !object(v.rarities)) return false;
  const cal = v.calendar;
  if (!Array.isArray(cal.counts) || !cal.counts.every((c) => Number.isInteger(c) && c >= 0) || typeof cal.start !== "string") return false;
  if (v.genres !== null && !(object(v.genres) && Array.isArray(v.genres.families) && Array.isArray(v.genres.by_year))) return false;
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
