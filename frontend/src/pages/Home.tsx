import { t as translate } from "../i18n";
import { useState } from "react";
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
import { monthYear, n, pct, shortWeekday } from "../utils/format";
import { Cover } from "../components/Cover";
import { Count } from "../components/Count";
import { Link, navigate } from "../utils/router";
import { usePreview } from "../components/PreviewPlayer";

const weekdays = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

function WeekPreview({ data, tracks }: { data: InsightsFile; tracks?: ExploreFile["weekday_tracks"] }) {
  const preview = usePreview();
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const shares = data.habits.weekdays;
  const max = Math.max(...shares, Number.EPSILON);
  const peak = shares.indexOf(Math.max(...shares));
  return (
    <div className="week-preview">
      <div className="week-preview-heading">
        <div><h3 className="heading-with-icon"><RetroIcon kind="calendar" />{translate("qué día escucho más")}</h3></div>
        <span>{translate("sumando todos los años")}</span>
      </div>
      <div className="week-preview-chart" role="group" aria-label={translate("distribución histórica por día de la semana")}>
        {shares.map((share, i) => {
          const songs = tracks?.find((day) => day.weekday === i)?.tracks ?? [];
          return (
          <button type="button" className="week-day" key={weekdays[i]} disabled={!songs.length} aria-pressed={selectedDay === i}
            title={`${shortWeekday((i + 1) % 7)} · ${translate("escuchar algo de ese día")}`}
            onClick={() => { setSelectedDay(i); preview?.playQueue(songs); }}>
            <div className="week-day-track"><span className={i === peak ? "peak" : ""} style={{ height: Math.max(3, share / max * 100) + "%" }} /></div>
            <small>{shortWeekday((i + 1) % 7)}</small>
          </button>
        ); })}
      </div>
      <p>{translate("más música los ")}{[translate("lunes"), translate("martes"), translate("miércoles"), translate("jueves"), translate("viernes"), translate("sábados"), translate("domingos")][peak]} · {pct(shares[peak])}{translate(" del total semanal")}</p>
    </div>
  );
}

function OddPhoto({ name, url }: { name: string; url?: string }) {
  return <span className="odd-photo"><Cover seed={name} image={url ?? null} label={name} compact /></span>;
}

/** "ver más" under a home section: goes to the full page of that list */
function SeeMore({ href }: { href: string }) {
  return <Link href={href} className="more-from-archive">{translate("ver más →")}</Link>;
}

