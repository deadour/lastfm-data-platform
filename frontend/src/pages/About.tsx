import type { InsightsFile, StatsFile } from "../data/types";
import { n, shortDate } from "../utils/format";
import { Medallion } from "../components/Medallion";
import { DailyRun, Pipeline } from "../components/Pipeline";

const steps = [
  ["last.fm", "registra la música que voy escuchando."],
  ["bronce · bronze", "los datos en crudo, tal como llegan."],
  ["plata · silver", "los datos organizados, limpios y sin duplicados."],
  ["oro · gold", "los datos listos para presentar: de acá salen las estadísticas de esta web."],
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
        <h1>sobre este<br /><em>proyecto.</em></h1>
        <p>automaticé la extracción y el procesamiento de mi historial musical para armar esta web.</p>
        {stats && (
          <span className="about-header-meta">{n(stats.totals.scrobbles)}<small className="count-unit">e</small> · desde {shortDate(stats.range.first)}{insights ? " · " + n(insights.session.sessions) + " sesiones" : ""}</span>
        )}
      </header>

      <section className="about-story" aria-labelledby="about-story-title">
        <div className="about-story-label"><span>sobre este proyecto</span><span className="about-stamp">2016 — hoy</span></div>
        <div>
          <h2 id="about-story-title">mi historial de música</h2>
          <p>tenía años de registros de la música que escucho guardados en last.fm, conectado a spotify y youtube. quise aprovecharlos para practicar ingeniería de datos y ver qué podía contar con ellos.</p>
          <p>empecé por automatizar la extracción de esos datos en crudo. después los organicé y procesé en azure, hasta tener las estadísticas que muestra esta web.</p>
          <p>todo se actualiza automáticamente una vez por día, a medida que voy escuchando música. github actions ejecuta el proceso y publica los resultados, sin que tenga que subir archivos a mano.</p>
          <p>el historial empieza en 2016. entre 2017 y 2019 no registré nada; volví a conectarlo en 2020.</p>
          <a className="about-github" href="https://github.com/deadour/lastfm-data-platform" target="_blank" rel="noreferrer">código en github ↗</a>
        </div>
      </section>

      <section className="about-medallion" aria-labelledby="about-m-title">
        <div className="about-section-label"><span>los datos</span><span>bronze · silver · gold</span></div>
        <h2 id="about-m-title">cómo los organizo</h2>
        <p>usé una arquitectura que se llama medallion, o medallón. la idea es organizar los datos en tres capas, como las medallas: bronce para los datos crudos, plata para los datos limpios y oro para los que ya están listos para presentar.</p>
        <div className="about-steps">
          {steps.map(([title, description]) => (
            <div key={title} className="about-step">
              <strong>{title}</strong><p>{description}</p>
            </div>
          ))}
        </div>
        <div className="about-medallion-chart"><Medallion scrobbles={stats?.totals.scrobbles ?? null} artists={stats?.totals.artists ?? null} years={stats?.years.length ?? null} /></div>
      </section>

      <section className="about-pipeline" aria-labelledby="about-p-title">
        <div className="about-section-label"><span>el pipeline</span><span>una vez por día</span></div>
        <h2 id="about-p-title">cómo llega a esta web</h2>
        <p>este es el recorrido que hacen mis datos todos los días, desde last.fm hasta esta web.</p>
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
          <p>para hacerlo probé herramientas que no había usado antes: azure para guardar los datos en la nube, parquet como formato de archivo y streamlit para un primer dashboard.</p>
          <p>en el trabajo ya venía usando python, sql, github actions, react y typescript. acá pude sumar esas herramientas nuevas y armar el recorrido completo, desde los datos crudos hasta la web. el procesamiento lo hice con python y pandas.</p>
          <p>esta web está hecha con react y typescript, y se publica en cloudflare pages.</p>
          <a href="https://github.com/deadour/lastfm-data-platform" target="_blank" rel="noreferrer">código en github ↗</a>
        </div>
      </section>
    </article>
  );
}
