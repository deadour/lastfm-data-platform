import { t as translate } from "../i18n";
import { useEffect, useState } from "react";
import { Bars, HourBars, Line, yearTicks } from "../components/Charts";
import { Cover } from "../components/Cover";
import { Loading } from "../components/Loading";
import { loadArtist } from "../data/insights";
import type { ArtistPage, InsightsFile } from "../data/types";
import { PreviewButton } from "../components/PreviewPlayer";
import { PlayableTitle } from "../components/PreviewPlayer";
import { n, pct, secureImage, shortDate } from "../utils/format";
import { Link } from "../utils/router";
import { Count } from "../components/Count";

export function Artist({ slug, insights }: { slug: string; insights: InsightsFile | null }) {
  const [page, setPage] = useState<ArtistPage | null | undefined>(undefined);

  useEffect(() => {
    setPage(undefined);
    void loadArtist(slug).then(setPage);
  }, [slug]);

  useEffect(() => {
    if (page) document.title = `${page.name} · fm`;
    return () => { document.title = "fm · edu ramírez"; };
  }, [page]);

  if (page === undefined) return <Loading label={translate("abriendo el artista")} />;
  if (page === null) {
    return (
      <div className="py-32">
        <p className="font-serif text-3xl text-ink">{translate("no tengo una ficha para este artista.")}</p>
        <Link href="/artistas" className="mt-6 inline-block text-sm text-muted underline underline-offset-4 hover:text-ink">{translate("ver todos")}</Link>
      </div>
    );
  }

  const index = insights?.artists ?? [];
  const position = index.findIndex((a) => a.slug === page.slug);
  const previous = position > 0 ? index[position - 1] : null;
  const next = position >= 0 && position < index.length - 1 ? index[position + 1] : null;
  const photo = secureImage(page.photo?.url);
  const months = insights?.months ?? [];
  const firstActive = page.months.findIndex((v) => v > 0);
  const series = firstActive >= 0 ? page.months.slice(firstActive) : page.months;
  const seriesMonths = firstActive >= 0 ? months.slice(firstActive) : months;

  return (
    <article className="fade-in">
      <nav className="flex items-center justify-between border-b border-line py-4 text-xs text-muted">
        <Link href="/artistas" className="hover:text-ink">{translate("← artistas")}</Link>
        <span className="tabular">#{page.rank}</span>
      </nav>

      <header className="grid items-end gap-8 py-12 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-14 md:py-16">
        <div className="relative aspect-[4/5] overflow-hidden bg-neutral-900">
          {photo ? (
            <img src={photo} alt={page.name} className="h-full w-full object-cover grayscale-[20%]" />
          ) : (
            <Cover seed={page.name} image={page.top_albums.find((a) => a.cover)?.cover?.url} label={page.name} className="h-full" />
          )}
        </div>
        <div>
          <h1 className="music-name text-5xl leading-tight text-ink md:text-7xl">{page.name}</h1>
          <p className="tabular mt-6 text-lg text-ink/80"><span className="count-value">{n(page.scrobbles)}<small className="count-unit">e</small></span> · {pct(page.share, 1)}{translate(" de todo")}</p>
          <dl className="mt-10 grid grid-cols-2 gap-x-8 gap-y-6 text-sm">
            <div><dt className="text-xs text-muted">{translate("la primera vez")}</dt><dd className="mt-1 text-ink">{shortDate(page.first.date)}</dd><dd className="text-muted">{page.first.title}</dd></div>
            <div><dt className="text-xs text-muted">{translate("su año")}</dt><dd className="mt-1 text-ink">{page.peak_year}</dd><dd className="text-muted">{page.active_years}{translate(" años en el archivo")}</dd></div>
            <div><dt className="text-xs text-muted">{translate("el día que más")}</dt><dd className="mt-1 text-ink">{shortDate(page.best_day.date)}</dd><dd className="text-muted"><span className="count-value">{n(page.best_day.plays)}<small className="count-unit">e</small></span></dd></div>
            <div><dt className="text-xs text-muted">{translate("repertorio")}</dt><dd className="mt-1 text-ink">{n(page.tracks)}{translate(" temas")}</dd><dd className="text-muted">{translate("en")} {n(page.albums)}{translate(" discos")}</dd></div>
          </dl>
          {page.photo && (
            <a href={page.photo.source_url} target="_blank" rel="noreferrer" className="mt-8 inline-block text-[11px] text-muted/70 hover:text-ink">{translate("foto: ")}{page.photo.attribution}</a>
          )}
        </div>
      </header>

      <section className="border-t border-line py-12">
        <h2 className="mb-8 font-serif text-2xl text-ink">{translate("mes a mes")}</h2>
        <Line values={series} ticks={yearTicks(seriesMonths)} label={translate(`e de ${page.name} por mes`)} />
      </section>

      <section className="grid gap-12 border-t border-line py-12 md:grid-cols-2">
        <div>
          <h2 className="mb-8 font-serif text-2xl text-ink">{translate("por año")}</h2>
          <Bars values={page.years.map((y) => y.scrobbles)} labels={page.years.map((y) => String(y.year).slice(2))} label={translate("e por año")} showValues />
        </div>
        <div>
          <h2 className="mb-8 font-serif text-2xl text-ink">{translate("a qué hora")}</h2>
          <HourBars values={page.hours} label={translate("e por hora del día")} />
        </div>
      </section>

      <section className="grid gap-12 border-t border-line py-12 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <h2 className="mb-6 font-serif text-2xl text-ink">{translate("temas")}</h2>
          <ol className="divide-y divide-line">
            {page.top_tracks.map((t, i) => (
              <li key={`${t.title}-${i}`} className="grid grid-cols-[2rem_1fr_auto] items-baseline gap-3 py-2.5">
                <span className="tabular text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
                <PlayableTitle artist={page.name} title={t.title} slug={page.slug} className="text-ink" />
                <span className="track-actions"><PreviewButton artist={page.name} title={t.title} slug={page.slug} /><span className="tabular text-sm text-muted"><Count value={t.plays} /></span></span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h2 className="mb-6 font-serif text-2xl text-ink">{translate("discos")}</h2>
          <ol className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3">
            {page.top_albums.map((a, i) => (
              <li key={`${a.title}-${i}`} className="group min-w-0">
                <Cover seed={a.title} image={a.cover?.url} label={translate(`portada de ${a.title}`)} album={{ artist: page.name, title: a.title }} compact />
                <span className="mt-2 block truncate text-sm text-ink" title={a.title}>{a.title}</span>
                <span className="tabular block text-xs text-muted"><Count value={a.plays} /></span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <nav className="flex justify-between gap-6 border-t border-line py-10 text-sm">
        {previous ? <Link href={`/artistas/${previous.slug}`} className="text-muted hover:text-ink">← {previous.name}</Link> : <span />}
        {next ? <Link href={`/artistas/${next.slug}`} className="text-right text-muted hover:text-ink">{next.name} →</Link> : <span />}
      </nav>
    </article>
  );
}
