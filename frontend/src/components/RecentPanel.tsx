import { useMemo, useState } from "react";
import { weekSoFarChange, type Period, type PeriodKey, type RecentFile, type RecentState } from "../data/recent";
import type { MonthStat } from "../data/types";
import { monthYear, n, secureImage } from "../utils/format";
import { Cover } from "./Cover";
import { ListenLinks } from "./ListenLinks";
import { TimeChart, type TimePoint } from "./TimeChart";

type Tab = "today" | "week" | "month";
const tabs: [Tab, string][] = [["today", "hoy"], ["week", "semana"], ["month", "mes"]];

const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const weekdays = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

const parse = (iso: string) => new Date(`${iso}T12:00:00Z`);
const dayMonth = (iso: string) => { const d = parse(iso); return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`; };
const lastDay = (endExclusive: string) => new Date(parse(endExclusive).getTime() - 86_400_000).toISOString().slice(0, 10);

function range(p: Period): string {
  const end = lastDay(p.end_exclusive);
  return p.start === end ? dayMonth(p.start) : `${dayMonth(p.start)} — ${dayMonth(end)}`;
}

function chartFor(tab: Tab, data: RecentFile): { points: TimePoint[]; kind: "bars" | "line"; title: string } {
  if (tab === "today") {
    return {
      kind: "bars", title: "los últimos 14 días",
      points: data.series.days.map((d) => {
        const date = parse(d.date);
        return { key: d.date, value: d.scrobbles, complete: d.complete, title: `${weekdays[date.getUTCDay()]} ${dayMonth(d.date)}`,
          label: String(date.getUTCDate()) };
      }),
    };
  }
  if (tab === "week") {
    return {
      kind: "line", title: "las últimas 12 semanas",
      points: data.series.weeks.map((w, i) => ({ key: w.start, value: w.scrobbles, complete: w.complete,
        title: `semana del ${dayMonth(w.start)}`, label: (data.series.weeks.length - 1 - i) % 2 === 0 ? dayMonth(w.start) : "" })),
    };
  }
  return {
    kind: "line", title: "los últimos 12 meses",
    points: data.series.months.map((m) => ({ key: m.month, value: m.scrobbles, complete: m.complete,
      title: monthYear(m.month), label: months[Number(m.month.slice(5)) - 1] })),
  };
}

function RankBars({ items }: { items: { name: string; scrobbles: number }[] }) {
  if (!items.length) return <p className="recent-empty-line">nada registrado.</p>;
  const max = items[0].scrobbles || 1;
  return (
    <ol className="rank-bars">
      {items.map((a, i) => (
        <li key={a.name}>
          <span className="rank-bars-label"><span className="tabular">{i + 1}</span>{a.name}</span>
          <span className="rank-bars-track" aria-hidden="true"><span style={{ width: `${(a.scrobbles / max) * 100}%` }} /></span>
          <span className="rank-bars-value tabular">{n(a.scrobbles)}</span>
        </li>
      ))}
    </ol>
  );
}

function PeriodView({ period, label, change }: { period: Period; label: string; change: number | null }) {
  const album = period.top_albums[0];
  const coverUrl = secureImage(period.top_albums.find((a) => a.cover)?.cover?.url ?? null);
  const coverAlbum = period.top_albums.find((a) => a.cover) ?? album;
  return (
    <div className="recent-period">
      <div className="recent-figures">
        <p className="recent-range">
          {label} · {range(period)}
          {!period.complete && <span className="recent-running">en curso</span>}
        </p>
        <p className="recent-big"><span className="tabular">{n(period.scrobbles)}</span><small>escuchas</small></p>
        <dl className="recent-counts">
          <div><dt>artistas</dt><dd className="tabular">{n(period.unique_artists)}</dd></div>
          <div><dt>canciones</dt><dd className="tabular">{n(period.unique_tracks)}</dd></div>
          {period.unique_albums !== undefined && <div><dt>discos</dt><dd className="tabular">{n(period.unique_albums)}</dd></div>}
        </dl>
        {change !== null && (
          <p className="recent-change">
            {change >= 0 ? "+" : "−"}{Math.round(Math.abs(change) * 100)}% que la semana pasada a esta misma altura
          </p>
        )}
      </div>

      <div className="recent-cover">
        {coverAlbum ? (
          <figure className="group">
            <Cover seed={coverAlbum.title} image={coverUrl} label={`portada de ${coverAlbum.title}`} className="recent-cover-art" />
            <figcaption><span>el disco que más sonó</span><strong>{coverAlbum.title}</strong><span>{coverAlbum.artist}</span></figcaption>
          </figure>
        ) : <p className="recent-empty-line">sin discos en este período.</p>}
      </div>

      <div className="recent-lists">
        <section>
          <h3>artistas</h3>
          <RankBars items={period.top_artists} />
        </section>
        <section>
          <h3>canciones</h3>
          {period.top_tracks.length ? (
            <ol className="recent-tracks">
              {period.top_tracks.map((t, i) => (
                <li key={`${t.artist}-${t.title}`}>
                  <span className="tabular">{i + 1}</span>
                  <span className="recent-track-name"><strong>{t.title}</strong><small>{t.artist} · {n(t.scrobbles)}</small></span>
                  <ListenLinks artist={t.artist} title={t.title} />
                </li>
              ))}
            </ol>
          ) : <p className="recent-empty-line">nada registrado.</p>}
        </section>
        {period.top_albums.length > 1 && (
          <section>
            <h3>discos</h3>
            <ol className="recent-albums">
              {period.top_albums.map((a) => (
                <li key={`${a.artist}-${a.title}`} className="group">
                  <Cover seed={a.title} image={secureImage(a.cover?.url ?? null)} label={`portada de ${a.title}`} compact />
                  <span><strong>{a.title}</strong><small>{a.artist} · {n(a.scrobbles)}</small></span>
                </li>
              ))}
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
      <p>esta parte todavía no está publicada.</p>
      {last && <p>lo último que tengo es {monthYear(last.month)}: <strong className="tabular">{n(last.scrobbles)}</strong> escuchas.</p>}
    </div>
  );
}

export function RecentPanel({ state, history }: { state: RecentState; history: MonthStat[] }) {
  const [tab, setTab] = useState<Tab>("week");
  const [previous, setPrevious] = useState(false);
  const data = state.status === "ready" ? state.data : null;

  const view = useMemo(() => {
    if (!data) return null;
    const key: PeriodKey = tab === "today" ? "today" : tab === "week" ? (previous ? "last_week" : "this_week") : (previous ? "last_month" : "this_month");
    const label = tab === "today" ? "hoy" : tab === "week" ? (previous ? "la semana pasada" : "esta semana") : (previous ? "el mes pasado" : "este mes");
    const change = key === "this_week" ? weekSoFarChange(data) : null;
    return { period: data.periods[key], label, change, chart: chartFor(tab, data) };
  }, [data, tab, previous]);

  return (
    <section id="ultimamente" className="recent scroll-mt-6" aria-labelledby="recent-title">
      <header className="recent-header">
        <h2 id="recent-title">últimamente</h2>
        {data && (
          <div className="recent-controls">
            <div role="tablist" aria-label="período" className="recent-tabs">
              {tabs.map(([key, text]) => (
                <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "on" : ""}
                  onClick={() => { setTab(key); setPrevious(false); }}>{text}</button>
              ))}
            </div>
            {tab !== "today" && (
              <button className="recent-toggle" onClick={() => setPrevious((p) => !p)} aria-pressed={previous}>
                {tab === "week" ? (previous ? "← esta semana" : "la anterior →") : (previous ? "← este mes" : "el anterior →")}
              </button>
            )}
          </div>
        )}
      </header>

      {state.status === "loading" && <p role="status" className="recent-empty-line">cargando…</p>}
      {state.status === "unavailable" && <Unavailable months={history} />}
      {view && (
        <>
          <PeriodView period={view.period} label={view.label} change={view.change} />
          <div className="recent-chart">
            <p className="recent-chart-title">{view.chart.title}</p>
            <TimeChart points={view.chart.points} kind={view.chart.kind} label={`escuchas en ${view.chart.title}`} />
          </div>
        </>
      )}
    </section>
  );
}
