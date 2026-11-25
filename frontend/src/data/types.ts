// contract for public/data/stats.json, written by src/exports/frontend_stats.py.
// bump schema_version on breaking changes; the loader rejects unknown versions.

export type Source = "gold" | "mock";

export interface YearStat {
  year: number;
  scrobbles: number;
  artists: number;
  tracks: number;
  top_artist: string | null;
  /** before consistent tracking started, or the current calendar year */
  partial: boolean;
}

export interface MonthStat {
  /** yyyy-mm */
  month: string;
  scrobbles: number;
}

export interface ArtistStat {
  name: string;
  scrobbles: number;
  image?: string | null;
}

export interface TrackStat {
  title: string;
  artist: string;
  scrobbles: number;
  image?: string | null;
}

export interface RhythmCell {
  /** 0 = monday */
  weekday: number;
  hour: number;
  /** share of scrobbles in the consistent tracking era, 0..1 */
  share: number;
}

export interface StatsFile {
  schema_version: 1;
  source: Source;
  generated_at: string;
  range: { first: string; last: string };
  totals: { scrobbles: number; artists: number; tracks: number; active_days: number };
  years: YearStat[];
  months: MonthStat[];
  top_artists: ArtistStat[];
  top_tracks: TrackStat[];
  rhythm: RhythmCell[];
  longest_streak: { days: number; start: string; end: string } | null;
}

export interface NowPlaying {
  playing: boolean;
  track: { title: string; artist: string; album: string | null; image: string | null; url: string | null } | null;
  /** unix seconds of the last finished scrobble, when not playing */
  played_at: number | null;
  source: "lastfm" | "mock";
}
