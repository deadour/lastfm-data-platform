import type { ArtistStat } from "../data/types";
import { n } from "../utils/format";

export function Artists({ artists }: { artists: ArtistStat[] }) {
  const max = artists[0]?.scrobbles || 1;
  return (
    <ol className="grid gap-x-10 sm:grid-cols-2">
      {artists.slice(0, 20).map((a, i) => (
        <li key={a.name} className="grid grid-cols-[2rem_1fr_auto] items-baseline gap-3 border-b border-line py-3">
          <span className="tabular text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
          <span className="min-w-0">
            <span className="block truncate font-serif text-lg text-ink" title={a.name}>
              {a.name}
            </span>
            <span className="mt-1 block h-px bg-white/25 grow-x" style={{ width: `${(a.scrobbles / max) * 100}%` }} aria-hidden />
          </span>
          <span className="tabular text-sm text-ink/70">{n(a.scrobbles)}</span>
        </li>
      ))}
    </ol>
  );
}
