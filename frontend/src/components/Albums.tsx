import type { AlbumStat } from "../data/types";
import { n } from "../utils/format";
import { Cover } from "./Cover";

export function Albums({ albums }: { albums: AlbumStat[] }) {
  const [first, ...rest] = albums.slice(0, 13);
  if (!first) return null;

  return (
    <div className="grid gap-x-5 gap-y-10 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <figure className="group">
        <Cover seed={first.title} image={first.cover?.url ?? first.image} label={`portada de ${first.title}`} className="shadow-2xl shadow-black/50" />
        <figcaption className="mt-4">
          <span className="block font-serif text-3xl leading-tight text-ink">{first.title}</span>
          <span className="block text-ink/75">{first.artist}</span>
          <span className="tabular mt-1 block text-sm text-muted">{n(first.scrobbles)} escuchas</span>
          <Credit album={first} />
        </figcaption>
      </figure>

      <ol className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3">
        {rest.map((a, i) => (
          <li key={a.key} className="group min-w-0">
            <Cover seed={a.title} image={a.cover?.url ?? a.image} label={`portada de ${a.title}`} />
            <div className="mt-3 flex items-baseline gap-2">
              <span className="tabular text-xs text-muted">{String(i + 2).padStart(2, "0")}</span>
              <span className="truncate text-sm text-ink" title={a.title}>
                {a.title}
              </span>
            </div>
            <span className="block truncate pl-6 text-xs text-muted" title={a.artist}>
              {a.artist} · {n(a.scrobbles)}
            </span>
            <Credit album={a} small />
          </li>
        ))}
      </ol>
    </div>
  );
}

function Credit({ album, small = false }: { album: AlbumStat; small?: boolean }) {
  if (!album.cover) return null;
  return (
    <a
      href={album.cover.source_url}
      target="_blank"
      rel="noreferrer"
      className={`mt-1 block truncate text-muted/70 underline decoration-white/10 underline-offset-2 hover:text-ink ${small ? "pl-6 text-[10px]" : "text-xs"}`}
    >
      {album.cover.attribution}
    </a>
  );
}
