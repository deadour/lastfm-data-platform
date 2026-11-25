import type { ArtistLink, InsightsFile, YearInsight } from "../data/types";
import { days, longDate, monthYear, n, pct } from "../utils/format";
import { Link } from "../utils/router";
import { Cover } from "./Cover";
import { HourBars } from "./Charts";

const weekdays = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

function Reading({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-5">
      <span className="text-xs tracking-wide text-muted">{label}</span>
      <strong className="font-serif text-2xl font-normal leading-tight text-ink md:text-[1.7rem]">{value}</strong>
      {detail && <span className="text-sm leading-relaxed text-muted">{detail}</span>}
    </div>
  );
}

export function Readings({ data }: { data: InsightsFile }) {
  const { first_ever: first, busiest_day: day, obsession, binge, session, habits } = data;
  return (
    <div className="grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
      <Reading label="todo empezó con" value={first.title}
        detail={`de ${first.artist}. fue lo primero que quedó registrado, el ${longDate(first.date)}.`} />
      <Reading label="el día que más escuché" value={`${n(day.scrobbles)} temas`}
        detail={`fue el ${longDate(day.date)}, y la mayoría eran de ${day.top_artist}.`} />
      <Reading label="la que puse en loop" value={`${n(obsession.plays)} veces`}
        detail={`escuché ${obsession.title}, de ${obsession.artist}, ${n(obsession.plays)} veces en un solo día: el ${longDate(obsession.date)}.`} />
      <Reading label="la maratón" value={`${n(binge.plays)} temas seguidos`}
        detail={`todos de ${binge.artist}, sin meter a nadie más en el medio. pasó el ${longDate(binge.date)}.`} />
      <Reading label="la sesión más larga" value={`${session.hours.toLocaleString("es-AR")} horas`}
        detail={`${n(session.plays)} temas casi sin parar (nunca más de media hora entre uno y otro), el ${longDate(session.date)}.`} />
      <Reading label="mis diez de siempre" value={pct(habits.top10_share)}
        detail="de todo lo que escuché es de mis diez artistas más escuchados. casi un tercio." />
      <div className="flex flex-col gap-3 border-t border-line pt-5 sm:col-span-2">
        <span className="text-xs tracking-wide text-muted">a qué hora escucho</span>
        <HourBars values={habits.hours.map((h) => Math.round(h * 10000))} label="escuchas por hora del día, hora local" />
        <span className="text-sm text-muted">
          la hora en que más escucho es a las {habits.peak_hour}. un {pct(habits.night_share)} de todo cae entre las 0 y las 6 de la mañana, y un {pct(habits.weekend_share)} es del fin de semana.
        </span>
      </div>
      <div className="flex flex-col gap-3 border-t border-line pt-5">
        <span className="text-xs tracking-wide text-muted">qué día de la semana</span>
        <ol className="flex flex-col gap-1.5">
          {habits.weekdays.map((share, i) => (
            <li key={weekdays[i]} className="grid grid-cols-[2.5rem_1fr_3rem] items-center gap-3 text-sm">
              <span className="text-muted">{weekdays[i]}</span>
              <span className="h-px bg-white/45 grow-x" style={{ width: `${(share / Math.max(...habits.weekdays)) * 100}%` }} />
              <span className="tabular text-right text-muted">{pct(share)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function YearRow({ year, linkFor }: { year: YearInsight; linkFor: (artist: string) => string | null }) {
  const top = linkFor(year.top_artist);
  return (
    <li className="grid gap-6 border-t border-line py-8 md:grid-cols-[8rem_minmax(0,1fr)_9rem] md:gap-10">
      <div>
        <span className="font-serif text-4xl text-ink">{year.year}</span>
        <span className="tabular mt-2 block text-sm text-muted">{n(year.scrobbles)} escuchas</span>
        {year.partial && <span className="mt-1 block text-xs text-muted/70">año incompleto</span>}
      </div>
      <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted">el artista del año</dt>
          <dd className="mt-1 font-serif text-xl text-ink">
            {top ? <Link href={top} className="hover:underline hover:decoration-white/30 hover:underline-offset-4">{year.top_artist}</Link> : year.top_artist}
          </dd>
          <dd className="text-muted">{pct(year.top_artist_share)} de todo lo que escuché ese año</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">el tema del año</dt>
          <dd className="mt-1 text-ink">{year.top_track.title}</dd>
          <dd className="text-muted">de {year.top_track.artist}, {n(year.top_track.plays)} veces</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">el descubrimiento</dt>
          <dd className="mt-1 text-ink">{year.discovery?.artist ?? "—"}</dd>
          <dd className="text-muted">de los {n(year.new_artists)} artistas que escuché por primera vez</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">el disco del año</dt>
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
  return <ol>{[...years].reverse().map((y) => <YearRow key={y.year} year={y} linkFor={linkFor} />)}</ol>;
}

export function Movements({ data, linkFor }: { data: InsightsFile; linkFor: (artist: string) => string | null }) {
  const name = (artist: string) => {
    const href = linkFor(artist);
    return href ? <Link href={href} className="hover:underline hover:decoration-white/30 hover:underline-offset-4">{artist}</Link> : artist;
  };
  const columns = [
    { title: "los que volvieron", rows: data.comebacks.map((c) => ({ key: c.artist, name: c.artist, detail: `lo volví a escuchar en ${monthYear(c.returned)}, después de ${days(c.gap_days)} sin ponerlo.` })) },
    { title: "etapas que pasaron", rows: data.phases.map((p) => ({ key: p.artist, name: p.artist, detail: `el ${pct(p.share)} de todo lo que le escuché fue en ${p.year}.` })) },
    { title: "los que nunca se fueron", rows: data.constants.map((c) => ({ key: c.artist, name: c.artist, detail: `está en ${c.years} años distintos, con ${n(c.plays)} escuchas en total.` })) },
  ].filter((c) => c.rows.length);
  return (
    <div className="grid gap-12 md:grid-cols-3">
      {columns.map((c) => (
        <div key={c.title}>
          <h3 className="mb-4 text-xs tracking-wide text-muted">{c.title}</h3>
          <ol className="flex flex-col">
            {c.rows.map((r) => (
              <li key={r.key} className="border-t border-line py-3">
                <span className="block font-serif text-lg text-ink">{name(r.name)}</span>
                <span className="block text-sm text-muted">{r.detail}</span>
              </li>
            ))}
          </ol>
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