function GoldMore({ gold, play }: { gold: NonNullable<ExploreFile["gold"]>; play: (artist: string) => void }) {
  const preview = usePreview();
  return (
    <div className="gold-more">
      <section>
        <h3>{translate("top 10 artistas")}</h3>
        <p className="gold-note">{translate("años en mi top 10")}</p>
        <ol>{gold.loyal.map((a) => <li key={a.name}><button type="button" className="text-left min-w-0" onClick={() => play(a.name)}><strong>{a.name}</strong></button><span className="tabular">{a.years_in_top_10}</span></li>)}</ol>
      </section>
      <section>
        <h3>{translate("top 10 artistas")}</h3>
        <p className="gold-note">{translate("días distintos sonando")}</p>
        <ol>{gold.most_days.map((a) => <li key={a.name}><button type="button" className="text-left min-w-0" onClick={() => play(a.name)}><strong>{a.name}</strong></button><span className="tabular">{n(a.days)}</span></li>)}</ol>
      </section>
      <section>
        <h3>{translate("top 10 temas")}</h3>
        <p className="gold-note">{translate("días distintos sonando")}</p>
        <ol>{gold.evergreen_tracks.map((t) => <li key={t.artist + t.title} onClick={() => preview?.play(t.artist, t.title)}><strong>{t.title}</strong><small>{t.artist}</small><span className="tabular">{n(t.days)}</span></li>)}</ol>
      </section>
      <section>
        <h3>{translate("rachas")}</h3>
        <p className="gold-note">{translate("días seguidos escuchando")}</p>
        <ol>{gold.streaks.map((r) => <li key={r.start}><strong className="tabular">{r.days}{translate(" días")}</strong><small>{r.start.split("-").reverse().join("/")} → {r.end.split("-").reverse().join("/")}</small></li>)}</ol>
      </section>
      <dl className="gold-facts">
        <div><dt>{translate("mi mejor mes")}</dt><dd>{monthYear(gold.best_month.month)} · <Count value={gold.best_month.plays} /></dd></div>
        {gold.avg_per_active_day !== null && <div><dt>{translate("un día normal")}</dt><dd><Count value={Math.round(gold.avg_per_active_day)} /></dd></div>}
        <div><dt>{translate("artistas en total")}</dt><dd className="tabular">{n(gold.artists_total)}</dd></div>
        <div><dt>{translate("escuchados una sola vez")}</dt><dd className="tabular">{n(gold.one_play_artists)}</dd></div>
      </dl>
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
    if (slug) navigate(`/artistas/${slug}`);
  };
  const monthly = insights ? null : stats.months;

  return (
    <>
      <RecentPanel state={recent} history={stats.months} albums={stats.top_albums} artistSlugs={slugs} archive={insights ? {
        months: insights.months, monthly: insights.monthly,
        yearArtists: Object.fromEntries((explore?.year_ranks ?? []).map((r) => [r.year, r.top_artists.map((a) => a.name)])),
      } : undefined} />

      <div className="archive-divider" id="archivo">
        <span>{translate("el archivo")}</span>
        <span>{translate("2016 y de 2020 en adelante · entre 2017 y 2019 no hay datos")}</span>
      </div>

      {explore && (
        <Section id="ultimo-ano" title={translate("el último año, día por día")}>
          <CalendarHeatmap calendar={explore.calendar} />
        </Section>
      )}

      {explore?.genres && explore.genres.families.length > 0 && (
        <Section id="generos" title={translate("qué géneros")} aside={<span>{translate("según los tags de last.fm · ")}{pct(explore.genres.coverage)}{translate(" del total")}</span>}>
          <div className="genre-grid">
            <div>
              <h3>{translate("todo el historial")}</h3>
              <GenreTreemap families={explore.genres.families} artists={explore.genres.artists_by_family}
                onPick={(names) => preview?.playGenre(names)} />
            </div>
            <div>
              <h3>{translate("año por año")}</h3>
              <GenreLines byYear={explore.genres.by_year} />
              <div className="genre-styles" aria-label={translate("los estilos que más escucho")}>
                {explore.genres.styles.slice(0, 10).map((s) => <span key={s.style}>{s.style}<small>{n(s.plays)}</small></span>)}
              </div>
            </div>
          </div>
        </Section>
      )}

      {insights && insights.artists.length > 0 && (
        <Section id={translate("artistas")} title={translate("artistas")} icon={<RetroIcon kind="person" />} aside={<Link href="/artistas" className="hover:text-ink">{translate("ver todos ↗")}</Link>}>
          <ArtistGrid artists={insights.artists} limit={15} />
          <SeeMore href="/artistas" />
        </Section>
      )}

      {insights && (
        <Section id="mes-a-mes" title={translate("mes a mes, contra mi promedio")}>
          <MonthsVsAverage months={insights.months} monthly={insights.monthly} />
        </Section>
      )}

      <Section id="tiempo" title={translate("en el tiempo")}>
        {insights ? (
          <Line values={insights.monthly} ticks={yearTicks(insights.months, 1)} label={translate("registros por mes, toda la historia")} />
        ) : monthly && (
          <Line values={monthly.map((m) => m.scrobbles)} ticks={[]} label={translate("registros por mes")} />
        )}
      </Section>

      {explore && explore.year_ranks.length > 0 && (
        <Section id="quien-mando" title={translate("lo que más escuché")} icon={<RetroIcon kind="cd" />}>
          <YearRanks ranks={explore.year_ranks} onPick={openArtist} />
        </Section>
      )}


      {stats.top_albums && stats.top_albums.length > 0 && (
        <Section id={translate("discos")} title={translate("los discos de siempre")} icon={<RetroIcon kind="drive" />}>
          <Albums albums={stats.top_albums} />
          <SeeMore href="/discos" />
        </Section>
      )}

      {insights && (
        <Section id="lecturas" title={translate("cosas que encontré")} icon={<RetroIcon kind="find" />}>
          <Readings data={insights} />
        </Section>
      )}

      <div className="home-split">
        <div>
          <Section id={translate("canciones")} title={translate("en loop")} icon={<RetroIcon kind="speaker" />}>
            <Tracks tracks={stats.top_tracks} />
            <SeeMore href="/canciones" />
          </Section>
        </div>
        {insights && <WeekPreview data={insights} tracks={explore?.weekday_tracks} />}
      </div>


      {insights && (
        <Section id="anos" title={translate("año por año")} icon={<RetroIcon kind="calendar" />}>
          <p className="section-intro">{translate("elegí un año para ver qué fue lo que más escuché.")}</p>
          <YearStory years={insights.years} linkFor={linkFor} />
        </Section>
      )}

      {explore && (explore.rarities.off_genre.length > 0 || explore.rarities.one_day.length > 0) && (
        <Section id={translate("rarezas")} title={translate("varios")} icon={<RetroIcon kind="recycle" />}>
          <div className="odd-ones">
            {explore.rarities.off_genre.length > 0 && (
              <div>
                <p className="explore-sub">{translate("cosas que escucho a veces")}</p>
                <ol>{explore.rarities.off_genre.map((a) => <li key={a.name} className="odd-row"><OddPhoto name={a.name} url={a.photo?.url} /><strong><button type="button" onClick={() => openArtist(a.name)}>{a.name}</button></strong><small>{a.style ?? a.family} · <span className="count-value">{n(a.plays)}<small className="count-unit">e</small></span></small></li>)}</ol>
              </div>
            )}
            {explore.rarities.one_day.length > 0 && (
              <div>
                <p className="explore-sub">{translate("los escuché un solo día")}</p>
                <ol>{explore.rarities.one_day.map((a) => <li key={a.name} className="odd-row"><OddPhoto name={a.name} url={a.photo?.url} /><strong><button type="button" onClick={() => openArtist(a.name)}>{a.name}</button></strong><small><Count value={a.plays} /> · {a.date.split("-").reverse().join("/")}</small></li>)}</ol>
              </div>
            )}
          </div>
        </Section>
      )}


      <details className="archive-deep-dive">
        <summary><span className="deep-title heading-with-icon"><RetroIcon kind="folder" size={44} />{translate("más del archivo")}</span><span className="big-plus" aria-hidden="true">+</span></summary>
        <div className="archive-deep-dive-body">
          {explore?.gold && <GoldMore gold={explore.gold} play={openArtist} />}
          {insights && <section id="idas-y-vueltas" className="py-8"><h2 className="heading-with-icon"><RetroIcon kind="briefcase" />{translate("idas y vueltas")}</h2><Movements data={insights} linkFor={linkFor} /></section>}
          <section id="ritmo" className="py-8"><h2 className="heading-with-icon"><RetroIcon kind="calendar" />{translate("día y hora")}</h2><Rhythm cells={stats.rhythm} /></section>
        </div>
      </details>

    </>
  );
}
