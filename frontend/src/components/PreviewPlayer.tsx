import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { spotifyUrl, youtubeUrl } from "../utils/listen";

interface Selection { artist: string; title: string; status: "loading" | "ready" | "unavailable" | "error"; url?: string; source?: string; provider?: string }
const PreviewContext = createContext<{ play: (artist: string, title: string) => void; selection: Selection | null; playing: boolean } | null>(null);

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [playing, setPlaying] = useState(false);
  const sequence = useRef(0);
  const audio = useRef<HTMLAudioElement>(null);

  const play = async (artist: string, title: string) => {
    if (selection?.artist === artist && selection.title === title && selection.status === "ready" && audio.current) {
      if (audio.current.paused) void audio.current.play().catch(() => setPlaying(false));
      else audio.current.pause();
      return;
    }
    const current = ++sequence.current;
    audio.current?.pause();
    setPlaying(false);
    setSelection({ artist, title, status: "loading" });
    try {
      const response = await fetch(`/api/preview?${new URLSearchParams({ artist, title })}`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("Preview service unavailable");
      const data = await response.json() as { preview?: { url?: string; source_url?: string; provider?: string } | null };
      if (current !== sequence.current) return;
      const url = data?.preview?.url;
      const parsed = url ? new URL(url) : null;
      if (!parsed || parsed.protocol !== "https:" || !(parsed.hostname.endsWith(".dzcdn.net") || parsed.hostname === "audio-ssl.itunes.apple.com" || parsed.hostname.endsWith(".mzstatic.com")) || parsed.username || parsed.password || parsed.port) {
        setSelection({ artist, title, status: "unavailable" });
        return;
      }
      setSelection({ artist, title, status: "ready", url: parsed.href, source: data.preview?.source_url, provider: data.preview?.provider });
    } catch {
      if (current === sequence.current) setSelection({ artist, title, status: "error" });
    }
  };

  return <PreviewContext.Provider value={{ play, selection, playing }}>
    {children}
    {selection && <aside className="preview-player" aria-label="reproductor de fragmentos">
      <div className="preview-description"><strong>{selection.title}</strong><span>{selection.artist}</span></div>
      <div className="preview-controls">
        {selection.status === "loading" && <p role="status">buscando un fragmento…</p>}
        {selection.status === "unavailable" && <p role="status">sin fragmento disponible · <a href={spotifyUrl(selection.artist, selection.title)} target="_blank" rel="noreferrer">spotify ↗</a> · <a href={youtubeUrl(selection.artist, selection.title)} target="_blank" rel="noreferrer">youtube ↗</a></p>}
        {selection.status === "error" && <p role="status">no pude cargar el fragmento · <button onClick={() => play(selection.artist, selection.title)}>reintentar ↻</button></p>}
        {selection.status === "ready" && <>
          <audio key={selection.url} ref={audio} src={selection.url} controls autoPlay preload="none"
            aria-label={`fragmento de ${selection.title}, de ${selection.artist}`}
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
            onError={() => { setPlaying(false); setSelection({ ...selection, status: "error" }); }} />
          <a href={selection.source} target="_blank" rel="noreferrer">{selection.provider === "apple" ? <img src="/icons/apple-music-badge.svg" width="100" height="33" alt="escuchar en apple music" /> : "fragmento · deezer ↗"}</a>
        </>}
      </div>
      <button type="button" className="preview-close" aria-label="cerrar reproductor" onClick={() => { sequence.current++; setSelection(null); setPlaying(false); }}>×</button>
    </aside>}
  </PreviewContext.Provider>;
}

export function PreviewButton({ artist, title }: { artist: string; title: string }) {
  const context = useContext(PreviewContext);
  if (!context) return null;
  const active = context.selection?.artist === artist && context.selection.title === title;
  const playing = active && context.playing;
  const loading = active && context.selection?.status === "loading";
  return <button type="button" className="preview-button" disabled={loading}
    aria-label={`${playing ? "pausar" : "escuchar un fragmento de"} ${title}, de ${artist}`}
    title={playing ? "pausar" : "escuchar un fragmento"} onClick={() => context.play(artist, title)}>
    {loading ? "…" : playing ? "Ⅱ" : "▶"}
  </button>;
}
