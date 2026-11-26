import { Albums } from "../components/Albums";
import { RecentPanel } from "../components/RecentPanel";
import type { RecentState } from "../data/recent";
import type { ExploreFile } from "../data/explore";
import { CalendarHeatmap, GenreLines, GenreTreemap, MonthsVsAverage, YearRanks } from "../components/Explore";
import { Line, yearTicks } from "../components/Charts";
import { ArtistGrid, Movements, Readings, YearStory } from "../components/Insights";
import { Rhythm } from "../components/Rhythm";
import { Section } from "../components/Section";
import { RetroIcon } from "../components/RetroIcon";
import { Tracks } from "../components/Tracks";
import type { InsightsFile, StatsFile } from "../data/types";
import { n, pct } from "../utils/format";
import { Link } from "../utils/router";
import { usePreview } from "../components/PreviewPlayer";

const weekdays = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

function WeekPreview({ data }: { data: InsightsFile }) {
  const shares = data.habits.weekdays;
  const max = Math.max(...shares, Number.EPSILON);
  const peak = shares.indexOf(Math.max(...shares));
  return (
    <div className="week-preview">
      <div className="week-preview-heading">
        <div><span className="eyebrow">mis horarios</span><h3 className="heading-with-icon"><RetroIcon kind="calendar" />mi semana</h3></div>
        <span>promedio histórico</span>
      </div>
      <div className="week-preview-chart" role="img" aria-label="distribución histórica por día de la semana">
        {shares.map((share, i) => (
          <div className="week-day" key={weekdays[i]}>
            <div className="week-day-track"><span className={i === peak ? "peak" : ""} style={{ height: Math.max(3, share / max * 100) + "%" }} /></div>
            <small>{weekdays[i]}</small>
          </div>
        ))}
      </div>
      <p>más música los {["lunes", "martes", "miércoles", "jueves", "viernes", "sábados", "domingos"][peak]} · {pct(shares[peak])} del total semanal</p>
    </div>
  );
}

export function Home({ stats, insights, recent, explore }: {
  stats: StatsFile; insights: InsightsFile | null; recent: RecentState; explore: ExploreFile | null;
}) {
  const slugs = new Map((insights?.artists ?? []).map((a) => [a.name, a.slug]));
  const linkFor = (artist: string) => (slugs.has(artist) ? "/artistas/" + slugs.get(artist) : null);
  const preview = usePreview();
  // my most played song by that artist starts, and their page opens when I have one
  const openArtist = (artist: string) => {
    const slug = slugs.get(artist) ?? null;
    preview?.play(artist, "", slug);
  };
  const monthly = insights ? null : stats.months;

  return (
    <>
      <RecentPanel state={recent} history={stats.months} />

      <div className="archive-divider" id="archivo">
        <span>el archivo</span>
        <span>2016 y de 2020 en adelante · entre 2017 y 2019 no registré nada</span>
      </div>

      {explore && (
        <Section id="ultimo-ano" title="el último año, día por día">
          <CalendarHeatmap calendar={explore.calendar} />
        </Section>
      )}

      {explore?.genres && explore.genres.families.length > 0 && (
        <Section id="generos" title="qué géneros" aside={<span>según los tags de last.fm · {pct(explore.genres.coverage)} del total</span>}>
          <div className="genre-grid">
            <div>
              <h3>todo el historial</h3>
              <GenreTreemap families={explore.genres.families} artists={explore.genres.artists_by_family} onPick={openArtist} />
            </div>
            <div>
              <h3>año por año</h3>
              <GenreLines byYear={explore.genres.by_year} />
              <div className="genre-styles" aria-label="los estilos que más escucho">
                {explore.genres.styles.slice(0, 10).map((s) => <span key={s.style}>{s.style}<small>{n(s.plays)}</small></span>)}
              </div>
            </div>
          </div>
        </Section>
      )}

      {insights && (
        <Section id="mes-a-mes" title="mes a mes, contra mi promedio">
          <MonthsVsAverage months={insights.months} monthly={insights.monthly} />
        </Section>
      )}

      {explore && explore.year_ranks.length > 0 && (
        <Section id="quien-mando" title="lo que más escuché">
          <YearRanks ranks={explore.year_ranks} />
        </Section>
      )}

      {explore && (explore.rarities.off_genre.length > 0 || explore.rarities.one_day.length > 0) && (
        <Section id="rarezas" title="los que no tienen nada que ver" icon={<RetroIcon />}>
          <div className="odd-ones">
            {explore.rarities.off_genre.length > 0 && (
              <div>
                <p className="explore-sub">cosas que escucho a veces</p>
                <ol>{explore.rarities.off_genre.map((a) => <li key={a.name}><strong>{a.name}</strong><small>{a.style ?? a.family} · <span className="count-value">{n(a.plays)}<small className="count-unit">e</small></span></small></li>)}</ol>
              </div>
            )}
            {explore.rarities.one_day.length > 0 && (
              <div>
                <p className="explore-sub">los escuché un solo día</p>
                <ol>{explore.rarities.one_day.map((a) => <li key={a.name}><strong>{a.name}</strong><small>{n(a.plays)} veces el {a.date.split("-").reverse().join("/")}</small></li>)}</ol>
              </div>
            )}
          </div>
        </Section>
      )}

      {stats.top_albums && stats.top_albums.length > 0 && (
        <Section id="discos" title="los discos de siempre" icon={<RetroIcon kind="disc" />}>
          <Albums albums={stats.top_albums} />
        </Section>
      )}

      {insights && (
        <Section id="lecturas" title="cosas que encontré" icon={<RetroIcon />}>
          <Readings data={insights} />
        </Section>
      )}

      <div className="home-split">
        <div>
          <Section id="canciones" title="en repeat" icon={<RetroIcon kind="disc" />}>
            <Tracks tracks={stats.top_tracks} />
          </Section>
        </div>
        {insights && <WeekPreview data={insights} />}
      </div>

      {insights && insights.artists.length > 0 && (
        <Section id="artistas" title="artistas" icon={<RetroIcon />} aside={<Link href="/artistas" className="hover:text-ink">ver todos ↗</Link>}>
          <ArtistGrid artists={insights.artists} limit={10} />
        </Section>
      )}

      {insights && (
        <Section id="anos" title="año por año" icon={<RetroIcon kind="calendar" />}>
          <p className="section-intro">elegí un año para ver qué fue lo que más escuché.</p>
          <YearStory years={insights.years} linkFor={linkFor} />
        </Section>
      )}

      <details className="archive-deep-dive">
        <summary><span className="heading-with-icon"><RetroIcon />más del archivo</span><span>idas y vueltas, horas y meses <span aria-hidden="true">＋</span></span></summary>
        <div className="archive-deep-dive-body">
          {insights && <section id="idas-y-vueltas" className="py-8"><h2 className="heading-with-icon"><RetroIcon />idas y vueltas</h2><Movements data={insights} linkFor={linkFor} /></section>}
          <section id="tiempo" className="py-8">
            <h2 className="heading-with-icon"><RetroIcon kind="calendar" />en el tiempo</h2>
            {insights ? (
              <Line values={insights.monthly} ticks={yearTicks(insights.months, 1)} label="registros por mes, toda la historia" />
            ) : monthly && (
              <Line values={monthly.map((m) => m.scrobbles)} ticks={[]} label="registros por mes" />
            )}
          </section>
          <section id="ritmo" className="py-8"><h2 className="heading-with-icon"><RetroIcon kind="calendar" />día y hora</h2><Rhythm cells={stats.rhythm} /></section>
        </div>
      </details>

    </>
  );
}
