// contract for public/data/stats.json, written by `python -m src.artwork.export_frontend`.
// schema_version 1; invalid or unpublished data produces an unavailable state.
// fields marked optional are additions the exporter emits and the site can live without.

export type Source = "gold" | "mock";

export interface YearStat {
  year: number;
  scrobbles: number;
  artists: number;
  tracks: number;
  top_artist: string | null;
  /** partial tracking era, or a calendar year the data does not fully cover */
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

export interface Cover {
  url: string;
  provider: "coverartarchive" | "deezer";
  /** page to link back to (musicbrainz release or deezer album) */
  source_url: string;
  attribution: string;
}

export interface TrackStat {
  title: string;
  artist: string;
  scrobbles: number;
  /** cover of the album the track is mostly played from */
  image?: string | null;
}

export interface AlbumStat {
  key: string;
  title: string;
  artist: string;
  scrobbles: number;
  image?: string | null;
  /** null until the album is resolved in the artwork catalog */
  cover: Cover | null;
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
  data_as_of?: string;
  range: { first: string; last: string };
  totals: { scrobbles: number; artists: number; tracks: number; active_days: number; albums?: number };
  years: YearStat[];
  months: MonthStat[];
  top_artists: ArtistStat[];
  top_tracks: TrackStat[];
  top_albums?: AlbumStat[];
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
