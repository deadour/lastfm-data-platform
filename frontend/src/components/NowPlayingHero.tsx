import type { NowPlaying } from "../data/types";
import { ago } from "../lib/format";
import { Cover } from "./Cover";

export function NowPlayingHero({ data }: { data: NowPlaying | null }) {
  if (!data?.track) {
    return (
      <section id="ahora" className="py-16">
        <p className="text-sm text-muted">sin datos de reproducción por ahora.</p>
      </section>
    );
  }
  const { track } = data;
  const status = data.playing ? "sonando ahora" : data.played_at ? `lo último, ${ago(data.played_at)}` : "lo último";
  const coverName = track.album ?? track.title;

  return (
    <section id="ahora" className="grid items-end gap-8 py-12 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:gap-14 md:py-20">
      <div className="group fade-in">
        <Cover seed={coverName} image={track.image} label={`portada de ${coverName}`} className="shadow-2xl shadow-black/60" />
      </div>
      <div className="fade-in delay-1">
        <p className="mb-6 flex items-center gap-3 text-sm text-muted">
          {data.playing && <span className="pulse inline-block h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />}
          {status}
          {data.source === "mock" && <span className="text-muted/70">· ejemplo</span>}
        </p>
        <h1 className="font-serif text-5xl leading-[1.02] tracking-tight text-ink md:text-7xl">{track.title}</h1>
        <p className="mt-5 text-xl text-ink/80">{track.artist}</p>
        {track.album && <p className="mt-1 text-muted">{track.album}</p>}
        {track.url && (
          <a
            href={track.url}
            target="_blank"
            rel="noreferrer"
            className="mt-8 inline-block text-sm text-muted underline decoration-white/20 underline-offset-4 hover:text-ink"
          >
            ver en last.fm
          </a>
        )}
      </div>
    </section>
  );
}
