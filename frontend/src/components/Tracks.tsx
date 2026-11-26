import type { TrackStat } from "../data/types";
import { PlayCount } from "./PlayCount";
import { Cover } from "./Cover";
import { PreviewButton } from "./PreviewPlayer";
import { PlayableTitle } from "./PreviewPlayer";

export function Tracks({ tracks }: { tracks: TrackStat[] }) {
  return (
    <ol className="divide-y divide-line">
      {tracks.slice(0, 10).map((t, i) => (
        <li
          key={`${t.artist}-${t.title}`}
          className="group grid grid-cols-[2rem_3rem_1fr_auto] items-center gap-4 py-3 transition-colors duration-300 hover:bg-white/[0.02]"
        >
          <span className="tabular text-sm text-muted">{String(i + 1).padStart(2, "0")}</span>
          <Cover seed={t.title} image={t.image} label={`portada de ${t.title}`} compact />
          <span className="min-w-0">
            <PlayableTitle artist={t.artist} title={t.title} className="music-name block text-base text-ink" />
            <span className="block truncate text-sm text-muted">{t.artist}</span>
          </span>
          <span className="track-actions"><PreviewButton artist={t.artist} title={t.title} /><PlayCount count={t.scrobbles} artist={t.artist} title={t.title} /></span>
        </li>
      ))}
    </ol>
  );
}
