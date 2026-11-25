import { isStatsFile } from "./contract";
import type { StatsFile } from "./types";

export { isStatsFile } from "./contract";

export interface Loaded {
  stats: StatsFile | null;
  /** Why real statistics are unavailable. No invented statistics are substituted. */
  fallback: string | null;
}

export async function loadStats(fetcher: typeof fetch = fetch, url = "/data/stats.json"): Promise<Loaded> {
  try {
    const response = await fetcher(url, { headers: { accept: "application/json" }, cache: "no-cache" });
    if (!response.ok) return { stats: null, fallback: `stats.json no disponible (${response.status})` };
    // pages answers unknown paths with index.html and a 200, so check the type too
    if (!(response.headers.get("content-type") ?? "").includes("json")) {
      return { stats: null, fallback: "todavía no hay estadísticas publicadas" };
    }
    const body: unknown = await response.json();
    if (!isStatsFile(body)) return { stats: null, fallback: "stats.json con formato desconocido" };
    return { stats: body, fallback: null };
  } catch {
    return { stats: null, fallback: "no se pudo leer stats.json" };
  }
}
