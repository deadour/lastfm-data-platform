import { useState } from "react";
import type { ArtistLink, InsightsFile, YearInsight } from "../data/types";
import { days, longDate, monthYear, n, pct } from "../utils/format";
import { Link } from "../utils/router";
import { Cover } from "./Cover";
import { HourBars } from "./Charts";

function Reading({ label, value, detail, number }: { label: string; value: string; detail?: string; number: string }) {
  return (
    <article className="reading-card">
      <div className="reading-card-top"><span>{label}</span><span>{number}</span></div>
      <strong>{value}</strong>
      {detail && <p>{detail}</p>}
    </article>
  );
}

export function Readings({ data }: { data: InsightsFile }) {
  const { first_ever: first, habits } = data;
  return (
    <div className="reading-layout">
      <div className="reading-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
        <Reading number="01" label="la primera" value={first.title} detail={first.artist + " · " + longDate(first.date)} />
      </div>
      <div className="reading-hours">
        <div className="reading-hours-header">
          <span>mi horario</span>
          <strong>{String(habits.peak_hour).padStart(2, "0")}:00</strong>
        </div>
        <HourBars values={habits.hours.map((h) => Math.round(h * 10000))} label="distribución histórica según la hora local" />
        <p>por hora · todo el historial</p>
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
        {year.partial && <span className="mt-1 block text-xs text-muted/70">año incompleto</span>}
      </div>
      <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted">artista del año</dt>
          <dd className="music-name mt-1 text-lg text-ink">
            {top ? <Link href={top} className="hover:underline hover:decoration-white/30 hover:underline-offset-4">{year.top_artist}</Link> : year.top_artist}
          </dd>
          <dd className="text-muted">{pct(year.top_artist_share)} del total</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">canción del año</dt>
          <dd className="mt-1 text-ink">{year.top_track.title}</dd>
          <dd className="text-muted">de {year.top_track.artist}, {n(year.top_track.plays)} veces</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">descubrimiento</dt>
          <dd className="mt-1 text-ink">{year.discovery?.artist ?? "—"}</dd>
          <dd className="text-muted">entre {n(year.new_artists)} artistas nuevos</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">disco del año</dt>
          <dd className="mt-1 text-ink">{year.top_album?.title ?? "—"}</dd>
          {year.top_album && <dd className="text-muted">de {year.top_album.artist}</dd>}
        </div>
      </dl>
      {year.top_album ? (
        <div className="group hidden md:block">
          <Cover seed={year.top_album.title} image={year.top_album.cover?.url} label={`portada de ${year.top_album.title}`} compact />
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
      <div className="year-selector" role="group" aria-label="elegir año">
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
    { title: "volvieron · desde 2020", rows: data.comebacks.map((c) => ({ key: c.artist, name: c.artist, detail: "lo volví a poner en " + monthYear(c.returned) + ", después de " + days(c.gap_days) })) },
    { title: "fueron una época", rows: data.phases.map((p) => ({ key: p.artist, name: p.artist, detail: pct(p.share) + " de sus registros fueron en " + p.year })) },
    { title: "siempre ahí", rows: data.constants.map((c) => ({ key: c.artist, name: c.artist, detail: c.years + " años en mis registros · " + n(c.plays) + "e" })) },
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
              <summary>ver {column.rows.length - 3} más ＋</summary>
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
            <span className="tabular block pl-6 text-xs text-muted">{n(a.scrobbles)}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
