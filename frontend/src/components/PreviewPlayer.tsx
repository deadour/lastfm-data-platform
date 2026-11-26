import { t as translate } from "../i18n";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadArtist } from "../data/insights";
import { spotifyUrl, youtubeUrl } from "../utils/listen";
import type { AlbumStat, TrackStat } from "../data/types";

// one persistent <audio> behind a fixed dock with our own controls.
// sound starts only after a tap. mobile browsers may require a second tap once
// an asynchronously looked-up preview URL becomes ready. the dock exposes
// that action instead of hiding playback failures.

interface Selection { artist: string; title: string; status: "loading" | "ready" | "unavailable" | "error"; url?: string; source?: string; provider?: string; note?: string }
interface Context {
  /** title optional: without it, my most played song by that artist (or any playable one) */
  play: (artist: string, title?: string, slug?: string | null, albumKey?: string | null) => void;
  playQueue: (tracks: { artist: string; title: string }[]) => void;
  selection: Selection | null;
  playing: boolean;
  enabled: boolean;
  /** something I listen to, at random */
  random: () => void;
}
const PreviewContext = createContext<Context | null>(null);

const SILENCE = "/silence.wav";
const ALLOWED = (u: URL) => u.protocol === "https:" && !u.username && !u.password && !u.port &&
  (u.hostname.endsWith(".dzcdn.net") || u.hostname === "audio-ssl.itunes.apple.com" || u.hostname.endsWith(".mzstatic.com"));

const fold = (v: string) => v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\(.*?\)|\[.*?\]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** browser-side fallback: apple's search api allows cors, and answers browsers when it ignores cloudflare */
async function applePreview(artist: string, title: string) {
  const url = new URL("https://itunes.apple.com/search");
  url.search = new URLSearchParams({ term: `${artist} ${title}`.trim(), entity: "song", media: "music", limit: "25" }).toString();
  const response = await fetch(url.href, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) return null;
  const body = await response.json() as { results?: { artistName?: string; trackName?: string; previewUrl?: string; trackViewUrl?: string }[] };
  const results = title ? (body.results ?? []) : shuffle(body.results ?? []);
  for (const r of results) {
    if (!r.artistName || !r.trackName || !r.previewUrl) continue;
    if (![r.artistName, r.artistName.split(",")[0]].some((a) => fold(a) === fold(artist))) continue;
    if (title && fold(r.trackName) !== fold(title)) continue;
    return { url: r.previewUrl, source_url: r.trackViewUrl, provider: "apple", title: r.trackName };
  }
  return null;
}

type Found = { url: string; source_url?: string; provider?: string; title?: string };

/** the site's function first, then apple straight from the browser */
async function findPreview(artist: string, title: string): Promise<Found | null> {
  // apple first: its audio allows cors, so the visualizer can read the real sound
  const apple = await applePreview(artist, title).catch(() => null);
  if (apple) {
    const url = new URL(apple.url);
    if (ALLOWED(url)) return { ...apple, url: url.href };
  }
  try {
    const query: Record<string, string> = title ? { artist, title } : { artist };
    const response = await fetch(`/api/preview?${new URLSearchParams(query)}`, { signal: AbortSignal.timeout(6000) });
    if (response.ok) {
      const data = await response.json() as { preview?: Found | null };
      const url = data?.preview?.url ? new URL(data.preview.url) : null;
      if (url && ALLOWED(url)) return { ...data.preview!, url: url.href };
    }
  } catch { /* nothing else to try */ }
  return null;
}

let lastSong = "";
let slugCache: Map<string, string> | null = null;
async function slugFor(artist: string): Promise<string | null> {
  if (!slugCache) {
    try {
      const body = await (await fetch("/data/insights.json")).json() as { artists?: { name: string; slug: string }[] };
      slugCache = new Map((body.artists ?? []).map((a) => [fold(a.name), a.slug]));
    } catch { slugCache = new Map(); }
  }
  return slugCache.get(fold(artist)) ?? null;
}

const shuffle = <T,>(list: T[]) => [...list].sort(() => Math.random() - .5);

const clock = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

