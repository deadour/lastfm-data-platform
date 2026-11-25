import { mockStats } from "./mock";
import type { StatsFile } from "./types";

export interface Loaded {
  stats: StatsFile;
  /** why the mock is shown, if it is */
  fallback: string | null;
}

const ARRAYS = ["years", "months", "top_artists", "top_tracks", "rhythm"] as const;

export function isStatsFile(value: unknown): value is StatsFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown> & Partial<StatsFile>;
  return (
    v.schema_version === 1 &&
    (v.source === "gold" || v.source === "mock") &&
    typeof v.totals?.scrobbles === "number" &&
    typeof v.range?.first === "string" &&
    ARRAYS.every((key) => Array.isArray(v[key])) &&
    (v.top_albums === undefined || Array.isArray(v.top_albums))
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
