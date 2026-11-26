import { t as translate } from "../i18n";
import type { AlbumStat, InsightsFile } from "../data/types";
import { Cover } from "../components/Cover";
import { Bars } from "../components/Charts";
import { Count } from "../components/Count";
import { PlayableTitle, usePreview } from "../components/PreviewPlayer";
import { Link } from "../utils/router";
import { n, shortDate } from "../utils/format";

export function Album({ album, insights }: { album: AlbumStat | undefined; insights: InsightsFile | null }) {
  const preview = usePreview();
  if (!album) return <p className="py-24 text-muted">{translate("no tengo una ficha para este disco.")}</p>;
  const artist = insights?.artists.find((artist) => artist.name === album.artist);
  const details = album.details;
  return <article className="fade-in">
    <header className="album-detail-header">
      <button type="button" onClick={() => preview?.play(album.artist, "", null, album.key)} aria-label={translate(`escuchar algo de ${album.title}`)}>
        <Cover seed={album.title} image={album.cover?.url ?? album.image} label={translate(`portada de ${album.title}`)} album={{ artist: album.artist, title: album.title }} priority />
      </button>
      <div>
        <h1 className="font-serif text-3xl leading-tight md:text-5xl">{album.title}</h1>
        <p className="mt-4 text-lg text-muted">{artist ? <Link href={`/artistas/${artist.slug}`}>{album.artist}</Link> : album.artist}{album.year ? ` · ${album.year}` : ""}</p>
        <p className="mt-6 text-3xl"><Count value={album.scrobbles} /></p>
        {details && <dl className="mt-8 grid grid-cols-2 gap-6 text-sm">
          <div><dt className="text-muted">{translate("la primera vez")}</dt><dd>{shortDate(details.first)}</dd></div>
          <div><dt className="text-muted">{translate("lo último")}</dt><dd>{shortDate(details.last)}</dd></div>
          <div><dt className="text-muted">{translate("canciones")}</dt><dd>{n(details.unique_tracks)}</dd></div>
          <div><dt className="text-muted">{translate("años en el archivo")}</dt><dd>{n(details.years.length)}</dd></div>
        </dl>}
      </div>
    </header>
    {details && <div className="album-detail-body">
      <section><h2 className="mb-6 font-serif text-2xl">{translate("canciones que escuché")}</h2><ol className="divide-y divide-line">
        {details.tracks.map((track, i) => <li key={track.title} className="flex items-center gap-4 py-4">
          <span className="tabular text-sm text-muted">{i + 1}</span>
          <PlayableTitle artist={album.artist} title={track.title} albumKey={album.key} className="flex-1 text-left" />
          <Count value={track.scrobbles} />
        </li>)}
      </ol></section>
      <section><h2 className="mb-6 font-serif text-2xl">{translate("por año")}</h2><Bars values={details.years.map((year) => year.scrobbles)} labels={details.years.map((year) => String(year.year))} label={translate("e por año")} showValues /></section>
    </div>}
    {album.cover && <a className="my-8 inline-block text-sm text-muted" href={album.cover.source_url} target="_blank" rel="noreferrer">{album.cover.attribution}</a>}
  </article>;
}
