import { useEffect, useRef, useState } from "react";
import { NowPlayingHero } from "./components/NowPlayingHero";
import { PreviewProvider, RandomPlay } from "./components/PreviewPlayer";
import { loadInsights } from "./data/insights";
import { loadStats, type Loaded } from "./data/load";
import { loadRecent, type RecentState } from "./data/recent";
import { loadExplore, type ExploreFile } from "./data/explore";
import type { InsightsFile, NowPlaying } from "./data/types";
import { About } from "./pages/About";
import { Artist } from "./pages/Artist";
import { Artists } from "./pages/Artists";
import { AlbumsPage } from "./pages/Albums";
import { Album } from "./pages/Album";
import { Songs } from "./pages/Songs";
import { Loading } from "./components/Loading";
import { MastheadCollage } from "./components/MastheadCollage";
import { t as translate, setLanguage, useLanguage } from "./i18n";
import { Home } from "./pages/Home";
import { shortDate } from "./utils/format";
import { Link, navigate, restoreHome, useRoute } from "./utils/router";
import { useNowPlaying } from "./utils/useNowPlaying";
import { scrollToHashWhenSettled } from "./utils/hashScroll";
import { getScrollContainer, readingScrollTop } from "./utils/scrollContainer";

export function App() {
  const language = useLanguage();
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const route = useRoute();
  const masthead = useRef<HTMLDivElement>(null);
  const [pastTitle, setPastTitle] = useState(false);
  const compactHeader = route.page !== "home" || pastTitle;
  useEffect(() => {
    const title = masthead.current;
    if (route.page !== "home" || !title) return;
    const update = () => setPastTitle(title.getBoundingClientRect().bottom <= 0);
    update();
    const observer = new IntersectionObserver(update);
    observer.observe(title);
    return () => observer.disconnect();
  }, [route.page]);
  useEffect(() => {
    let frame = 0;
    const mobile = window.matchMedia("(max-width: 640px)");
    let listening: Window | HTMLElement | null = null;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => document.documentElement.style.setProperty("--scroll", String(Math.round(readingScrollTop()))));
    };
    const bind = () => {
      listening?.removeEventListener("scroll", update);
      listening = getScrollContainer();
      listening.addEventListener("scroll", update, { passive: true });
      update();
    };
    bind();
    mobile.addEventListener("change", bind);
    return () => {
      mobile.removeEventListener("change", bind);
      listening?.removeEventListener("scroll", update);
      cancelAnimationFrame(frame);
    };
  }, []);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [insights, setInsights] = useState<InsightsFile | null>(null);
  const [recent, setRecent] = useState<RecentState>({ status: "loading" });
  const [explore, setExplore] = useState<ExploreFile | null>(null);
  const nowPlaying = useNowPlaying();

  useEffect(() => {
    let cancelScroll = () => {};
    void Promise.allSettled([
      loadStats().then(setLoaded),
      loadInsights().then(setInsights),
      loadRecent().then(setRecent),
      loadExplore().then(setExplore),
    ]).then(() => {
      // sections only exist once the data is in; covers keep shifting the layout after that
      cancelScroll = scrollToHashWhenSettled();
    });
    return () => cancelScroll();
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
    <PreviewProvider artists={insights?.artists} albums={stats?.top_albums} tracks={stats?.top_tracks} genres={explore?.genres?.artists_by_family ?? {}}>
      <div className="app-viewport">
        <div className="e-backdrop" aria-hidden="true" />
        <div className="archive-topbar-slot">
        <header className={`archive-topbar ${compactHeader ? "is-compact" : ""}`}>
          <Link href="/" className="archive-header-logo" aria-label={translate("e · inicio")}>e</Link>
          <nav aria-label={translate("secciones")} className="archive-header-actions">
            <RandomPlay />
            <Link href="/#about" className="archive-nav-link">{translate("sobre este proyecto")}</Link>
            <span className="language-switch" role="group" aria-label={translate("idioma")}>
              <button type="button" lang="es" aria-pressed={language === "es"} onClick={() => setLanguage("es")}>es</button>
              <span aria-hidden="true">/</span>
              <button type="button" lang="en" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>en</button>
            </span>
          </nav>
        </header>
      </div>

      <div id="app-scroll" className="archive-shell mx-auto max-w-[1320px] px-5 md:px-10 lg:px-16">
      <main>
        {route.page === "home" && (
          <>
            <section className="archive-masthead" aria-labelledby="archive-title">
              <div className="archive-masthead-row">
                <div className="masthead-editorial"><MastheadCollage stats={stats} insights={insights} /><div ref={masthead} className="masthead-lettering"><h1 id="archive-title" className="archive-main-title">e</h1></div></div>
                <div className="archive-masthead-photo-wrap">
                  <img className="archive-masthead-photo" src="/img/diego.jpg" width={720} height={621}
                    alt={translate("diego maradona sentado en el piso con auriculares, rodeado de discos de vinilo")} />
                  <p className="archive-subtitle archive-photo-subtitle">{translate("lo que escucho")}</p>
                </div>
              </div>
            </section>
            {live ? <NowPlayingHero data={live} /> : fallbackTrack && <NowPlayingHero data={fallbackTrack} fallback />}
            {!loaded && <Loading />}
            {loaded && !stats && (
              <section className="archive-empty">
                <h2>{translate("todavía no hay datos publicados.")}</h2>
              </section>
            )}
            {stats && <Home stats={stats} insights={insights} recent={recent} explore={explore} />}
            <About stats={stats} insights={insights} />
          </>
        )}
        {route.page !== "home" && (
          <button type="button" className="back-home" onClick={() => { navigate("/"); restoreHome(); }}>{translate("← volver al inicio")}</button>
        )}
        {route.page === "artists" && <Artists insights={insights} />}
        {route.page === "songs" && <Songs stats={stats} />}
        {route.page === "albums" && <AlbumsPage stats={stats} />}
        {route.page === "album" && <Album album={stats?.top_albums?.find((album) => album.key === route.key)} insights={insights} />}
        {route.page === "artist" && <Artist slug={route.slug} insights={insights} />}
      </main>

      <footer className="archive-footer">
        <nav aria-label={translate("catálogo musical")} className="footer-catalog">
          <Link href="/artistas">{translate("artistas")}</Link><Link href="/discos">{translate("discos")}</Link><Link href="/canciones">{translate("canciones")}</Link>
        </nav>
        <div className="footer-project">
          {stats && <span>{translate("actualizado ")}{shortDate(stats.data_as_of ?? stats.generated_at)}</span>}
          <a href="https://github.com/deadour/lastfm-data-platform" target="_blank" rel="noreferrer" className="footer-github" aria-label={translate("código en github")}>
            <img src="/icons/github.svg" width={22} height={22} alt="" />
          </a>
        </div>
        <button type="button" className="footer-return" onClick={() => { navigate("/"); requestAnimationFrame(() => document.getElementById("ultimamente")?.scrollIntoView({ behavior: "smooth" })); }}>{translate(" ↑ ver qué escucho ")}</button>
        <a href="https://eduramirez.dev" className="archive-portfolio"><strong>eduramirez.dev ↗</strong></a>
      </footer>
      </div>
      </div>
    </PreviewProvider>
  );
}
