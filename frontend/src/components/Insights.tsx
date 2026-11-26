import { t as translate } from "../i18n";
import { useState } from "react";
import type { ArtistLink, InsightsFile, YearInsight } from "../data/types";
import { days, longDate, monthYear, n, pct } from "../utils/format";
import { Link } from "../utils/router";
import { Cover } from "./Cover";
import { Count } from "./Count";
import { HourBars } from "./Charts";
import { PlayableTitle, PlaySomething, PreviewButton } from "./PreviewPlayer";

function Reading({ first }: { first: InsightsFile["first_ever"] }) {
  return (
    <article className="reading-card">
      <div className="reading-card-top"><span>{translate("el primer registro")}</span></div>
      <div className="reading-record">
        <Cover seed={first.album ?? first.title} image={first.cover?.url} label={translate(`portada de ${first.album ?? first.title}`)} album={first.album ? { artist: first.artist, title: first.album } : undefined} compact />
        <div><strong>{first.title}</strong><p>{first.artist} · {longDate(first.date)}{first.time && <>{translate(" a las ")}{first.time}</>}</p><PreviewButton artist={first.artist} title={first.title} /></div>
      </div>
    </article>
  );
}

export function Readings({ data }: { data: InsightsFile }) {
  const { first_ever: first, habits } = data;
  return (
    <div className="reading-layout">
      <div className="reading-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
        <Reading first={first} />
      </div>
      <div className="reading-hours">
        <div className="reading-hours-header">
          <span>{translate("la hora en la que más escucho")}</span>
          <strong>{String(habits.peak_hour).padStart(2, "0")}:00</strong>
          <small>{pct(habits.hours[habits.peak_hour] ?? 0)}{translate(" de todas mis escuchas")}</small>
        </div>
        <HourBars values={habits.hours.map((h) => Math.round(h * 10000))} label={translate("distribución histórica según la hora local")} />
        <p>{translate("cuánto escucho en cada hora del día, en hora local, desde 2016")}</p>
      </div>
    </div>
  );
}

function YearRow({ year, linkFor }: { year: YearInsight; linkFor: (artist: string) => string | null }) {
  const top = linkFor(year.top_artist);
  return (
    <li className="year-detail grid gap-6 py-8 md:grid-cols-[8rem_minmax(0,1fr)_9rem] md:gap-10">
      <div>
        <span className="font-serif text-4xl text-ink">{year.year}</span>
        <span className="tabular mt-2 block text-sm text-muted"><span className="count-value">{n(year.scrobbles)}<small className="count-unit">e</small></span></span>
        {year.year === new Date().getFullYear()
          ? <span className="mt-1 block text-xs text-muted/70">{translate("en curso")}</span>
          : year.partial && <span className="mt-1 block text-xs text-muted/70">{translate("registro parcial")}</span>}
      </div>
      <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted">{translate("artista del año")}</dt>
          <dd className="year-play music-name mt-1 text-lg text-ink">
            <PlaySomething artist={year.top_artist} label={translate(`escuchar algo de ${year.top_artist}`)} />
            {top ? <Link href={top} className="hover:underline hover:decoration-white/30 hover:underline-offset-4">{year.top_artist}</Link> : year.top_artist}
          </dd>
          <dd className="text-muted">{pct(year.top_artist_share)}{translate(" del total")}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{translate("canción del año")}</dt>
          <dd className="year-play mt-1 text-ink"><PreviewButton artist={year.top_track.artist} title={year.top_track.title} /><PlayableTitle artist={year.top_track.artist} title={year.top_track.title} /></dd>
          <dd className="text-muted">{translate("de ")}{year.top_track.artist} · <Count value={year.top_track.plays} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{translate("descubrimiento")}</dt>
          <dd className="year-play mt-1 text-ink">{year.discovery ? <><PlaySomething artist={year.discovery.artist} label={translate(`escuchar algo de ${year.discovery.artist}`)} />{linkFor(year.discovery.artist) ? <Link href={linkFor(year.discovery.artist)!} className="hover:underline hover:underline-offset-4">{year.discovery.artist}</Link> : year.discovery.artist}</> : "—"}</dd>
          <dd className="text-muted">{translate("entre ")}{n(year.new_artists)}{translate(" artistas nuevos")}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{translate("disco del año")}</dt>
          <dd className="year-play mt-1 text-ink">{year.top_album ? <><PlaySomething artist={year.top_album.artist} album={year.top_album.title} label={translate(`escuchar algo de ${year.top_album.title}`)} />{year.top_album.title}</> : "—"}</dd>
          {year.top_album && <dd className="text-muted">{translate("de ")}{year.top_album.artist}</dd>}
        </div>
      </dl>
      {year.top_album ? (
        <div className="group hidden md:block">
          <Cover seed={year.top_album.title} image={year.top_album.cover?.url} label={translate(`portada de ${year.top_album.title}`)} album={{ artist: year.top_album.artist, title: year.top_album.title }} compact />
        </div>
      ) : <div className="hidden md:block" />}
    </li>
  );
}

