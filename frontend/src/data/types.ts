// contract for public/data/stats.json, written by `python -m src.artwork.export_frontend`.
// schema_version 1; the loader rejects other versions and shows the mock instead.

export type Source = "gold" | "mock";
export type Era = "partial_tracking" | "consistent_tracking";

export interface YearStat {
  year: number;
  scrobbles: number;
  active_days: number;
  artists: number;
  tracks: number;
  top_artist: string | null;
  era: Era;
}

export interface MonthStat {
  /** yyyy-mm */
  month: string;
  scrobbles: number;
}

export interface ArtistStat {
  name: string;
  scrobbles: number;
  first_seen: string;
  last_seen: string;
}

export interface Cover {
  url: string;
  provider: "coverartarchive" | "deezer";
  /** page to link back to (musicbrainz release or deezer album) */
  source_url: string;
  attribution: string;
}

export interface AlbumStat {
  key: string;
  artist: string;
  title: string;
  scrobbles: number;
  /** null until the album is resolved in the artwork catalog */
  cover: Cover | null;
}

export interface TrackStat {
  artist: string;
  title: string;
  scrobbles: number;
  peak_year: number | null;
}

export interface WeekHour {
  /** 0 = monday */
  weekday: number;
  hour: number;
  scrobbles: number;
}

export interface StatsFile {
  schema_version: 1;
  source: Source;
  generated_at: string;
  data_as_of: string;
  notes: { tracking?: string; albums?: string };
  range: { first_day: string; last_day: string };
  totals: { scrobbles: number; artists: number; tracks: number; albums: number; active_days: number };
  years: YearStat[];
  months: MonthStat[];
  top_artists: ArtistStat[];
  top_albums: AlbumStat[];
  top_tracks: TrackStat[];
  week_hours: WeekHour[];
}

export interface NowPlaying {
  playing: boolean;
  track: { title: string; artist: string; album: string | null; image: string | null; url: string | null } | null;
  /** unix seconds of the last finished scrobble, when not playing */
  played_at: number | null;
  source: "lastfm" | "mock";
}
