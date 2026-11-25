import { useEffect, useState } from "react";
import { Albums } from "./components/Albums";
import { Artists } from "./components/Artists";
import { Months } from "./components/Months";
import { NowPlayingHero } from "./components/NowPlayingHero";
import { Rhythm } from "./components/Rhythm";
import { Section } from "./components/Section";
import { Tracks } from "./components/Tracks";
import { Years } from "./components/Years";
import { loadStats, type Loaded } from "./data/load";
import { n, shortDate } from "./lib/format";
import { useNowPlaying } from "./lib/useNowPlaying";

const nav = [
  ["discos", "#discos"],
  ["años", "#anos"],
  ["artistas", "#artistas"],
  ["canciones", "#canciones"],
  ["ritmo", "#ritmo"],
] as const;

export function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const nowPlaying = useNowPlaying();

  useEffect(() => {
    void loadStats().then(setLoaded);
  }, []);

  const stats = loaded?.stats;
  const isMock = stats?.source === "mock";

  return (
    <div className="mx-auto max-w-6xl px-5 md:px-10">
      <header className="flex items-center justify-between py-6 text-sm">
        <a href="/" className="font-serif text-xl text-ink">
          fm
        </a>
        <nav className="flex gap-5 text-muted">
          {nav.map(([label, href]) => (
            <a key={href} href={href} className="transition-colors hover:text-ink">
              {label}
            </a>
          ))}
        </nav>
      </header>

      {isMock && (
        <p role="status" className="border border-line px-4 py-2 text-xs text-muted">
          datos de ejemplo (mock). los nombres son inventados
          {loaded?.fallback ? ` · ${loaded.fallback}` : ""}
        </p>
      )}

      <main>
        <NowPlayingHero data={nowPlaying} />

        {stats && (
          <>
            <p className="max-w-3xl pb-16 font-serif text-2xl leading-snug text-ink/90 md:text-3xl">
              {n(stats.totals.scrobbles)} escuchas desde {shortDate(stats.range.first_day)}: {n(stats.totals.artists)} artistas,{" "}
              {n(stats.totals.albums)} discos y {n(stats.totals.tracks)} canciones, en {n(stats.totals.active_days)} días con música.
            </p>

            <Section id="discos" title="discos" note="los más escuchados. las portadas vienen de cover art archive o deezer, con su crédito.">
              <Albums albums={stats.top_albums} />
            </Section>

            <Section id="anos" title="por año" note="los años incompletos están más claros: antes de 2020 no registraba todo.">
              <Years years={stats.years} lastDay={stats.range.last_day} />
            </Section>

            <Section id="meses" title="últimos meses">
              <Months months={stats.months} />
            </Section>

            <Section id="artistas" title="artistas" note="los que más sonaron desde el principio.">
              <Artists artists={stats.top_artists} />
            </Section>

            <Section id="canciones" title="canciones">
              <Tracks tracks={stats.top_tracks} />
            </Section>

            <Section id="ritmo" title="cuándo escucho" note="día y hora, en utc. más claro, más escuchas.">
              <Rhythm weekHours={stats.week_hours} />
            </Section>
          </>
        )}
      </main>

      <footer className="border-t border-line py-10 text-xs text-muted">
        <p>
          datos de last.fm, procesados en un pipeline propio
          {stats && !isMock ? ` · datos al ${shortDate(stats.data_as_of)}` : ""}.
        </p>
      </footer>
    </div>
  );
}
