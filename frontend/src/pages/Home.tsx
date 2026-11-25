import { Albums } from "../components/Albums";
import { Marquee } from "../components/Marquee";
import { Medallion } from "../components/Medallion";
import { Sources } from "../components/Icons";
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
        <Marquee items={insights.artists.slice(0, 24).map((a) => ({ name: a.name, href: `/artistas/${a.slug}` }))} />
      )}

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

      <section id="como-esta-hecho" className="reveal grid items-center gap-10 border-t border-line py-16 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:py-24">
        <div>
          <h2 className="font-serif text-3xl text-ink md:text-4xl">cómo está hecho</h2>
          <p className="mt-5 max-w-md leading-relaxed text-ink/80">
            todo lo que escucho en spotify y youtube <Sources className="mx-1 align-middle" /> queda en last.fm. de ahí lo bajo todos los días,
            lo ordeno en bronze, silver y gold, y esta página se actualiza sola.
          </p>
          <Link href="/como-esta-hecho" className="mt-8 inline-block border-b border-[#a8533f] pb-1 text-sm text-ink transition-colors hover:text-[#e7b48c]">
            ver cómo lo armé →
          </Link>
        </div>
        <Medallion fluid scrobbles={stats.totals.scrobbles} artists={stats.totals.artists} years={stats.years.length} />
      </section>
    </>
  );
}
