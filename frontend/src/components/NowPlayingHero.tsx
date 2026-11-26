import { t as translate } from "../i18n";
import { useEffect, useState } from "react";
import type { NowPlaying } from "../data/types";
import { ago } from "../utils/format";
import { Cover } from "./Cover";
import { PreviewButton } from "./PreviewPlayer";

/** keeps "hace x min" fresh between polls */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** cover from apple when last.fm sends none */
function useArtwork(artist: string, title: string, image: string | null) {
  const [art, setArt] = useState<string | null>(image);
  useEffect(() => {
    if (image) { setArt(image); return; }
    setArt(null);
    let live = true;
    const url = new URL("https://itunes.apple.com/search");
    url.search = new URLSearchParams({ term: `${artist} ${title}`, entity: "song", limit: "5" }).toString();
    fetch(url.href).then((r) => r.json()).then((b: { results?: { artistName?: string; artworkUrl100?: string }[] }) => {
      const hit = b.results?.find((r) => r.artistName?.toLowerCase().includes(artist.toLowerCase().split(" ")[0]) && r.artworkUrl100);
      if (live && hit?.artworkUrl100) setArt(hit.artworkUrl100.replace("100x100bb", "600x600bb"));
    }).catch(() => {});
    return () => { live = false; };
  }, [artist, title, image]);
  return art;
}

/** fallback: the last processed scrobble, used while last.fm's live api is down */
export function NowPlayingHero({ data, fallback = false }: { data: NowPlaying; fallback?: boolean }) {
  const now = useNow();
  const art = useArtwork(data.track?.artist ?? "", data.track?.title ?? "", data.track?.image ?? null);
  if (!data.track) return null;
  const { track } = data;
  const status = data.playing ? translate("sonando ahora")
    : fallback ? translate(`lo último que quedó registrado${data.played_at ? `, ${ago(data.played_at, now)}` : ""}`)
    : data.played_at ? translate(`lo último, ${ago(data.played_at, now)}`) : translate("lo último");
  const coverName = track.album ?? track.title;

  return (
    <section aria-label={translate("qué estoy escuchando")} className="now-playing fade-in grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-5 border-b border-line py-8 md:grid-cols-[9rem_minmax(0,1fr)_auto] md:gap-8">
      <div className="group">
        <Cover seed={coverName} image={art} label={translate(`portada de ${coverName}`)} song={{ artist: track.artist, title: track.title }} album={track.album ? { artist: track.artist, title: track.album } : undefined} compact priority />
      </div>
      <div className="min-w-0">
        <p className="mb-1.5 flex items-center gap-2.5 text-xs tracking-wide text-muted">
          {data.playing && <span className="pulse inline-block h-1.5 w-1.5 rounded-full bg-[#bd533e]" aria-hidden />}
          {status}
        </p>
        <p className="music-name truncate text-2xl leading-tight text-ink md:text-4xl">{track.title}</p>
        <p className="truncate text-sm text-ink/70">
          {track.artist}
          {track.album && <span className="text-muted"> · {track.album}</span>}
        </p>
        <PreviewButton artist={track.artist} title={track.title} />
      </div>
      {track.url && (
        <a href={track.url} target="_blank" rel="noreferrer" className="col-span-2 text-xs text-muted hover:text-ink md:col-span-1">
          last.fm ↗
        </a>
      )}
    </section>
  );
}
