import { useEffect, useState } from "react";
import { Sources } from "./components/Icons";
import { NowPlayingHero } from "./components/NowPlayingHero";
import { PreviewProvider } from "./components/PreviewPlayer";
import { loadInsights } from "./data/insights";
import { loadStats, type Loaded } from "./data/load";
import { loadRecent, type RecentState } from "./data/recent";
import { loadExplore, type ExploreFile } from "./data/explore";
import type { InsightsFile, NowPlaying } from "./data/types";
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
] as const;

export function App() {
  const route = useRoute();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [insights, setInsights] = useState<InsightsFile | null>(null);
  const [recent, setRecent] = useState<RecentState>({ status: "loading" });
  const [explore, setExplore] = useState<ExploreFile | null>(null);
  const nowPlaying = useNowPlaying();

  useEffect(() => {
    void loadStats().then(setLoaded);
    void loadInsights().then(setInsights);
    void loadRecent().then(setRecent);
    void loadExplore().then(setExplore);
  }, []);

  const stats = loaded?.stats ?? null;
  const live = nowPlaying?.source === "lastfm" && nowPlaying.track ? nowPlaying : null;
  const last = recent.status === "ready" ? recent.data.last_scrobble : null;
  // last.fm's live api sometimes fails; then show the last scrobble the pipeline processed, labelled as such
  const fallbackTrack: NowPlaying | null = !live && last ? {
    playing: false, source: "lastfm", played_at: Math.floor(Date.parse(last.played_at) / 1000),
    track: { title: last.title, artist: last.artist, album: last.album, image: last.cover?.url ?? null, url: null },
  } : null;

  return (
    <PreviewProvider><div className="archive-shell mx-auto max-w-[1320px] px-5 md:px-10 lg:px-16">
      <header className="archive-topbar flex flex-wrap items-center justify-between gap-x-6 gap-y-4 py-6">
        {route.page !== "home" && <Link href="/" className="archive-nav-link text-xs">inicio</Link>}
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
                <div><h1 id="archive-title" className="archive-main-title">e</h1><p className="archive-subtitle">lo que escucho</p></div>
                <img className="archive-masthead-photo" src="/img/diego.jpg" width={720} height={621}
                  alt="diego maradona sentado en el piso con auriculares, rodeado de discos de vinilo" />
              </div>
            </section>
            {live ? <NowPlayingHero data={live} /> : fallbackTrack && <NowPlayingHero data={fallbackTrack} fallback />}
            {!loaded && <p role="status" className="py-24 text-sm text-muted">cargando…</p>}
            {loaded && !stats && (
              <section className="archive-empty">
                <h2>todavía no hay datos publicados.</h2>
              </section>
            )}
            {stats && <Home stats={stats} insights={insights} recent={recent} explore={explore} />}
            <About stats={stats} insights={insights} />
          </>
        )}
        {route.page === "artists" && <Artists insights={insights} />}
        {route.page === "artist" && <Artist slug={route.slug} insights={insights} />}
      </main>

      <footer className="archive-footer">
        <div className="footer-project">
          {stats && <span>actualizado {shortDate(stats.data_as_of ?? stats.generated_at)}</span>}
        </div>
        <nav className="footer-links" aria-label="enlaces del proyecto">
          <a href="https://github.com/deadour/lastfm-data-platform" target="_blank" rel="noreferrer">código en github ↗</a>
          <span className="footer-sources"><Sources /></span>
        </nav>
        <a href="https://eduramirez.dev" className="archive-portfolio">
          <span>otros proyectos</span>
          <strong>eduramirez.dev ↗</strong>
        </a>
      </footer>
    </div></PreviewProvider>
  );
}
