import { t as translate } from "../i18n";
import { useMemo, useState } from "react";
import { Cover } from "../components/Cover";
import { Loading } from "../components/Loading";
import { PlayableTitle, PreviewButton } from "../components/PreviewPlayer";
import type { StatsFile } from "../data/types";
import { n } from "../utils/format";

const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function Songs({ stats }: { stats: StatsFile | null }) {
  const [query, setQuery] = useState("");
  const tracks = useMemo(() => (stats?.top_tracks ?? []).slice(0, 100).map((track, i) => ({ ...track, rank: i + 1 }))
    .filter((t) => plain(`${t.artist} ${t.title}`).includes(plain(query.trim()))), [stats, query]);
  if (!stats) return <Loading label={translate("cargando canciones")} />;
  return <div className="fade-in">
    <header className="catalog-header">
      <div><h1>{translate("canciones")}</h1><p>{translate("los ")}{Math.min(100, stats.top_tracks.length)}{translate(" temas que más escuché")}</p></div>
      <label><span className="sr-only">{translate("buscar canción o artista")}</span><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={translate("buscar canción o artista…")} /></label>
    </header>
    <ol className="song-catalog">
      {tracks.map((t) => <li key={`${t.artist}\0${t.title}`}>
        <span className="tabular text-muted">{String(t.rank).padStart(2, "0")}</span>
        <Cover seed={t.title} image={t.image} label={translate(`portada de ${t.title}`)} compact />
        <span className="min-w-0"><PlayableTitle artist={t.artist} title={t.title} /><small>{t.artist}</small></span>
        <span className="tabular text-muted">{n(t.scrobbles)}</span>
        <PreviewButton artist={t.artist} title={t.title} />
      </li>)}
    </ol>
    {!tracks.length && <p className="py-12 text-muted">{translate("ningún tema con ese nombre en este catálogo.")}</p>}
  </div>;
}
