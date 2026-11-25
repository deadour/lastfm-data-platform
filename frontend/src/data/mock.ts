import type { NowPlaying, StatsFile } from "./types";

// invented data so the layout can be built before real stats are exported.
// every artist, album and track name here is fictional; no covers are used.

const artists = [
  "los años luz", "marea baja", "cine vacío", "la siesta eléctrica", "norte frío",
  "ruido de fondo", "casa tomada", "verano en mayo", "los invisibles", "planta baja",
  "ciudad dormida", "la última ronda",
];

const albums: [string, string][] = [
  ["verano largo", "marea baja"], ["autopista", "los años luz"], ["sala tres", "cine vacío"],
  ["siesta", "la siesta eléctrica"], ["ruta 40", "norte frío"], ["interferencia", "ruido de fondo"],
  ["el pasillo", "casa tomada"], ["abrigo", "verano en mayo"], ["sin nombre", "los invisibles"],
  ["ascensor", "planta baja"], ["luces bajas", "ciudad dormida"], ["cierre", "la última ronda"],
];

const tracks: [string, string][] = [
  ["once de la noche", "marea baja"], ["la curva", "los años luz"], ["butaca", "cine vacío"],
  ["ventilador", "la siesta eléctrica"], ["escarcha", "norte frío"], ["estática", "ruido de fondo"],
  ["la puerta", "casa tomada"], ["mayo", "verano en mayo"], ["nadie", "los invisibles"],
  ["timbre", "planta baja"],
];

function seeded(n: number) {
  const x = Math.sin(n * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

const years = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map((year, i) => {
  const scrobbles = Math.round((year === 2019 ? 900 : 9000) + seeded(i) * 9000);
  return {
    year,
    scrobbles,
    artists: Math.round(scrobbles / 9),
    tracks: Math.round(scrobbles / 3.4),
    top_artist: artists[i % artists.length],
    partial: year === 2019 || year === 2026,
  };
});

const months = Array.from({ length: 24 }, (_, i) => {
  const d = new Date(Date.UTC(2024, 11 + i, 1));
  return {
    month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    scrobbles: Math.round(600 + seeded(i + 40) * 1400),
  };
});

const grid = Array.from({ length: 7 * 24 }, (_, i) => {
  const weekday = Math.floor(i / 24);
  const hour = i % 24;
  const evening = Math.exp(-((hour - 21) ** 2) / 18);
  const morning = Math.exp(-((hour - 9) ** 2) / 10) * (weekday < 5 ? 0.6 : 0.2);
  return { weekday, hour, share: evening + morning + seeded(i) * 0.08 };
});
const gridTotal = grid.reduce((sum, c) => sum + c.share, 0);

export const mockStats: StatsFile = {
  schema_version: 1,
  source: "mock",
  generated_at: "2026-11-25T00:00:00Z",
  data_as_of: "2026-11-25T00:00:00Z",
  range: { first: "2019-03-14", last: "2026-11-25" },
  totals: {
    scrobbles: years.reduce((sum, y) => sum + y.scrobbles, 0),
    artists: 4800,
    tracks: 16000,
    albums: 9000,
    active_days: 2300,
  },
  years,
  months,
  top_artists: artists.map((name, i) => ({ name, scrobbles: Math.round(3200 / (1 + i * 0.35)), image: null })),
  top_albums: albums.map(([title, artist], i) => ({
    key: `mock${String(i).padStart(2, "0")}`,
    artist,
    title,
    scrobbles: Math.round(1400 / (1 + i * 0.3)),
    image: null,
    cover: null,
  })),
  top_tracks: tracks.map(([title, artist], i) => ({
    title,
    artist,
    scrobbles: Math.round(410 / (1 + i * 0.3)),
    image: null,
  })),
  rhythm: grid.map((c) => ({ ...c, share: c.share / gridTotal })),
  longest_streak: { days: 212, start: "2023-04-02", end: "2023-10-30" },
};

export const mockNowPlaying: NowPlaying = {
  playing: true,
  track: { title: "once de la noche", artist: "marea baja", album: "verano largo", image: null, url: null },
  played_at: null,
  source: "mock",
};
