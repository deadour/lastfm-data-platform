import type { YearStat } from "../data/types";
import { n } from "../lib/format";

export function Years({ years }: { years: YearStat[] }) {
  const max = Math.max(...years.map((y) => y.scrobbles), 1);
  return (
    <ol className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4 lg:grid-cols-8">
      {years.map((y) => {
        const { partial } = y;
        return (
          <li key={y.year} className="flex min-w-0 flex-col">
            <div className="mb-4 flex h-28 items-end">
              <div
                className={`grow-up w-full ${partial ? "bg-white/15" : "bg-white/70"}`}
                style={{ height: `${Math.max(4, (y.scrobbles / max) * 100)}%` }}
                aria-hidden
              />
            </div>
            <span className="font-serif text-2xl text-ink">{y.year}</span>
            <span className="tabular text-sm text-ink/80">{n(y.scrobbles)}</span>
            {y.top_artist && (
              <span className="mt-2 truncate text-sm text-muted" title={y.top_artist}>
                {y.top_artist}
              </span>
            )}
            {partial && <span className="mt-1 text-xs text-muted/70">año incompleto</span>}
          </li>
        );
      })}
    </ol>
  );
}
