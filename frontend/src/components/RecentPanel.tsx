import { t as translate, useLanguage } from "../i18n";
import { Count } from "./Count";
import { useMemo, useState } from "react";
import { weekSoFarChange, type Period, type PeriodKey, type RecentFile, type RecentState } from "../data/recent";
import type { AlbumStat, MonthStat } from "../data/types";
import { Link } from "../utils/router";
import { monthYear, n, secureImage, shortMonth, shortWeekday } from "../utils/format";
import { Cover } from "./Cover";
import { ListenLinks } from "./ListenLinks";
import { PlayableTitle, usePreview } from "./PreviewPlayer";
import { PlayCount } from "./PlayCount";
import { TimeChart, type TimePoint } from "./TimeChart";

type Tab = "today" | "week" | "month";
const tabs: [Tab, string][] = [["today", "hoy"], ["week", "semana"], ["month", "mes"]];


const parse = (iso: string) => new Date(`${iso}T12:00:00Z`);
const dayMonth = (iso: string) => { const d = parse(iso); return `${d.getUTCDate()} ${shortMonth(d.getUTCMonth())}`; };
const lastDay = (endExclusive: string) => new Date(parse(endExclusive).getTime() - 86_400_000).toISOString().slice(0, 10);

function range(p: Period): string {
  const end = lastDay(p.end_exclusive);
  return p.start === end ? dayMonth(p.start) : `${dayMonth(p.start)} — ${dayMonth(end)}`;
}

function chartFor(tab: Tab, data: RecentFile): { points: TimePoint[]; kind: "bars" | "line"; title: string } {
  if (tab === "today") {
    return {
      kind: "bars", title: translate("los últimos 14 días"),
      points: data.series.days.map((d) => {
        const date = parse(d.date);
        return { key: d.date, value: d.scrobbles, complete: d.complete, track: d.top_track ?? null, title: `${shortWeekday(date.getUTCDay())} ${dayMonth(d.date)}`,
          label: String(date.getUTCDate()) };
      }),
    };
  }
  if (tab === "week") {
    return {
      kind: "line", title: translate("las últimas 12 semanas"),
      points: data.series.weeks.map((w, i) => ({ key: w.start, value: w.scrobbles, complete: w.complete, track: w.top_track ?? null,
        title: translate(`semana del ${dayMonth(w.start)}`), label: (data.series.weeks.length - 1 - i) % 2 === 0 ? dayMonth(w.start) : "" })),
    };
  }
  return {
    kind: "line", title: translate("los últimos 12 meses"),
    points: data.series.months.map((m) => ({ key: m.month, value: m.scrobbles, complete: m.complete, track: m.top_track ?? null,
      title: monthYear(m.month), label: shortMonth(Number(m.month.slice(5)) - 1) })),
  };
}

function RankBars({ items, artistSlugs }: { items: { name: string; scrobbles: number }[]; artistSlugs: Map<string, string> }) {
  if (!items.length) return <p className="recent-empty-line">{translate("nada registrado.")}</p>;
  const max = items[0].scrobbles || 1;
  return (
    <ol className="rank-bars">
      {items.map((a, i) => (
        <li key={a.name}>
          <span className="rank-bars-label"><span className="tabular">{i + 1}</span>{artistSlugs.has(a.name) ? <Link href={`/artistas/${artistSlugs.get(a.name)}`}>{a.name}</Link> : a.name}</span>
          <span className="rank-bars-track" aria-hidden="true"><span style={{ width: `${(a.scrobbles / max) * 100}%` }} /></span>
          <span className="rank-bars-value"><Count value={a.scrobbles} /></span>
        </li>
      ))}
    </ol>
  );
}