export function PreviewProvider({ children, artists = [], albums = [], tracks = [] }: { children: ReactNode; artists?: { name: string; slug: string }[]; albums?: AlbumStat[]; tracks?: TrackStat[] }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [playing, setPlaying] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [requiresTap, setRequiresTap] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const [shuffled, setShuffled] = useState(true);
  const queue = useRef<{ artist: string; title: string }[]>([]);
  const queueScope = useRef<{ slug: string | null; albumKey: string | null }>({ slug: null, albumKey: null });
  const playedInQueue = useRef(new Set<string>());
  const customQueue = useRef(false);
  const playedAcrossQueues = useRef(new Set<string>());
  const [time, setTime] = useState({ current: 0, duration: 30 });
  const sequence = useRef(0);
  const audio = useRef<HTMLAudioElement>(null);
  // Keep non-CORS providers outside the Web Audio graph to avoid silent playback.
  const plainAudio = useRef<HTMLAudioElement>(null);
  const activeAudio = useRef<HTMLAudioElement | null>(null);
  const touchAudio = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const preferredAudio = () => touchAudio() ? plainAudio.current ?? audio.current : audio.current;
  const audioContext = useRef<AudioContext | null>(null);
  useEffect(() => () => { void audioContext.current?.close(); }, []);

  const unlock = (el: HTMLAudioElement) => {
    el.pause();
    el.src = SILENCE;
    void el.play().catch(() => {});
  };

  const toggle = () => {
    const el = activeAudio.current ?? preferredAudio();
    if (!el) return;
    if (el.paused) {
      void audioContext.current?.resume();
      void el.play().then(() => setRequiresTap(false)).catch(() => {
        setPlaying(false);
        setRequiresTap(true);
      });
    } else el.pause();
  };

  const play = (artist: string, title = "", slug: string | null = null, albumKey: string | null = null, continuation = false) => {
    const el = preferredAudio();
    if (!el) return;
    setEnabled(true); // a tap on anything playable opens the dock
    setRequiresTap(false);
    if (!continuation && selection?.artist === artist && title && selection.title === title && selection.status === "ready" && queueScope.current.albumKey === albumKey) {
      toggle();
      return;
    }
    const current = ++sequence.current;
    if (!continuation) customQueue.current = false;
    // Mobile Safari can suspend Web Audio; use native HTMLAudioElement there.
    if (!touchAudio() && audio.current) wire(audio.current);
    if (!touchAudio()) void audioContext.current?.resume();
    unlock(el); // gesture-bound best effort; a retry control handles mobile restrictions
    setPlaying(false);
    setTime({ current: 0, duration: 30 });
    setSelection({ artist, title: title || "…", status: "loading" });
    void (async () => {
      try {
        // no song given: my most played one by this artist, from my own archive
        let song = title;
        if (!continuation && albumKey) {
          const album = albums.find((a) => a.key === albumKey);
          queue.current = (album?.details?.tracks ?? []).map((track) => ({ artist, title: track.title }));
          queueScope.current = { slug: null, albumKey };
        } else if (!continuation && (slug || !song)) {
          const mine = slug ?? await slugFor(artist);
          const tops = mine ? (await loadArtist(mine))?.top_tracks.map((t) => t.title) ?? [] : [];
          if (current !== sequence.current) return;
          queue.current = tops.map((title) => ({ artist, title }));
          queueScope.current = { slug: mine, albumKey: null };
        } else if (!continuation && !(queueScope.current.albumKey && queue.current.some((track) => track.artist === artist && track.title === song))) {
          queue.current = tracks.map((track) => ({ artist: track.artist, title: track.title }));
          queueScope.current = { slug: null, albumKey: null };
        }
        if (!song) {
          const pool = queue.current.filter((track) => track.artist === artist && track.title !== lastSong);
          const chosen = shuffled ? pool[Math.floor(Math.random() * pool.length)] : pool[0];
          song = chosen?.title ?? queue.current[0]?.title ?? "";
        }
        if (!continuation) playedInQueue.current.clear();
        if (song) lastSong = song;
        if (current !== sequence.current) return;
        // never leave it silent: the song, then anything by the artist, then something else I listen to a lot
        const attempts: [string, string][] = [];
        if (song) attempts.push([artist, song]);
        if (albumKey || customQueue.current) {
          for (const track of queue.current) if (track.title !== song || track.artist !== artist) attempts.push([track.artist, track.title]);
        } else attempts.push([artist, ""]);
        for (const [who, what] of attempts.slice(0, 6)) {
          const found = await findPreview(who, what);
          if (current !== sequence.current) return;
          if (!found) continue;
          playedInQueue.current.add(`${who}\0${what || found.title || ""}`);
          const heard = `${fold(who)}\0${fold(what || found.title || "")}`;
          playedAcrossQueues.current.delete(heard);
          playedAcrossQueues.current.add(heard);
          if (playedAcrossQueues.current.size > 500) playedAcrossQueues.current.delete(playedAcrossQueues.current.values().next().value!);
          const exact = !title || (who === artist && what === title);
          setSelection({ artist: who, title: what || found.title || "", status: "ready", url: found.url,
            source: found.source_url, provider: found.provider,
            note: exact ? undefined : translate("no encontré ese fragmento; suena otra canción de esta selección") });
          const needsProxy = new URL(found.url).hostname.endsWith(".dzcdn.net");
          const target = preferredAudio();
          if (!target) return;
          audio.current?.pause();
          plainAudio.current?.pause();
          activeAudio.current = target;
          target.volume = volume;
          delete target.dataset.directRetry;
          target.src = needsProxy ? `/api/audio?${new URLSearchParams({ url: found.url })}` : found.url;
          void target.play().then(() => setRequiresTap(false)).catch(() => {
            setPlaying(false);
            // iOS may block play() after async preview lookup.
            // The URL is ready, so the next direct tap on ▶ can start it.
            setRequiresTap(true);
          });
          return;
        }
        el.pause();
        setSelection({ artist, title: song || "…", status: "unavailable" });
      } catch {
        if (current === sequence.current) setSelection({ artist, title: title || "…", status: "error" });
      }
    })();
  };

  useEffect(() => {
    const onArtist = (event: Event) => {
      const slug = (event as CustomEvent<string>).detail;
      const artist = artists.find((a) => a.slug === slug);
      if (artist && !(playing && selection?.artist === artist.name && !queueScope.current.albumKey)) play(artist.name, "", artist.slug);
    };
    const onAlbum = (event: Event) => {
      const album = albums.find((a) => a.key === (event as CustomEvent<string>).detail);
      if (album) play(album.artist, "", null, album.key);
    };
    window.addEventListener("fm:artist-navigation", onArtist);
    window.addEventListener("fm:album-navigation", onAlbum);
    return () => { window.removeEventListener("fm:artist-navigation", onArtist); window.removeEventListener("fm:album-navigation", onAlbum); };
  });

  const analyser = useRef<AnalyserNode | null>(null);
  const bars = useRef<HTMLDivElement>(null);
  const wire = (el: HTMLAudioElement) => {
    if (analyser.current || typeof AudioContext === "undefined") return;
    try {
      const ctx = new AudioContext();
      const node = ctx.createAnalyser();
      node.fftSize = 256;
      node.smoothingTimeConstant = 0.55;
      ctx.createMediaElementSource(el).connect(node);
      node.connect(ctx.destination);
      analyser.current = node;
      audioContext.current = ctx;
    } catch { /* no analyser: the bars just idle */ }
  };

  useEffect(() => {
    if (!playing || !selection) return;
    // a colour per song; the page tint breathes with the volume
    let h = 0;
    for (const ch of selection.artist + selection.title) h = (h * 31 + ch.charCodeAt(0)) % 360;
    const root = document.documentElement;
    root.style.setProperty("--tint-h", String(h));
    const data = new Uint8Array(128);
    // log-spaced bins so the bars cover bass to treble, not just the bass
    const pick = Array.from({ length: 12 }, (_, i) => Math.min(127, Math.round(2 * Math.pow(28, i / 11))));
    let frame = 0;
    let last = 0;
    const shown = new Array(12).fill(0);
    let bassAvg = 0, beat = 0, lastBeat = 0;
    const tick = (now: number) => {
      const node = analyser.current;
      if (node && now - last > 66) {
        last = now;
        node.getByteFrequencyData(data);
        const cells = bars.current?.children;
        if (cells) for (let i = 0; i < cells.length; i++) {
          const floor = 85 - i * 5; const v = Math.max(0, (data[pick[i]] - floor) / (255 - floor)); // drop the always-on floor so the beat shows
          const target = Math.pow(v, 1.6) * 100;
          shown[i] = target > shown[i] ? target : Math.max(target, shown[i] - 9); // jump up, fall slowly
          (cells[i] as HTMLElement).style.height = `${Math.max(6, Math.round(shown[i] / 12.5) * 12.5)}%`; // 8 steps, blocky
        }
        const energy = data.slice(1, 12).reduce((a, b) => a + b, 0) / (11 * 255);
        // beat: the bass jumps well above its recent average
        const bass = (data[1] + data[2] + data[3] + data[4]) / (4 * 255);
        bassAvg = bassAvg * 0.9 + bass * 0.1;
        if (bass > bassAvg * 1.18 && bass > 0.35 && now - lastBeat > 220) { beat = 1; lastBeat = now; }
        else beat = Math.max(0, beat - 0.22);
        root.style.setProperty("--tint-a", (energy * 0.25 + beat * 0.3).toFixed(3));
        root.style.setProperty("--beat", beat.toFixed(2));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); root.style.setProperty("--tint-a", "0"); root.style.setProperty("--beat", "0");
      if (bars.current) for (const cell of bars.current.children) (cell as HTMLElement).style.height = "6%";
    };
  }, [playing, selection]);

  const [volume, setVolume] = useState(0.8);
  useEffect(() => { if (audio.current) audio.current.volume = volume; if (plainAudio.current) plainAudio.current.volume = volume; }, [volume, selection?.url]);
  // what played before, to go back
  const history = useRef<{ artist: string; title: string; slug: string | null; albumKey: string | null }[]>([]);
  useEffect(() => {
    if (selection?.status !== "ready") return;
    const last = history.current[history.current.length - 1];
    if (!last || last.artist !== selection.artist || last.title !== selection.title) history.current.push({ artist: selection.artist, title: selection.title, ...queueScope.current });
  }, [selection]);
  const back = () => {
    if (history.current.length < 2) { const el = activeAudio.current; if (el) el.currentTime = 0; return; }
    history.current.pop();
    const prev = history.current.pop()!;
    play(prev.artist, prev.title, prev.slug, prev.albumKey);
  };

  const random = async () => {
    const pool = tracks.filter((track) => track.title !== selection?.title || track.artist !== selection?.artist);
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    if (chosen) { queueScope.current = { slug: null, albumKey: null }; play(chosen.artist, chosen.title); }
  };

  const next = async () => {
    const list = queue.current.length ? queue.current : tracks;
    if (!list.length) return;
    const index = list.findIndex((track) => track.artist === selection?.artist && track.title === selection?.title);
    let candidates = list.filter((track, i) => i !== index && !playedInQueue.current.has(`${track.artist}\0${track.title}`) &&
      (!customQueue.current || !playedAcrossQueues.current.has(`${fold(track.artist)}\0${fold(track.title)}`)));
    if (!candidates.length) {
      playedInQueue.current.clear();
      candidates = list.filter((track, i) => i !== index && (!customQueue.current || !playedAcrossQueues.current.has(`${fold(track.artist)}\0${fold(track.title)}`)));
      if (!candidates.length) candidates = list.filter((_, i) => i !== index);
    }
    const chosen = shuffled ? candidates[Math.floor(Math.random() * candidates.length)] ?? list[0] : list[(index + 1) % list.length];
    play(chosen.artist, chosen.title, queueScope.current.slug, queueScope.current.albumKey, true);
  };
  const playQueue = (tracks: { artist: string; title: string }[]) => {
    if (!tracks.length) return;
    let fresh = tracks.filter((track) => !playedAcrossQueues.current.has(`${fold(track.artist)}\0${fold(track.title)}`));
    if (!fresh.length) fresh = tracks.filter((track) => track.artist !== selection?.artist || track.title !== selection?.title);
    if (!fresh.length) fresh = tracks;
    const chosen = shuffled ? fresh[Math.floor(Math.random() * fresh.length)] : fresh[0];
    queue.current = tracks;
    queueScope.current = { slug: null, albumKey: null };
    playedInQueue.current.clear();
    customQueue.current = true;
    play(chosen.artist, chosen.title, null, null, true);
  };

  const mute = () => {
    sequence.current++;
    audio.current?.pause();
    plainAudio.current?.pause();
    activeAudio.current = null;
    setSelection(null);
    setPlaying(false);
    setRequiresTap(false);
    setEnabled(false);
    setTime({ current: 0, duration: 30 });
  };

  const ready = selection?.status === "ready";
  const progress = time.duration ? Math.min(1, time.current / time.duration) : 0;
  const isSilence = (el: HTMLAudioElement) => el.src.endsWith(SILENCE);
  const display = selection ?? { artist: "e", title: translate("elegí un tema"), status: "idle" };
  const contextValue = useMemo<Context>(() => ({ play, playQueue, selection, playing, enabled, random: () => void random() }),
    [selection, playing, enabled, volume, shuffled, tracks, albums, artists]);

  return <PreviewContext.Provider value={contextValue}>
    {children}
    {[audio, plainAudio].map((ref, i) => <audio key={i} ref={ref} preload="none" hidden loop={repeat} crossOrigin={i === 0 ? "anonymous" : undefined}
      onPlay={(e) => { if (e.currentTarget === activeAudio.current && !isSilence(e.currentTarget)) { setPlaying(true); setRequiresTap(false); } }}
      onPause={(e) => { if (e.currentTarget === activeAudio.current) setPlaying(false); }}
      onEnded={(e) => { if (e.currentTarget === activeAudio.current && !isSilence(e.currentTarget)) { setPlaying(false); if (autoNext) void next(); } }}
      onTimeUpdate={(e) => { if (e.currentTarget === activeAudio.current && !isSilence(e.currentTarget)) setTime({ current: e.currentTarget.currentTime, duration: e.currentTarget.duration || 30 }); }}
      onError={(e) => {
        const el = e.currentTarget;
        if (el !== activeAudio.current || !ready || !selection) return;
        // A direct audio element does not need CORS. If the proxy failed,
        // use the already validated public Deezer URL as a native fallback.
        if (el === plainAudio.current && selection.provider === "deezer" && selection.url && !el.dataset.directRetry) {
          el.dataset.directRetry = "true";
          el.src = selection.url;
          void el.play().then(() => setRequiresTap(false)).catch(() => setRequiresTap(true));
          return;
        }
        setPlaying(false);
        setSelection({ ...selection, status: "error" });
      }} />)}
    {enabled && <aside className="winamp" aria-label={translate("reproductor de fragmentos")}>
      <div className="wa-titlebar"><span>winamp</span><button type="button" className="wa-x" aria-label={translate("cerrar reproductor")} title={translate("cerrar reproductor")} onClick={mute}>×</button></div>
      <div className="wa-main">
        <div className="wa-display">
          <div className="wa-left">
            <span className="wa-state">{display.status === "loading" ? "…" : playing ? "▶" : "❚❚"}</span>
            <span className="wa-time tabular">{display.status === "loading" ? "--:--" : clock(time.current)}</span>
            <div ref={bars} className="wa-viz" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} />)}</div>
          </div>
          <div className="wa-right">
            <div className="wa-marquee" title={`${display.artist} - ${display.title}`}>
              <span>{display.artist} - {display.title || "…"}{"  ✶  "}{display.artist} - {display.title || "…"}{"  ✶  "}</span>
            </div>
            <div className="wa-vol-row"><span>vol</span><input className="wa-volume" type="range" min={0} max={100} value={Math.round(volume * 100)} aria-label={translate("volumen")}
              style={{ ["--p" as string]: `${volume * 100}%` }} onChange={(e) => setVolume(Number(e.target.value) / 100)} /></div>
            <div className="wa-meta">
              {display.status === "idle" && translate("elegí una canción o tocá shuffle")}
              {selection?.status === "loading" && translate("buscando…")}
              {selection?.status === "unavailable" && <>{translate("sin fragmento · ")}<a href={spotifyUrl(selection.artist, selection.title)} target="_blank" rel="noreferrer">spotify</a> · <a href={youtubeUrl(selection.artist, selection.title)} target="_blank" rel="noreferrer">youtube</a></>}
              {ready && requiresTap && translate("tocá ▶ para escuchar")}
              {ready && !requiresTap && selection?.note}
              {selection?.status === "error" && <>{translate("no se pudo reproducir el fragmento")} · <a href={spotifyUrl(selection.artist, selection.title)} target="_blank" rel="noreferrer">spotify</a> · <a href={youtubeUrl(selection.artist, selection.title)} target="_blank" rel="noreferrer">youtube</a></>}
            </div>
          </div>
        </div>
        <input className="wa-seek" type="range" min={0} max={1000} value={Math.round(progress * 1000)} aria-label={translate("posición del fragmento")}
          disabled={!ready} style={{ ["--p" as string]: `${progress * 100}%` }}
          onChange={(e) => { const el = activeAudio.current; if (el && el.duration) el.currentTime = (Number(e.target.value) / 1000) * el.duration; }} />
        <div className="wa-buttons">
          <button type="button" onClick={back} aria-label={translate("anterior")}>⏮</button>
          <button type="button" onClick={toggle} disabled={!ready} aria-label={playing ? translate("pausar") : translate("reproducir")}>{playing ? "❚❚" : "▶"}</button>
          <button type="button" onClick={() => void next()} aria-label={translate("siguiente tema")}>⏭</button>
          <button type="button" className="wa-mode" aria-label={translate("repetir fragmento")} aria-pressed={repeat} onClick={() => { setRepeat((v) => !v); setAutoNext(false); }} title={translate("repetir este fragmento")}>loop</button>
          <button type="button" className="wa-mode" aria-label={translate("reproducción automática")} aria-pressed={autoNext} onClick={() => { setAutoNext((v) => !v); setRepeat(false); }} title={translate("seguir con el siguiente tema del catálogo")}>auto</button>
          <button type="button" className="wa-shuffle wa-mode" aria-pressed={shuffled} onClick={() => setShuffled((v) => !v)}>shuffle</button>
        </div>
      </div>
    </aside>}
  </PreviewContext.Provider>;
}

