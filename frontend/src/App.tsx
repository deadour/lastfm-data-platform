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
import { n, shortDate } from "./utils/format";
import { useNowPlaying } from "./utils/useNowPlaying";

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

  const stats = loaded?.stats ?? null;
  const liveTrack = nowPlaying?.source === "lastfm" ? nowPlaying : null;

  return (
    <div className="archive-shell mx-auto max-w-[1440px] px-5 md:px-10 lg:px-16">
      <header className="archive-topbar flex flex-wrap items-center justify-between gap-x-6 gap-y-4 py-6">
        <a href="/" className="archive-wordmark" aria-label="fm, inicio">fm<span className="archive-wordmark-dot">.</span></a>
        <nav aria-label="archivo" className="flex flex-wrap gap-x-5 gap-y-2 text-xs md:gap-x-7">
          {nav.map(([label, href]) => (
            <a key={href} href={href} className="archive-nav-link">{label}</a>
          ))}
        </nav>
        <a href="https://www.last.fm/user/eduramirez87" target="_blank" rel="noreferrer" className="archive-external text-xs">
          last.fm ↗
        </a>
      </header>

      <main>
        <section className="archive-masthead" aria-labelledby="archive-title">
          <div className="archive-masthead-meta">
            <span>eduramirez87 / archivo personal</span>
            <span>música escuchada, no recomendada.</span>
          </div>
          <h1 id="archive-title" className="archive-main-title">lo que<br /><em>suena.</em></h1>
          <div className="archive-masthead-bottom">
            <p>un registro de lo que escuché. artistas, discos y épocas que fueron quedando.</p>
            <span>↘ explorá el archivo</span>
          </div>
        </section>

        {liveTrack?.track && (
          <section className="archive-live">
            <div className="archive-section-flag"><span>en este momento</span><span>señal en vivo</span></div>
            <NowPlayingHero data={liveTrack} />
          </section>
        )}

        {!loaded && (
          <div role="status" className="archive-empty">
            <span className="archive-kicker">archivo / cargando</span>
            <p>buscando los registros…</p>
          </div>
        )}

        {loaded && !stats && (
          <section className="archive-empty" aria-labelledby="archive-unavailable">
            <span className="archive-kicker">archivo / sin publicar</span>
            <h2 id="archive-unavailable">los datos todavía no están acá.</h2>
            <p>la web ya está online. falta publicar la primera exportación del historial.</p>
            <a href="https://www.last.fm/user/eduramirez87" target="_blank" rel="noreferrer">mientras tanto, mi last.fm ↗</a>
          </section>
        )}

        {stats && (
          <>
            <div className="archive-ledger" aria-label="resumen del archivo">
              <div><span>escuchas registradas</span><strong>{n(stats.totals.scrobbles)}</strong></div>
              <div><span>artistas</span><strong>{n(stats.totals.artists)}</strong></div>
              <div><span>canciones</span><strong>{n(stats.totals.tracks)}</strong></div>
              <div><span>desde</span><strong>{shortDate(stats.range.first)}</strong></div>
            </div>

            {stats.top_albums && stats.top_albums.length > 0 && (
              <Section id="discos" title="discos" note="los que siempre vuelven.">
                <Albums albums={stats.top_albums} />
              </Section>
            )}
            <Section id="anos" title="el paso de los años" note="cada año tiene su propia banda sonora.">
              <Years years={stats.years} />
            </Section>
            <Section id="meses" title="mes a mes">
              <Months months={stats.months} />
            </Section>
            <Section id="artistas" title="los de siempre">
              <Artists artists={stats.top_artists} />
            </Section>
            <Section id="canciones" title="en repetición">
              <Tracks tracks={stats.top_tracks} />
            </Section>
            <Section id="ritmo" title="a qué hora suena" note="distribución de escuchas registradas, en utc.">
              <Rhythm cells={stats.rhythm} />
            </Section>
          </>
        )}
      </main>

      <footer className="archive-footer">
        <span>fm. / eduramirez87</span>
        <span>{stats ? `archivo actualizado: ${shortDate(stats.data_as_of ?? stats.generated_at)}` : "un archivo en construcción"}</span>
        <a href="https://github.com/deadour/lastfm-data-platform" target="_blank" rel="noreferrer">cómo está hecho ↗</a>
      </footer>
    </div>
  );
}
