import type { ArtistStat } from "../data/types";
import { n } from "../lib/format";
import { Cover } from "./Cover";

export function Artists({ artists }: { artists: ArtistStat[] }) {
  return (
    <ol className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-4">
      {artists.slice(0, 12).map((a, i) => (
        <li key={a.name} className="group min-w-0">
          <Cover seed={a.name} image={a.image} label={a.name} />
          <div className="mt-3 flex items-baseline gap-3">
            <span className="tabular text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
            <span className="truncate text-ink" title={a.name}>
              {a.name}
            </span>
          </div>
          <span className="tabular ml-8 text-sm text-muted">{n(a.scrobbles)}</span>
        </li>
      ))}
    </ol>
  );
}
