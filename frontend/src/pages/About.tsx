import type { InsightsFile, StatsFile } from "../data/types";
import { n, shortDate } from "../utils/format";
import { Medallion } from "../components/Medallion";
import { DailyRun, Pipeline } from "../components/Pipeline";

const steps = [
  ["01", "last.fm", "spotify y youtube van dejando mis escuchas registradas."],
  ["02", "bronze", "guardo los datos tal como llegan."],
  ["03", "silver", "limpio los registros y evito duplicados."],
  ["04", "gold", "armo las estadísticas que ves en la web."],
] as const;

const notes = [
  ["qué pasa si falla", "el pipeline conserva el estado anterior. no doy por terminada una ejecución a medias."],
  ["cómo accedo a azure", "github actions se autentica con oidc, sin claves permanentes para el data lake."],
  ["de dónde salen las portadas", "musicbrainz, cover art archive y deezer. cuando una coincidencia no es clara, no la publico."],
  ["cómo se publica", "exporto archivos json con estadísticas públicas y despliego el sitio en cloudflare pages."],
] as const;

export function About({ stats, insights }: { stats: StatsFile | null; insights: InsightsFile | null }) {
  return (
    <article className="about-page fade-in">
      <header className="about-header">
        <span className="about-kicker">detrás de fm.</span>
        <h1>cómo lo<br /><em>armé.</em></h1>
        <p>un proyecto personal de ingeniería de datos, usando mi propio historial musical.</p>
        {stats && (
          <span className="about-header-meta">{n(stats.totals.scrobbles)} escuchas registradas · desde {shortDate(stats.range.first)}{insights ? " · " + n(insights.session.sessions) + " sesiones" : ""}</span>
        )}
      </header>

      <section className="about-story" aria-labelledby="about-story-title">
        <div className="about-story-label"><span>01 / sobre este proyecto</span><span className="about-stamp">2016 — hoy</span></div>
        <div>
          <h2 id="about-story-title">todo arrancó con last.fm.</h2>
          <p>este es un proyecto personal que empecé para practicar ingeniería de datos con el historial de música que escucho desde 2016.</p>
          <p>tenía años de registros guardados en last.fm, conectado a spotify y youtube. entre 2017 y 2019 no registré nada; volví a conectarlo en 2020.</p>
          <p>con esos datos quise probar cosas que vi en la facultad y que también uso en el trabajo. armé un pipeline en python y azure con arquitectura medallón: bronze guarda lo original, silver lo limpia y gold genera las estadísticas.</p>
          <p>github actions ejecuta el procesamiento todos los días. y bueno, de ahí salió esta web. quería ver todo lo que fui escuchando y seguir aprendiendo de paso.</p>
          <a className="about-github" href="https://github.com/deadour/lastfm-data-platform" target="_blank" rel="noreferrer">código en github ↗</a>
        </div>
      </section>

      <section className="about-medallion" aria-labelledby="about-m-title">
        <div className="about-section-label"><span>02 / los datos</span><span>bronze · silver · gold</span></div>
        <h2 id="about-m-title">del registro al gráfico.</h2>
        <div className="about-steps">
          {steps.map(([index, title, description]) => (
            <div key={title} className="about-step">
              <small>{index}</small><strong>{title}</strong><p>{description}</p>
            </div>
          ))}
        </div>
        <div className="about-medallion-chart"><Medallion scrobbles={stats?.totals.scrobbles ?? null} artists={stats?.totals.artists ?? null} years={stats?.years.length ?? null} /></div>
      </section>

      <section className="about-pipeline" aria-labelledby="about-p-title">
        <div className="about-section-label"><span>03 / pipeline</span><span>una vez por día</span></div>
        <h2 id="about-p-title">así viajan los datos.</h2>
        <p>del historial en last.fm hasta los archivos que muestra esta web.</p>
        <div className="about-pipeline-graphic"><Pipeline /></div>
        <details className="about-extra">
          <summary>ver una ejecución completa <span>＋</span></summary>
          <div className="about-extra-body"><DailyRun /></div>
        </details>
      </section>

      <section className="about-extra-info">
        <details className="about-extra">
          <summary>algunas decisiones técnicas <span>＋</span></summary>
          <dl className="about-notes">
            {notes.map(([title, description]) => (
              <div key={title}><dt>{title}</dt><dd>{description}</dd></div>
            ))}
          </dl>
        </details>
        <div className="about-stack">
          <span>herramientas</span>
          <p>python · pandas · parquet · azure data lake · github actions · react · typescript · cloudflare pages</p>
          <a href="https://github.com/deadour/lastfm-data-platform" target="_blank" rel="noreferrer">código en github ↗</a>
        </div>
      </section>
    </article>
  );
}