export function usePreview() {
  return useContext(PreviewContext);
}

export function PreviewButton({ artist, title, slug, albumKey }: { artist: string; title: string; slug?: string; albumKey?: string }) {
  const context = useContext(PreviewContext);
  if (!context) return null;
  const active = context.selection?.artist === artist && context.selection.title === title;
  const playing = active && context.playing;
  const loading = active && context.selection?.status === "loading";
  return <button type="button" className={`preview-button ${playing ? "on" : ""}`}
    aria-label={translate(`${playing ? translate("pausar") : translate("escuchar un fragmento de")} ${title}, de ${artist}`)}
    title={playing ? translate("pausar") : translate("escuchar")} onClick={() => context.play(artist, title, slug, albumKey)}>
    {loading ? "…" : playing ? "❚❚" : "▶"}
  </button>;
}

/** the song name itself is the play button */
export function PlayableTitle({ artist, title, className = "", slug, albumKey }: { artist: string; title: string; className?: string; slug?: string; albumKey?: string }) {
  const context = useContext(PreviewContext);
  if (!context) return <span className={className}>{title}</span>;
  const playing = context.selection?.artist === artist && context.selection.title === title && context.playing;
  return <button type="button" className={`playable ${playing ? "on" : ""} ${className}`} onClick={() => context.play(artist, title, slug, albumKey)}
    aria-label={translate(`escuchar ${title}, de ${artist}`)}>{title}</button>;
}

/** small header button: plays something I listen to, at random */
export function RandomPlay() {
  const context = useContext(PreviewContext);
  if (!context) return null;
  return <button type="button" className="random-play" onClick={context.random} aria-label={translate("▶ algo al azar")}><span className="random-desktop">{translate("▶ algo al azar")}</span><span className="random-mobile" aria-hidden="true">{translate("▶ azar")}</span></button>;
}
