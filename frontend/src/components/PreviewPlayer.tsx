import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { loadArtist } from "../data/insights";
import { spotifyUrl, youtubeUrl } from "../utils/listen";

// one persistent <audio> behind a fixed dock with our own controls.
// sound starts off; the first tap on the dock (or on anything playable) turns
// it on, and from then on any song, bar, artist or genre plays a fragment.
// the element is unlocked inside the tap with a 50 ms silent clip served from
// this site, so the real preview can start on its own when its url arrives.

interface Selection { artist: string; title: string; status: "loading" | "ready" | "unavailable" | "error"; url?: string; source?: string; provider?: string }
interface Context {
  /** title optional: without it, my most played song by that artist (or any playable one) */
  play: (artist: string, title?: string, slug?: string | null) => void;
  selection: Selection | null;
  playing: boolean;
  enabled: boolean;
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
  for (const r of body.results ?? []) {
    if (!r.artistName || !r.trackName || !r.previewUrl) continue;
    if (![r.artistName, r.artistName.split(",")[0]].some((a) => fold(a) === fold(artist))) continue;
    if (title && fold(r.trackName) !== fold(title)) continue;
    return { url: r.previewUrl, source_url: r.trackViewUrl, provider: "apple", title: r.trackName };
  }
  return null;
}

const clock = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [playing, setPlaying] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState({ current: 0, duration: 30 });
  const sequence = useRef(0);
  const audio = useRef<HTMLAudioElement>(null);

  const unlock = (el: HTMLAudioElement) => {
    el.pause();
    el.src = SILENCE;
    void el.play().catch(() => {});
  };

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  };

  const play = (artist: string, title = "", slug: string | null = null) => {
    const el = audio.current;
    if (!el) return;
    setEnabled(true); // a tap on anything playable turns sound on
    if (selection?.artist === artist && (!title || selection.title === title) && selection.status === "ready") {
      toggle();
      return;
    }
    const current = ++sequence.current;
    unlock(el); // still inside the tap
    setPlaying(false);
    setTime({ current: 0, duration: 30 });
    setSelection({ artist, title: title || "…", status: "loading" });
    void (async () => {
      try {
        // no song given: my most played one by this artist, from my own archive
        let song = title;
        if (!song && slug) { const tops = (await loadArtist(slug))?.top_tracks ?? []; song = tops[Math.floor(Math.random() * tops.length)]?.title ?? ""; }
        if (current !== sequence.current) return;
        const query: Record<string, string> = song ? { artist, title: song } : { artist };
        const response = await fetch(`/api/preview?${new URLSearchParams(query)}`, { signal: AbortSignal.timeout(8000) });
        let data: { preview?: { url?: string; source_url?: string; provider?: string; title?: string } | null } = { preview: null };
        if (response.ok) data = await response.json();
        if (!data?.preview?.url) data = { preview: await applePreview(artist, song).catch(() => null) };
        if (current !== sequence.current) return;
        const url = data?.preview?.url ? new URL(data.preview.url) : null;
        if (!url || !ALLOWED(url)) {
          el.pause();
          setSelection({ artist, title: song || "algo de este artista", status: "unavailable" });
          return;
        }
        setSelection({ artist, title: song || data.preview?.title || "", status: "ready", url: url.href,
          source: data.preview?.source_url, provider: data.preview?.provider });
        el.src = url.href;
        void el.play().catch(() => setPlaying(false));
      } catch {
        if (current === sequence.current) setSelection({ artist, title: title || "…", status: "error" });
      }
    })();
  };

  const mute = () => {
    sequence.current++;
    audio.current?.pause();
    setSelection(null);
    setPlaying(false);
    setEnabled(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && enabled) mute(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const ready = selection?.status === "ready";
  const progress = time.duration ? Math.min(1, time.current / time.duration) : 0;
  const isSilence = () => audio.current?.src.endsWith(SILENCE) ?? true;

  return <PreviewContext.Provider value={{ play, selection, playing, enabled }}>
    {children}
    <audio ref={audio} preload="none" hidden
      onPlay={() => { if (!isSilence()) setPlaying(true); }}
      onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onTimeUpdate={(e) => { if (!isSilence()) setTime({ current: e.currentTarget.currentTime, duration: e.currentTarget.duration || 30 }); }}
      onError={() => { if (ready) { setPlaying(false); setSelection((s) => (s ? { ...s, status: "error" } : s)); } }} />
    {selection && <aside className="preview-player on" aria-label="reproductor de fragmentos">
          <button type="button" className="preview-main" onClick={toggle} disabled={!ready} aria-label={playing ? "pausar" : "reproducir"}>
            {selection?.status === "loading" ? <span className="preview-spinner" aria-hidden /> : playing ? "❚❚" : "▶"}
          </button>
          <div className="preview-body">
            <div className="preview-description"><strong>{selection.title}</strong><span>{selection.artist}</span></div>
            {ready && (
              <div className="preview-timeline">
                <input type="range" min={0} max={1000} value={Math.round(progress * 1000)} aria-label="posición del fragmento"
                  style={{ ["--p" as string]: `${progress * 100}%` }}
                  onChange={(e) => { const el = audio.current; if (el && el.duration) el.currentTime = (Number(e.target.value) / 1000) * el.duration; }} />
                <span className="tabular">{clock(time.current)} / {clock(time.duration)}</span>
              </div>
            )}
            {selection?.status === "loading" && <p role="status">buscando un fragmento…</p>}
            {selection?.status === "unavailable" && <p role="status">no encontré un fragmento · <a href={spotifyUrl(selection.artist, selection.title)} target="_blank" rel="noreferrer">spotify ↗</a> · <a href={youtubeUrl(selection.artist, selection.title)} target="_blank" rel="noreferrer">youtube ↗</a></p>}
            {selection?.status === "error" && <p role="status">no cargó · <button onClick={() => play(selection.artist, selection.title)}>probar de nuevo</button></p>}
          </div>
          <div className="preview-side">
            {ready && selection?.source && <a href={selection.source} target="_blank" rel="noreferrer">{selection.provider === "apple" ? "apple music ↗" : "deezer ↗"}</a>}
            <button type="button" className="preview-close" aria-label="cerrar" onClick={mute}>×</button>
          </div>
    </aside>}
  </PreviewContext.Provider>;
}

export function usePreview() {
  return useContext(PreviewContext);
}

export function PreviewButton({ artist, title }: { artist: string; title: string }) {
  const context = useContext(PreviewContext);
  if (!context) return null;
  const active = context.selection?.artist === artist && context.selection.title === title;
  const playing = active && context.playing;
  const loading = active && context.selection?.status === "loading";
  return <button type="button" className={`preview-button ${playing ? "on" : ""}`}
    aria-label={`${playing ? "pausar" : "escuchar un fragmento de"} ${title}, de ${artist}`}
    title={playing ? "pausar" : "escuchar"} onClick={() => context.play(artist, title)}>
    {loading ? "…" : playing ? "❚❚" : "▶"}
  </button>;
}

/** the song name itself is the play button */
export function PlayableTitle({ artist, title, className = "" }: { artist: string; title: string; className?: string }) {
  const context = useContext(PreviewContext);
  if (!context) return <span className={className}>{title}</span>;
  const playing = context.selection?.artist === artist && context.selection.title === title && context.playing;
  return <button type="button" className={`playable ${playing ? "on" : ""} ${className}`} onClick={() => context.play(artist, title)}
    aria-label={`escuchar ${title}, de ${artist}`}>{title}</button>;
}
