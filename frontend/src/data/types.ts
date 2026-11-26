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
  /** year I played it the most */
  year?: number | null;
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

// insights.json and artists/<slug>.json, written by src/artwork/export_insights.py.

export interface Photo {
  url: string;
  source_url: string;
  attribution: string;
}

export interface ArtistLink {
  slug: string;
  name: string;
  rank: number;
  scrobbles: number;
  peak_year: number;
  photo: Photo | null;
  /** cover of the artist's most played resolved album */
  image: string | null;
}

export interface YearInsight {
  year: number;
  scrobbles: number;
  partial: boolean;
  artists: number;
  new_artists: number;
  top_artist: string;
  top_artist_share: number;
  top_track: { title: string; artist: string; plays: number };
  top_album: { title: string; artist: string; plays: number; cover: Cover | null } | null;
  discovery: { artist: string; plays: number } | null;
}

export interface InsightsFile {
  schema_version: 1;
  generated_at: string;
  /** yyyy-mm, first to last month of the history; artist month series align to it */
  months: string[];
  /** total scrobbles per month, aligned to months */
  monthly: number[];
  first_ever: { title: string; artist: string; date: string; album?: string | null; cover?: Cover | null };
  busiest_day: { date: string; scrobbles: number; top_artist: string };
  obsession: { title: string; artist: string; date: string; plays: number };
  binge: { artist: string; plays: number; date: string };
  session: { date: string; hours: number; plays: number; artists: number; sessions: number; median_plays: number };
  habits: { hours: number[]; weekdays: number[]; peak_hour: number; night_share: number; weekend_share: number; top10_share: number };
  comebacks: { artist: string; gap_days: number; left: string; returned: string; plays_after: number }[];
  phases: { artist: string; year: number; plays: number; share: number }[];
  constants: { artist: string; years: number; plays: number }[];
  years: YearInsight[];
  artists: ArtistLink[];
}

export interface ArtistPage {
  schema_version: 1;
  slug: string;
  name: string;
  rank: number;
  photo: Photo | null;
  scrobbles: number;
  share: number;
  tracks: number;
  albums: number;
  first: { date: string; title: string };
  last: string;
  peak_year: number;
  active_years: number;
  best_day: { date: string; plays: number };
  years: { year: number; scrobbles: number }[];
  months: number[];
  hours: number[];
  top_tracks: { title: string; plays: number }[];
  top_albums: { title: string; plays: number; cover: Cover | null }[];
}
