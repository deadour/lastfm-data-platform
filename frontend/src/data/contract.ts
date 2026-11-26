import type { StatsFile } from "./types";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const date = (value: unknown): value is string => text(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const timestamp = (value: unknown) => text(value) && Number.isFinite(Date.parse(value));
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key));
const list = (value: unknown, check: (row: unknown) => boolean) => Array.isArray(value) && value.every(check);

function publicUrl(value: unknown, source = false): boolean {
  if (!text(value)) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const approved = source
      ? ["musicbrainz.org", "www.deezer.com", "deezer.com"].includes(host)
      : ["coverartarchive.org", "archive.org", "cdn-images.dzcdn.net", "e-cdns-images.dzcdn.net"].includes(host) || host.endsWith(".archive.org");
    return approved && url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && !url.port;
  } catch {
    return false;
  }
}

const image = (value: unknown) => value === undefined || value === null || publicUrl(value);
const cover = (value: unknown) => value === null || (object(value) &&
  keys(value, ["url", "provider", "source_url", "attribution"]) && publicUrl(value.url) &&
  (value.provider === "coverartarchive" || value.provider === "deezer") &&
  publicUrl(value.source_url, true) && text(value.attribution));

/** Shared by React and the deployment gate; never accepts mock or private fields. */
export function isStatsFile(value: unknown): value is StatsFile {
  if (!object(value) || !keys(value, ["schema_version", "source", "generated_at", "data_as_of", "range", "totals",
    "years", "months", "top_artists", "top_tracks", "top_albums", "rhythm", "longest_streak"])) return false;
  const { range, totals, longest_streak: streak } = value;
  if (value.schema_version !== 1 || value.source !== "gold" || !timestamp(value.generated_at) ||
      (value.data_as_of !== undefined && !timestamp(value.data_as_of)) ||
      !object(range) || !keys(range, ["first", "last"]) || !date(range.first) || !date(range.last) || range.first > range.last ||
      !object(totals) || !keys(totals, ["scrobbles", "artists", "tracks", "active_days", "albums"]) ||
      ![totals.scrobbles, totals.artists, totals.tracks, totals.active_days].every(count) ||
      (totals.albums !== undefined && !count(totals.albums))) return false;
  if (!list(value.years, (r) => object(r) && keys(r, ["year", "scrobbles", "artists", "tracks", "top_artist", "partial"]) &&
      [r.year, r.scrobbles, r.artists, r.tracks].every(count) && typeof r.partial === "boolean" && (r.top_artist === null || text(r.top_artist))) ||
      !list(value.months, (r) => object(r) && keys(r, ["month", "scrobbles"]) && text(r.month) && /^\d{4}-(0[1-9]|1[0-2])$/.test(r.month) && count(r.scrobbles)) ||
      !list(value.top_artists, (r) => object(r) && keys(r, ["name", "scrobbles", "image"]) && text(r.name) && count(r.scrobbles) && image(r.image)) ||
      !list(value.top_tracks, (r) => object(r) && keys(r, ["title", "artist", "scrobbles", "image"]) && text(r.title) && text(r.artist) && count(r.scrobbles) && image(r.image)) ||
      (value.top_albums !== undefined && !list(value.top_albums, (r) => object(r) && keys(r, ["key", "title", "artist", "year", "scrobbles", "image", "cover"]) &&
        (r.year === undefined || r.year === null || count(r.year)) &&
        text(r.key) && text(r.title) && text(r.artist) && count(r.scrobbles) && image(r.image) && cover(r.cover)))) return false;
  if (!Array.isArray(value.rhythm) || value.rhythm.length !== 168) return false;
  const cells = new Set<string>();
  for (const r of value.rhythm) {
    if (!object(r) || !keys(r, ["weekday", "hour", "share"]) || !count(r.weekday) || r.weekday > 6 ||
        !count(r.hour) || r.hour > 23 || typeof r.share !== "number" || !Number.isFinite(r.share) || r.share < 0 || r.share > 1) return false;
    cells.add(`${r.weekday}:${r.hour}`);
  }
  return cells.size === 168 && (streak === null || (object(streak) && keys(streak, ["days", "start", "end"]) &&
    count(streak.days) && date(streak.start) && date(streak.end) && streak.start <= streak.end));
}
