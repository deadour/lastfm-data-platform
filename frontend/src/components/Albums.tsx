import type { AlbumStat } from "../data/types";
import { Cover } from "./Cover";
import { PlayCount } from "./PlayCount";

export function Albums({ albums }: { albums: AlbumStat[] }) {
  return (
    <ol className="divide-y divide-line">
      {albums.slice(0, 13).map((album, i) => (
        <li key={album.key} className="group grid grid-cols-[2rem_3rem_minmax(0,1fr)_auto] items-center gap-3 py-3 md:gap-4">
          <span className="tabular text-sm text-muted">{String(i + 1).padStart(2, "0")}</span>
          <Cover seed={album.title} image={album.cover?.url ?? album.image} label={`portada de ${album.title}`} compact />
          <span className="min-w-0">
            <span className="block truncate font-serif text-lg text-ink">{album.title}</span>
            <span className="block truncate text-sm text-muted">{album.artist}</span>
            {album.cover && <a href={album.cover.source_url} target="_blank" rel="noreferrer" className="text-xs text-muted underline">{album.cover.attribution}</a>}
          </span>
          <PlayCount count={album.scrobbles} artist={album.artist} title={album.title} />
        </li>
      ))}
    </ol>
  );
}
