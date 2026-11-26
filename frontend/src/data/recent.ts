// /data/recent.json v1, as agreed in frontend/docs/recent-data-contract.md.
// the producer lives in the cloud export; this file only reads and validates it.
// anything that does not match the contract is treated as unavailable, never patched.

export interface RecentCover {
  url: string;
  provider?: string;
  source_url?: string;
  attribution?: string;
}

export interface RecentArtist { name: string; scrobbles: number }
export interface RecentAlbum { artist: string; title: string; scrobbles: number; cover: RecentCover | null }
export interface RecentTrack { artist: string; title: string; scrobbles: number }

export interface Period {
  start: string;
  end_exclusive: string;
  complete: boolean;
  scrobbles: number;
  unique_artists: number;
  unique_tracks: number;
  /** optional: only shown when the export provides it */
  unique_albums?: number;
  top_artists: RecentArtist[];
  top_albums: RecentAlbum[];
  top_tracks: RecentTrack[];
  /** optional marker when tracking coverage is unknown for the period */
  coverage?: number | null;
  status?: string;
}

/** scrobbles is null when the bucket falls outside known tracking: no data, not zero */
export interface DayPoint { date: string; scrobbles: number | null; complete: boolean }
export interface WeekPoint { start: string; scrobbles: number | null; complete: boolean }
export interface MonthPoint { month: string; scrobbles: number | null; complete: boolean }

export type PeriodKey = "today" | "this_week" | "last_week" | "this_month" | "last_month";
export const PERIOD_KEYS: PeriodKey[] = ["today", "this_week", "last_week", "this_month", "last_month"];

export interface LastScrobble { artist: string; title: string; album: string | null; played_at: string; cover: RecentCover | null }

export interface RecentFile {
  schema_version: 1;
  /** last processed scrobble: fallback for the live widget when last.fm is down */
  last_scrobble?: LastScrobble | null;
  coverage_until?: string;
  generated_at: string;
  data_as_of: string;
  timezone: string;
  periods: Record<PeriodKey, Period>;
  series: { days: DayPoint[]; weeks: WeekPoint[]; months: MonthPoint[] };
}

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isoDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isoMonth = (v: unknown) => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const stamp = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));
const countOrNull = (v: unknown) => v === null || count(v);

function httpsUrl(v: unknown): boolean {
  if (!text(v)) return false;
  try {
    const url = new URL(v);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

const cover = (v: unknown) => v === null || (object(v) && httpsUrl(v.url));
// the contract's example uses literal "example" records; they must never be accepted as data
const real = (v: unknown) => text(v) && v.trim().toLowerCase() !== "example";

function isPeriod(v: unknown): v is Period {
  if (!object(v)) return false;
  return isoDate(v.start) && isoDate(v.end_exclusive) && (v.start as string) < (v.end_exclusive as string) &&
    typeof v.complete === "boolean" && count(v.scrobbles) && count(v.unique_artists) && count(v.unique_tracks) &&
    (v.unique_albums === undefined || count(v.unique_albums)) &&
    Array.isArray(v.top_artists) && v.top_artists.length <= 5 &&
    v.top_artists.every((a) => object(a) && real(a.name) && count(a.scrobbles)) &&
    Array.isArray(v.top_albums) && v.top_albums.length <= 5 &&
    v.top_albums.every((a) => object(a) && real(a.artist) && real(a.title) && count(a.scrobbles) && cover(a.cover)) &&
    Array.isArray(v.top_tracks) && v.top_tracks.length <= 5 &&
    v.top_tracks.every((t) => object(t) && real(t.artist) && real(t.title) && count(t.scrobbles));
}

const ascending = (keys: string[]) => keys.every((k, i) => i === 0 || keys[i - 1] < k);

export function isRecentFile(v: unknown): v is RecentFile {
  if (!object(v) || v.schema_version !== 1 || !stamp(v.generated_at) || !stamp(v.data_as_of) || !text(v.timezone)) return false;
  const { periods, series } = v;
  if (!object(periods) || !PERIOD_KEYS.every((key) => isPeriod(periods[key]))) return false;
  if (!object(series) || !Array.isArray(series.days) || !Array.isArray(series.weeks) || !Array.isArray(series.months)) return false;
  const days = series.days, weeks = series.weeks, months = series.months;
  return days.length === 14 && weeks.length === 12 && months.length === 12 &&
    days.every((d) => object(d) && isoDate(d.date) && countOrNull(d.scrobbles) && typeof d.complete === "boolean") &&
    weeks.every((w) => object(w) && isoDate(w.start) && countOrNull(w.scrobbles) && typeof w.complete === "boolean") &&
    months.every((m) => object(m) && isoMonth(m.month) && countOrNull(m.scrobbles) && typeof m.complete === "boolean") &&
    ascending(days.map((d) => (d as DayPoint).date)) && ascending(weeks.map((w) => (w as WeekPoint).start)) &&
    ascending(months.map((m) => (m as MonthPoint).month));
}

export type RecentState =
  | { status: "loading" }
  | { status: "ready"; data: RecentFile }
  | { status: "unavailable"; reason: "not_published" | "invalid" | "network" };

export async function loadRecent(fetcher: typeof fetch = fetch): Promise<RecentState> {
  try {
    const response = await fetcher("/data/recent.json", { headers: { accept: "application/json" }, cache: "no-cache" });
    // pages answers a missing file with index.html and a 200
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("json")) {
      return { status: "unavailable", reason: "not_published" };
    }
    const body: unknown = await response.json();
    return isRecentFile(body) ? { status: "ready", data: body } : { status: "unavailable", reason: "invalid" };
  } catch {
    return { status: "unavailable", reason: "network" };
  }
}

/**
 * like-for-like change for an incomplete week: the elapsed days of this week
 * against the same weekdays of last week, both taken from the 14-day series.
 * null when either side is unknown or the base is zero.
 */
export function weekSoFarChange(data: RecentFile): number | null {
  const week = data.periods.this_week;
  const days = data.series.days;
  const startIndex = days.findIndex((d) => d.date === week.start);
  if (startIndex < 7) return null;
  const current = days.slice(startIndex);
  const previous = days.slice(startIndex - 7, startIndex - 7 + current.length);
  if ([...current, ...previous].some((d) => d.scrobbles === null)) return null;
  const now = current.reduce((sum, d) => sum + (d.scrobbles ?? 0), 0);
  const before = previous.reduce((sum, d) => sum + (d.scrobbles ?? 0), 0);
  return before === 0 ? null : (now - before) / before;
}
