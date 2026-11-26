import { useEffect, useState } from "react";
import { Sources } from "./components/Icons";
import { NowPlayingHero } from "./components/NowPlayingHero";
import { loadInsights } from "./data/insights";
import { loadStats, type Loaded } from "./data/load";
import { loadRecent, type RecentState } from "./data/recent";
import type { InsightsFile } from "./data/types";
import { About } from "./pages/About";
import { Artist } from "./pages/Artist";
import { Artists } from "./pages/Artists";
import { Home } from "./pages/Home";
import { shortDate } from "./utils/format";
import { Link, useRoute } from "./utils/router";
import { useNowPlaying } from "./utils/useNowPlaying";

const nav = [
  ["últimamente", "/#ultimamente"],
  ["discos", "/#discos"],
  ["artistas", "/artistas"],
  ["sobre", "/como-esta-hecho"],
] as const;

export function App() {
  const route = useRoute();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [insights, setInsights] = useState<InsightsFile | null>(null);
  const [recent, setRecent] = useState<RecentState>({ status: "loading" });
  const nowPlaying = useNowPlaying();

  useEffect(() => {
    void loadStats().then(setLoaded);
    void loadInsights().then(setInsights);
    void loadRecent().then(setRecent);
  }, []);

  const stats = loaded?.stats ?? null;
  const liveTrack = nowPlaying?.source === "lastfm" && nowPlaying.track ? nowPlaying : null;

  return (
    <div className="archive-shell mx-auto max-w-[1320px] px-5 md:px-10 lg:px-16">
      <header className="archive-topbar flex flex-wrap items-center justify-between gap-x-6 gap-y-4 py-6">
        <Link href="/" className="archive-wordmark" aria-label="fm, inicio">fm<span className="archive-wordmark-dot">.</span></Link>
        <nav aria-label="secciones" className="flex flex-wrap gap-x-5 gap-y-2 text-xs md:gap-x-7">
          {nav.map(([label, href]) => (
            <Link key={href} href={href} className="archive-nav-link">{label}</Link>
          ))}
        </nav>
      </header>

      <main>
        {route.page === "home" && (
          <>
            <section className="archive-masthead" aria-labelledby="archive-title">
              <div className="archive-masthead-row">
                <h1 id="archive-title" className="archive-main-title">lo que<br /><em>escucho</em></h1>
                <img className="archive-masthead-photo" src="/img/diego.jpg" width={720} height={621}
                  alt="diego maradona sentado en el piso con auriculares, rodeado de discos de vinilo" />
              </div>
            </section>
            {liveTrack && <NowPlayingHero data={liveTrack} />}
            {!loaded && <p role="status" className="py-24 text-sm text-muted">cargando…</p>}
            {loaded && !stats && (
              <section className="archive-empty">
                <h2>todavía no hay datos publicados.</h2>
              </section>
            )}
            {stats && <Home stats={stats} insights={insights} recent={recent} />}
          </>
        )}
        {route.page === "artists" && <Artists insights={insights} />}
        {route.page === "artist" && <Artist slug={route.slug} insights={insights} />}
        {route.page === "about" && <About stats={stats} insights={insights} />}
      </main>

      <footer className="archive-footer">
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-3">fm. <Sources /></span>
          {stats && <span>actualizado {shortDate(stats.data_as_of ?? stats.generated_at)}</span>}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/como-esta-hecho">cómo está hecho</Link>
          <a href="https://github.com/deadour/lastfm-data-platform" target="_blank" rel="noreferrer">código en github ↗</a>
        </div>
        <a href="https://eduramirez.dev" className="archive-portfolio">
          <span>más cosas mías</span>
          <strong>eduramirez.dev ↗</strong>
        </a>
      </footer>
    </div>
  );
}
