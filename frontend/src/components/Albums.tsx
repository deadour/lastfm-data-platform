import type { AlbumStat } from "../data/types";
import { Cover } from "./Cover";
import { PlayCount } from "./PlayCount";

export function Albums({ albums }: { albums: AlbumStat[] }) {
  return (
    <ol className="divide-y divide-line">
      {albums.slice(0, 13).map((album, i) => (
        <li key={album.key} className="group grid grid-cols-[2rem_3.6rem_minmax(0,1fr)] items-center gap-3 py-3 md:gap-4">
          <span className="tabular text-sm text-muted">{String(i + 1).padStart(2, "0")}</span>
          <Cover seed={album.title} image={album.cover?.url ?? album.image} label={`portada de ${album.title}`} compact />
          <span className="min-w-0">
            <span className="music-name block truncate text-base text-ink">{album.title}</span>
            <span className="album-year block truncate text-sm">{album.year ?? ""}{album.year ? " · " : ""}<span className="text-muted">{album.artist}</span></span>
            <span className="album-count block text-sm"><PlayCount count={album.scrobbles} artist={album.artist} title={album.title} /></span>
          </span>
        </li>
      ))}
    </ol>
  );
}
