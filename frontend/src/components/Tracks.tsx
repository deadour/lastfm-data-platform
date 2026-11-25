import type { TrackStat } from "../data/types";
import { n } from "../lib/format";

export function Tracks({ tracks }: { tracks: TrackStat[] }) {
  return (
    <ol className="divide-y divide-line">
      {tracks.slice(0, 10).map((t, i) => (
        <li
          key={`${t.artist}-${t.title}`}
          className="grid grid-cols-[2.5rem_1fr_auto] items-baseline gap-4 py-4 transition-colors duration-300 hover:bg-white/[0.02]"
        >
          <span className="tabular text-sm text-muted">{String(i + 1).padStart(2, "0")}</span>
          <span className="min-w-0">
            <span className="block truncate font-serif text-xl text-ink">{t.title}</span>
            <span className="block truncate text-sm text-muted">
              {t.artist}
              {t.peak_year ? ` · su año fue ${t.peak_year}` : ""}
            </span>
          </span>
          <span className="tabular text-sm text-ink/70">{n(t.scrobbles)}</span>
        </li>
      ))}
    </ol>
  );
}
