import { mockStats } from "./mock";
import type { StatsFile } from "./types";

export interface Loaded {
  stats: StatsFile;
  /** why the mock is shown, if it is */
  fallback: string | null;
}

export function isStatsFile(value: unknown): value is StatsFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<StatsFile>;
  return (
    v.schema_version === 1 &&
    (v.source === "gold" || v.source === "mock") &&
    typeof v.totals?.scrobbles === "number" &&
    Array.isArray(v.years) &&
    Array.isArray(v.top_artists) &&
    Array.isArray(v.top_tracks) &&
    Array.isArray(v.rhythm) &&
    Array.isArray(v.months)
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