export function YearStory({ years, linkFor }: { years: YearInsight[]; linkFor: (artist: string) => string | null }) {
  const ordered = [...years].sort((a, b) => b.year - a.year);
  const [selectedYear, setSelectedYear] = useState(ordered[0]?.year ?? 0);
  const selected = ordered.find((year) => year.year === selectedYear) ?? ordered[0];
  const max = Math.max(...ordered.map((year) => year.scrobbles), 1);
  if (!selected) return null;

  return (
    <div className="year-explorer">
      <div className="year-selector" role="group" aria-label={translate("elegir año")}>
        {ordered.map((year) => (
          <button
            key={year.year}
            type="button"
            aria-pressed={year.year === selected.year}
            className={year.year === selected.year ? "year-button active" : "year-button"}
            onClick={() => setSelectedYear(year.year)}
          >
            <span className="year-selector-bar" style={{ height: Math.max(6, 96 * year.scrobbles / max) + "px" }} />
            <span>{year.year}</span>
          </button>
        ))}
      </div>
      <ol className="year-detail-list"><YearRow key={selected.year} year={selected} linkFor={linkFor} /></ol>
    </div>
  );
}

export function Movements({ data, linkFor }: { data: InsightsFile; linkFor: (artist: string) => string | null }) {
  const name = (artist: string) => {
    const href = linkFor(artist);
    return href ? <Link href={href} className="hover:underline hover:underline-offset-4">{artist}</Link> : artist;
  };
  const columns = [
    { title: translate("volvieron"), rows: data.comebacks.map((c) => ({ key: c.artist, name: c.artist, detail: translate("lo volví a escuchar en ") + monthYear(c.returned) + translate(", después de ") + days(c.gap_days) })) },
    { title: translate("fueron una época"), rows: data.phases.map((p) => ({ key: p.artist, name: p.artist, detail: pct(p.share) + translate(" de sus registros fueron en ") + p.year })) },
    { title: translate("siempre ahí"), rows: data.constants.map((c) => ({ key: c.artist, name: c.artist, detail: c.years + translate(" años en mis registros · ") + n(c.plays) + "e" })) },
  ].filter((c) => c.rows.length);

  return (
    <div className="movement-grid">
      {columns.map((column) => (
        <div className="movement-column" key={column.title}>
          <h3>{column.title}</h3>
          <ol className="movement-list">
            {column.rows.slice(0, 3).map((row) => (
              <li key={row.key}><span>{name(row.name)}</span><small>{row.detail}</small></li>
            ))}
          </ol>
          {column.rows.length > 3 && (
            <details className="movement-more">
              <summary>{translate("ver ")}{column.rows.length - 3}{translate(" más ＋")}</summary>
              <ol className="movement-list">
                {column.rows.slice(3).map((row) => (
                  <li key={row.key}><span>{name(row.name)}</span><small>{row.detail}</small></li>
                ))}
              </ol>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

export function ArtistGrid({ artists, limit }: { artists: ArtistLink[]; limit?: number }) {
  return (
    <ol className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-5">
      {artists.slice(0, limit).map((a) => (
        <li key={a.slug} className="group min-w-0">
          <Link href={`/artistas/${a.slug}`} className="block">
            <Cover seed={a.name} image={a.photo?.url ?? a.image} label={a.name} compact className="grayscale-[35%] transition duration-500 group-hover:grayscale-0" />
            <span className="mt-3 flex items-baseline gap-2">
              <span className="tabular text-xs text-muted">{String(a.rank).padStart(2, "0")}</span>
              <span className="truncate text-sm text-ink" title={a.name}>{a.name}</span>
            </span>
            <span className="tabular block pl-6 text-xs text-muted"><Count value={a.scrobbles} /></span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
