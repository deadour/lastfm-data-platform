import { t as translate } from "../i18n";
import { useMemo, useState } from "react";
import { Cover } from "../components/Cover";
import { Loading } from "../components/Loading";
import { PlayCount } from "../components/PlayCount";
import { Link } from "../utils/router";
import type { StatsFile } from "../data/types";

const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function AlbumsPage({ stats }: { stats: StatsFile | null }) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(60);
  const albums = useMemo(() => {
    const all = stats?.top_albums ?? [];
    const q = plain(query.trim());
    return q ? all.filter((a) => plain(`${a.title} ${a.artist}`).includes(q)) : all;
  }, [stats, query]);

  if (!stats) return <Loading label={translate("cargando discos")} />;

  return (
    <div className="fade-in">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-line py-12">
        <h1 className="font-serif text-5xl tracking-tight text-ink md:text-6xl">{translate("discos")}</h1>
        <label className="w-full max-w-xs">
          <span className="sr-only">{translate("buscar disco")}</span>
          <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(60); }} placeholder={translate("buscar…")}
            className="w-full border-b border-line bg-transparent py-2 text-sm text-ink placeholder:text-muted focus:border-white/40 focus:outline-none" />
        </label>
      </header>
      <ol className="album-grid py-12">
        {albums.slice(0, limit).map((a, i) => (
          <li key={a.key} className="group min-w-0">
            <Link href={`/discos/${a.key}`} className="block w-full text-left" aria-label={translate(`escuchar algo de ${a.title}`)}>
              <Cover seed={a.title} image={a.cover?.url ?? a.image} label={translate(`portada de ${a.title}`)} album={{ artist: a.artist, title: a.title }} compact className="tossed" />
            </Link>
            <span className="mt-3 flex items-baseline gap-2">
              <span className="tabular text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
              <span className="truncate text-sm text-ink">{a.title}{a.year ? <span className="album-year"> ({a.year})</span> : null}</span>
            </span>
            <span className="block truncate pl-6 text-xs text-muted">{a.artist}</span>
            <span className="block pl-6 text-xs"><PlayCount count={a.scrobbles} artist={a.artist} title={a.title} /></span>
          </li>
        ))}
      </ol>
      {limit < albums.length && <button type="button" className="random-play mb-12" onClick={() => setLimit((v) => v + 60)}>{translate("ver más discos (")}{albums.length - limit})</button>}
      {!albums.length && <p className="py-12 text-muted">{translate("ningún disco con ese nombre en este catálogo.")}</p>}
    </div>
  );
}
