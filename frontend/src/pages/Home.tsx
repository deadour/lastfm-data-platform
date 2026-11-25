import { Albums } from "../components/Albums";
import { Line, yearTicks } from "../components/Charts";
import { ArtistGrid, Movements, Readings, YearStory } from "../components/Insights";
import { Rhythm } from "../components/Rhythm";
import { Section } from "../components/Section";
import { Tracks } from "../components/Tracks";
import type { InsightsFile, StatsFile } from "../data/types";
import { n, shortDate } from "../utils/format";
import { Link } from "../utils/router";

export function Home({ stats, insights }: { stats: StatsFile; insights: InsightsFile | null }) {
  const slugs = new Map((insights?.artists ?? []).map((a) => [a.name, a.slug]));
  const linkFor = (artist: string) => (slugs.has(artist) ? `/artistas/${slugs.get(artist)}` : null);
  const monthly = insights ? null : stats.months;

  return (
    <>
      <div className="archive-ledger" aria-label="resumen del archivo">
        <div><span>escuchas</span><strong>{n(stats.totals.scrobbles)}</strong></div>
        <div><span>artistas</span><strong>{n(stats.totals.artists)}</strong></div>
        <div><span>canciones</span><strong>{n(stats.totals.tracks)}</strong></div>
        <div><span>desde</span><strong>{shortDate(stats.range.first)}</strong></div>
      </div>

      {insights && (
        <Section id="lecturas" title="lecturas">
          <Readings data={insights} />
        </Section>
      )}

      {stats.top_albums && stats.top_albums.length > 0 && (
        <Section id="discos" title="discos">
          <Albums albums={stats.top_albums} />
        </Section>
      )}

      {insights && (
        <Section id="anos" title="año por año">
          <YearStory years={insights.years} linkFor={linkFor} />
        </Section>
      )}

      {insights && insights.artists.length > 0 && (
        <Section id="artistas" title="artistas" aside={<Link href="/artistas" className="hover:text-ink">los {insights.artists.length} →</Link>}>
          <ArtistGrid artists={insights.artists} limit={10} />
        </Section>
      )}

      {insights && (
        <Section id="idas-y-vueltas" title="idas y vueltas">
          <Movements data={insights} linkFor={linkFor} />
        </Section>
      )}

      <Section id="canciones" title="canciones">
        <Tracks tracks={stats.top_tracks} />
      </Section>

      <Section id="tiempo" title="en el tiempo">
        {insights ? (
          <Line values={insights.monthly} ticks={yearTicks(insights.months, 1)} label="escuchas por mes, toda la historia" />
        ) : monthly && (
          <Line values={monthly.map((m) => m.scrobbles)} ticks={[]} label="escuchas por mes" />
        )}
      </Section>

      <Section id="ritmo" title="la semana">
        <Rhythm cells={stats.rhythm} />
      </Section>
    </>
  );
}
