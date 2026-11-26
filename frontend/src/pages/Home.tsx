import { Albums } from "../components/Albums";
import { RecentPanel } from "../components/RecentPanel";
import type { RecentState } from "../data/recent";
import { Medallion } from "../components/Medallion";
import { Line, yearTicks } from "../components/Charts";
import { ArtistGrid, Movements, Readings, YearStory } from "../components/Insights";
import { Rhythm } from "../components/Rhythm";
import { Section } from "../components/Section";
import { Tracks } from "../components/Tracks";
import type { InsightsFile, StatsFile } from "../data/types";
import { pct } from "../utils/format";
import { Link } from "../utils/router";

const weekdays = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

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

export function Home({ stats, insights, recent }: { stats: StatsFile; insights: InsightsFile | null; recent: RecentState }) {
  const slugs = new Map((insights?.artists ?? []).map((a) => [a.name, a.slug]));
  const linkFor = (artist: string) => (slugs.has(artist) ? "/artistas/" + slugs.get(artist) : null);
  const monthly = insights ? null : stats.months;

  return (
    <>
      <RecentPanel state={recent} history={stats.months} />

      <div className="archive-divider" id="archivo">
        <span>el archivo</span>
        <span>2016 y de 2020 en adelante · entre 2017 y 2019 no registré nada</span>
      </div>

      {stats.top_albums && stats.top_albums.length > 0 && (
        <Section id="discos" title="los discos de siempre">
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