function PeriodView({ period, label, change, albums, artistSlugs }: { period: Period; label: string; change: number | null; albums: AlbumStat[]; artistSlugs: Map<string, string> }) {
  if (period.status === "unknown") {
    return <div className="recent-unavailable"><p>{translate("todavía no hay registros procesados para este período.")}</p><p>{translate("se actualiza con la próxima ejecución del pipeline.")}</p></div>;
  }
  const album = period.top_albums[0];
  const coverUrl = secureImage(period.top_albums.find((a) => a.cover)?.cover?.url ?? null);
  const coverAlbum = period.top_albums.find((a) => a.cover) ?? album;
  const knownAlbum = (artist: string, title: string, key?: string) => albums.find((album) => key ? album.key === key : album.artist === artist && album.title === title);
  const coverInfo = coverAlbum ? knownAlbum(coverAlbum.artist, coverAlbum.title, coverAlbum.key) : undefined;
  const coverYear = coverAlbum?.year ?? coverInfo?.year;
  const artistLink = (name: string) => artistSlugs.has(name) ? <Link href={`/artistas/${artistSlugs.get(name)}`}>{name}</Link> : name;
  return (
    <div className="recent-period">
      <div className="recent-figures">
        <p className="recent-range">
          {label} · {range(period)}
          {!period.complete && <span className="recent-running">{translate("en curso")}</span>}
        </p>
        <p className="recent-big"><span className="tabular">{n(period.scrobbles)}</span><small>e</small></p>
        <dl className="recent-counts">
          <div><dt>{translate("artistas")}</dt><dd className="tabular">{n(period.unique_artists)}</dd></div>
          <div><dt>{translate("canciones")}</dt><dd className="tabular">{n(period.unique_tracks)}</dd></div>
          {period.unique_albums !== undefined && <div><dt>{translate("discos")}</dt><dd className="tabular">{n(period.unique_albums)}</dd></div>}
        </dl>
        {change !== null && (
          <p className="recent-change">
            {change >= 0 ? "+" : "−"}{Math.round(Math.abs(change) * 100)}{translate("% que la semana pasada a esta misma altura ")}</p>
        )}
      </div>

      <div className="recent-cover">
        {coverAlbum ? (
          <figure className="group">
            {coverInfo ? <Link href={`/discos/${coverInfo.key}`} className="block"><Cover seed={coverAlbum.title} image={coverUrl} label={translate(`portada de ${coverAlbum.title}`)} album={{ artist: coverAlbum.artist, title: coverAlbum.title }} className="recent-cover-art" priority /></Link>
              : <Cover seed={coverAlbum.title} image={coverUrl} label={translate(`portada de ${coverAlbum.title}`)} album={{ artist: coverAlbum.artist, title: coverAlbum.title }} className="recent-cover-art" priority />}
            <figcaption><span>{translate("el disco que más sonó")}</span><strong>{coverInfo ? <Link href={`/discos/${coverInfo.key}`}>{coverAlbum.title}</Link> : coverAlbum.title}</strong><span>{artistLink(coverAlbum.artist)}{coverYear ? ` · ${coverYear}` : ""}</span></figcaption>
          </figure>
        ) : <p className="recent-empty-line">{translate("sin discos en este período.")}</p>}
      </div>

      <div className="recent-lists">
        <section>
          <h3>{translate("artistas")}</h3>
          <RankBars items={period.top_artists} artistSlugs={artistSlugs} />
        </section>
        <section>
          <h3>{translate("canciones")}</h3>
          {period.top_tracks.length ? (
            <ol className="recent-tracks">
              {period.top_tracks.map((t, i) => (
                <li key={`${t.artist}-${t.title}`}>
                  <span className="tabular">{i + 1}</span>
                  <span className="recent-track-name"><strong><PlayableTitle artist={t.artist} title={t.title} /></strong><small>{artistLink(t.artist)} · <PlayCount count={t.scrobbles} artist={t.artist} title={t.title} /></small></span>
                  <ListenLinks artist={t.artist} title={t.title} />
                </li>
              ))}
            </ol>
          ) : <p className="recent-empty-line">{translate("nada registrado.")}</p>}
        </section>
        {period.top_albums.length > 1 && (
          <section>
            <h3>{translate("discos")}</h3>
            <ol className="recent-albums">
              {period.top_albums.map((a) => {
                const info = knownAlbum(a.artist, a.title, a.key);
                const year = a.year ?? info?.year;
                const cover = <Cover seed={a.title} image={secureImage(a.cover?.url ?? null)} label={translate(`portada de ${a.title}`)} album={{ artist: a.artist, title: a.title }} compact />;
                return (
                <li key={`${a.artist}-${a.title}`} className="group">
                  {info ? <Link href={`/discos/${info.key}`}>{cover}</Link> : cover}
                  <span><strong>{info ? <Link href={`/discos/${info.key}`}>{a.title}</Link> : a.title}</strong><small>{artistLink(a.artist)}{year ? ` · ${year}` : ""} · <PlayCount count={a.scrobbles} artist={a.artist} title={a.title} /></small></span>
                </li>
              ); })}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}

function Unavailable({ months: history }: { months: MonthStat[] }) {
  const last = history[history.length - 1];
  return (
    <div className="recent-unavailable">
      <p>{translate("esta parte todavía no está publicada.")}</p>
      {last && <p>{translate("lo último que tengo es ")}{monthYear(last.month)}: <strong className="tabular">{n(last.scrobbles)}</strong> e.</p>}
    </div>
  );
}

/** full monthly history, to walk back year by year in the month chart */
export interface Archive { months: string[]; monthly: number[]; yearArtists: Record<number, string[]> }

export function RecentPanel({ state, history, archive, albums = [], artistSlugs = new Map() }: { state: RecentState; history: MonthStat[]; archive?: Archive; albums?: AlbumStat[]; artistSlugs?: Map<string, string> }) {
  const language = useLanguage();
  const [tab, setTab] = useState<Tab>("month");
  const [year, setYear] = useState<number | null>(null);
  // years with records: 2016 and 2020 onwards (2017–2019 were not tracked)
  const years = useMemo(() => [...new Set((archive?.months ?? []).map((m) => Number(m.slice(0, 4))))]
    .filter((y) => y === 2016 || y >= 2020).sort(), [archive]);
  const [previous, setPrevious] = useState(false);
  const data = state.status === "ready" ? state.data : null;
  const preview = usePreview();

  const view = useMemo(() => {
    if (!data) return null;
    const key: PeriodKey = tab === "today" ? "today" : tab === "week" ? (previous ? "last_week" : "this_week") : (previous ? "last_month" : "this_month");
    const label = tab === "today" ? translate("hoy") : tab === "week" ? (previous ? translate("la semana pasada") : translate("esta semana")) : (previous ? translate("el mes pasado") : translate("este mes"));
    const change = key === "this_week" ? weekSoFarChange(data) : null;
    let chart = chartFor(tab, data);
    if (tab === "month" && year !== null && archive) {
      const points = archive.months.map((m, i) => ({ m, v: archive.monthly[i] })).filter(({ m }) => Number(m.slice(0, 4)) === year)
        .map(({ m, v }) => {
          const pool = archive.yearArtists[year] ?? [];
          const who = pool[Math.floor(Math.random() * pool.length)];
          return { key: m, value: v, complete: true, title: monthYear(m), label: shortMonth(Number(m.slice(5)) - 1),
            track: who ? { artist: who, title: "" } : null };
        });
      chart = { kind: "line", title: String(year), points };
    }
    return { period: data.periods[key], label, change, chart };
  }, [data, tab, previous, year, archive, language]);
  const lastYear = years[years.length - 1];
  const idx = year === null ? years.length : years.indexOf(year);

  return (
    <section id="ultimamente" className="recent scroll-mt-6" aria-labelledby="recent-title">
      <header className="recent-header">
        <h2 id="recent-title">{translate("últimamente")}</h2>
        {data && (
          <div className="recent-controls">
            <div role="tablist" aria-label={translate("período")} className="recent-tabs">
              {tabs.map(([key, text]) => (
                <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "on" : ""}
                  onClick={() => { setTab(key); setPrevious(false); setYear(null); }}>{translate(text)}</button>
              ))}
            </div>
            {tab !== "today" && (
              <button className="recent-toggle" onClick={() => setPrevious((p) => !p)} aria-pressed={previous}>
                {tab === "week" ? (previous ? translate("← esta semana") : translate("la anterior →")) : (previous ? translate("← este mes") : translate("el anterior →"))}
              </button>
            )}
          </div>
        )}
      </header>

      {state.status === "loading" && <p role="status" className="recent-empty-line">{translate("cargando…")}</p>}
      {state.status === "unavailable" && <Unavailable months={history} />}
      {view && (
        <>
          <PeriodView period={view.period} label={view.label} change={view.change} albums={albums} artistSlugs={artistSlugs} />
          <div className="recent-chart">
            <div className="recent-chart-head">
              {tab === "month" && years.length > 0 && idx > 0 && (
                <button className="recent-toggle" onClick={() => setYear(years[idx - 1])}>← {years[idx - 1]}</button>
              )}
              <p className="recent-chart-title">{view.chart.title}</p>
              {tab === "month" && year !== null && (
                <button className="recent-toggle" onClick={() => setYear(year === lastYear ? null : years[idx + 1])}>
                  {year === lastYear ? translate("últimos 12 meses →") : `${years[idx + 1]} →`}
                </button>
              )}
            </div>
            <TimeChart points={view.chart.points} kind={view.chart.kind} label={translate(`e en ${view.chart.title}`)}
              onPick={preview ? (p) => p.track && preview.play(p.track.artist, p.track.title) : undefined} />
          </div>
        </>
      )}
    </section>
  );
}
