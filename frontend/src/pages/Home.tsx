import { Albums } from "../components/Albums";
import { Medallion } from "../components/Medallion";
import { Bars, Line, yearTicks } from "../components/Charts";
import { ArtistGrid, Movements, Readings, YearStory } from "../components/Insights";
import { Rhythm } from "../components/Rhythm";
import { Section } from "../components/Section";
import { Tracks } from "../components/Tracks";
import type { InsightsFile, StatsFile } from "../data/types";
import { monthLabel, n, pct } from "../utils/format";
import { Link } from "../utils/router";

const weekdays = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

function RecentListening({ stats, insights }: { stats: StatsFile; insights: InsightsFile | null }) {
  const recent = stats.months.slice(-12);
  const latest = recent[recent.length - 1];
  const year = insights?.years[insights.years.length - 1];
  const top = year?.top_album;

  return (
    <section id="ahora-en-numeros" className="listening-board scroll-mt-6" aria-labelledby="listening-title">
      <div className="listening-board-main">
        <div className="listening-kicker"><span className="listening-signal" /> el registro sigue</div>
        <h2 id="listening-title">últimamente<span>.</span></h2>
        <div className="listening-stat">
          <span className="listening-stat-number">{latest ? n(latest.scrobbles) : "—"}</span>
          <div className="listening-stat-caption">
            <span>escuchas</span>
            <span>{latest ? monthLabel(latest.month) : "último mes registrado"}</span>
          </div>
        </div>
        <div className="listening-mini-chart">
          <div className="listening-chart-heading"><span>últimos 12 meses</span><span>cada barra, un mes</span></div>
          <Bars
            values={recent.map((m) => m.scrobbles)}
            labels={recent.map((m, i) => (i % 3 === 0 || i === recent.length - 1 ? monthLabel(m.month) : ""))}
            label="escuchas registradas en los últimos doce meses"
            height={94}
          />
        </div>
      </div>
      <div className="listening-board-side">
        <div className="listening-side-top">el año / {year?.year ?? stats.years[stats.years.length - 1]?.year ?? "—"}</div>
        {top?.cover?.url ? (
          <div className="listening-art-frame">
            <img src={top.cover.url} alt={"portada de " + top.title} loading="lazy" />
          </div>
        ) : <div className="listening-vinyl" aria-hidden="true"><span /></div>}
        <div className="listening-side-bottom">
          <span>el disco que más repetí</span>
          <strong>{top?.title ?? stats.top_albums?.[0]?.title ?? "—"}</strong>
          <span>{top?.artist ?? stats.top_albums?.[0]?.artist ?? ""}</span>
        </div>
      </div>
    </section>
  );
}

function WeekPreview({ data }: { data: InsightsFile }) {
  const shares = data.habits.weekdays;
  const max = Math.max(...shares, Number.EPSILON);
  const peak = shares.indexOf(Math.max(...shares));
  return (
    <div className="week-preview">
      <div className="week-preview-heading">
        <div><span className="eyebrow">mis horarios</span><h3>mi semana</h3></div>
        <span>promedio histórico</span>
      </div>
      <div className="week-preview-chart" role="img" aria-label="distribución histórica de escuchas por día de la semana">
        {shares.map((share, i) => (
          <div className="week-day" key={weekdays[i]}>
            <div className="week-day-track"><span className={i === peak ? "peak" : ""} style={{ height: Math.max(3, share / max * 100) + "%" }} /></div>
            <small>{weekdays[i]}</small>
          </div>
        ))}
      </div>
      <p>más música los {["lunes", "martes", "miércoles", "jueves", "viernes", "sábados", "domingos"][peak]} · {pct(shares[peak])} de las escuchas por día de la semana</p>
    </div>
  );
}

export function Home({ stats, insights }: { stats: StatsFile; insights: InsightsFile | null }) {
  const slugs = new Map((insights?.artists ?? []).map((a) => [a.name, a.slug]));
  const linkFor = (artist: string) => (slugs.has(artist) ? "/artistas/" + slugs.get(artist) : null);
  const monthly = insights ? null : stats.months;

  return (
    <>
      <RecentListening stats={stats} insights={insights} />

      {stats.top_albums && stats.top_albums.length > 0 && (
        <Section id="discos" title="discos">
          <Albums albums={stats.top_albums} />
        </Section>
      )}

      {insights && (
        <Section id="lecturas" title="cosas que encontré">
          <Readings data={insights} />
        </Section>
      )}

      <div className="home-split">
        <div>
          <Section id="canciones" title="en repeat">
            <Tracks tracks={stats.top_tracks} />
          </Section>
        </div>
        {insights && <WeekPreview data={insights} />}
      </div>

      {insights && insights.artists.length > 0 && (
        <Section id="artistas" title="artistas" aside={<Link href="/artistas" className="hover:text-ink">ver todos ↗</Link>}>
          <ArtistGrid artists={insights.artists} limit={10} />
        </Section>
      )}

      {insights && (
        <Section id="anos" title="año por año">
          <p className="section-intro">elegí un año para ver qué fue lo que más escuché.</p>
          <YearStory years={insights.years} linkFor={linkFor} />
        </Section>
      )}

      <details className="archive-deep-dive">
        <summary><span>más del archivo</span><span>idas y vueltas, horas y meses <span aria-hidden="true">＋</span></span></summary>
        <div className="archive-deep-dive-body">
          {insights && <section id="idas-y-vueltas" className="py-8"><h2>idas y vueltas</h2><Movements data={insights} linkFor={linkFor} /></section>}
          <section id="tiempo" className="py-8">
            <h2>en el tiempo</h2>
            {insights ? (
              <Line values={insights.monthly} ticks={yearTicks(insights.months, 1)} label="escuchas por mes, toda la historia" />
            ) : monthly && (
              <Line values={monthly.map((m) => m.scrobbles)} ticks={[]} label="escuchas por mes" />
            )}
          </section>
          <section id="ritmo" className="py-8"><h2>día y hora</h2><Rhythm cells={stats.rhythm} /></section>
        </div>
      </details>

      <section id="como-esta-hecho" className="home-about">
        <div>
          <span className="eyebrow">este proyecto</span>
          <h2>de last.fm<br />a una web.</h2>
          <p>tenía años de escuchas guardadas. aproveché esos datos para practicar cosas que vi en la facultad y que uso en el trabajo.</p>
          <Link href="/como-esta-hecho" className="home-about-link">cómo lo armé ↗</Link>
        </div>
        <div className="home-medallion"><Medallion fluid scrobbles={stats.totals.scrobbles} artists={stats.totals.artists} years={stats.years.length} /></div>
      </section>
    </>
  );
}
