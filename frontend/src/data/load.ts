import { mockStats } from "./mock";
import type { StatsFile, YearStat } from "./types";

export interface Loaded {
  stats: StatsFile;
  /** why the mock is shown, if it is */
  fallback: string | null;
}

const ARRAYS = ["years", "months", "top_artists", "top_albums", "top_tracks", "week_hours"] as const;

export function isStatsFile(value: unknown): value is StatsFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown> & Partial<StatsFile>;
  return (
    v.schema_version === 1 &&
    (v.source === "gold" || v.source === "mock") &&
    typeof v.totals?.scrobbles === "number" &&
    typeof v.range?.first_day === "string" &&
    ARRAYS.every((key) => Array.isArray(v[key]))
  );
}

export async function loadStats(fetcher: typeof fetch = fetch, url = "/data/stats.json"): Promise<Loaded> {
  try {
    const response = await fetcher(url, { headers: { accept: "application/json" } });
    if (!response.ok) return { stats: mockStats, fallback: `stats.json no disponible (${response.status})` };
    const body: unknown = await response.json();
    if (!isStatsFile(body)) return { stats: mockStats, fallback: "stats.json con formato desconocido" };
    return { stats: body, fallback: null };
  } catch {
    return { stats: mockStats, fallback: "no se pudo leer stats.json" };
  }
}

/** a year is shown faded if tracking was partial or the year is not over yet */
export function isPartialYear(year: YearStat, lastDay: string): boolean {
  if (year.era === "partial_tracking") return true;
  const [y, m, d] = lastDay.split("-").map(Number);
  return year.year === y && !(m === 12 && d === 31);
}

/** turns raw weekday × hour counts into 0..1 shares */
export function shares(cells: { weekday: number; hour: number; scrobbles: number }[]) {
  const total = cells.reduce((sum, c) => sum + c.scrobbles, 0) || 1;
  return cells.map((c) => ({ weekday: c.weekday, hour: c.hour, share: c.scrobbles / total }));
}
