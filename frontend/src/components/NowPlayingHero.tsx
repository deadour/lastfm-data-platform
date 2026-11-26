import { useEffect, useState } from "react";
import type { NowPlaying } from "../data/types";
import { ago } from "../utils/format";
import { Cover } from "./Cover";

/** keeps "hace x min" fresh between polls */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** fallback: the last processed scrobble, used while last.fm's live api is down */
export function NowPlayingHero({ data, fallback = false }: { data: NowPlaying; fallback?: boolean }) {
  const now = useNow();
  if (!data.track) return null;
  const { track } = data;
  const status = data.playing ? "sonando ahora"
    : fallback ? `lo último que quedó registrado${data.played_at ? `, ${ago(data.played_at, now)}` : ""}`
    : data.played_at ? `lo último, ${ago(data.played_at, now)}` : "lo último";
  const coverName = track.album ?? track.title;

  return (
    <section aria-label="qué estoy escuchando" className="fade-in grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-5 border-b border-line py-6 md:grid-cols-[5.5rem_minmax(0,1fr)_auto] md:gap-7">
      <div className="group">
        <Cover seed={coverName} image={track.image} label={`portada de ${coverName}`} compact />
      </div>
      <div className="min-w-0">
        <p className="mb-1.5 flex items-center gap-2.5 text-xs tracking-wide text-muted">
          {data.playing && <span className="pulse inline-block h-1.5 w-1.5 rounded-full bg-[#bd533e]" aria-hidden />}
          {status}
        </p>
        <p className="truncate font-serif text-2xl leading-tight text-ink md:text-3xl">{track.title}</p>
        <p className="truncate text-sm text-ink/70">
          {track.artist}
          {track.album && <span className="text-muted"> · {track.album}</span>}
        </p>
      </div>
      {track.url && (
        <a href={track.url} target="_blank" rel="noreferrer" className="col-span-2 text-xs text-muted hover:text-ink md:col-span-1">
          last.fm ↗
        </a>
      )}
    </section>
  );
}
