import type { InsightsFile, StatsFile } from "../data/types";
import { n, shortDate } from "../utils/format";
import { Sources } from "../components/Icons";
import { Medallion } from "../components/Medallion";
import { DailyRun, Pipeline } from "../components/Pipeline";

const steps = [
  ["1. bajar", "todos los días consulto last.fm desde github actions. si la ejecución falla, no avanzo el estado."],
  ["2. bronze", "guardo las respuestas originales. si cambio algo del procesamiento, puedo empezar desde acá."],
  ["3. silver", "limpio y organizo las escuchas en parquet, evitando duplicados."],
  ["4. gold", "calculo artistas, discos, canciones, años y patrones de escucha."],
  ["5. publicar", "exporto las estadísticas públicas a json y las publico junto con la web."],
] as const;

const decisions = [
  ["sin claves guardadas", "github entra a azure con identidad federada (oidc). no hay contraseñas ni tokens permanentes del data lake en ningún lado."],
  ["un checkpoint, una escritura", "el estado avanza solo si el día terminó completo, con escritura condicional (etag). dos corridas a la vez no se pisan."],
  ["portadas con cuidado", "cover art archive por mbid y deezer como respaldo. si hay dudas sobre qué disco es, no se muestra nada."],
  ["estático a propósito", "los datos cambian una vez por día; servirlos como archivos es más rápido, más barato y no hay servidor que se caiga."],
  ["hora local", "las horas usan la zona donde estaba en cada momento: argentina, y unos meses en francia."],
  ["costos", "uso github actions y cloudflare pages, más almacenamiento y transferencias en azure."],
] as const;

export function About({ stats, insights }: { stats: StatsFile | null; insights: InsightsFile | null }) {
  return (
    <article className="fade-in">
      <header className="border-b border-line py-14 md:py-20">
        <h1 className="font-serif text-5xl leading-[0.95] tracking-tight text-ink md:text-7xl">cómo está hecho</h1>
        {stats && (
          <p className="tabular mt-6 text-sm text-muted">
            {n(stats.totals.scrobbles)} escuchas · {n(stats.totals.artists)} artistas · {insights ? `${n(insights.session.sessions)} sesiones · ` : ""}desde {shortDate(stats.range.first)}
          </p>
        )}
      </header>

      <section className="grid gap-10 border-b border-line py-14 md:grid-cols-[14rem_minmax(0,1fr)]">
        <h2 className="font-serif text-2xl text-ink">sobre este proyecto</h2>
        <div className="grid max-w-3xl gap-5 text-[1.05rem] leading-relaxed text-ink/85">
          <p>este es un proyecto personal para practicar ingeniería de datos con algo que ya tenía: mi historial de last.fm.</p>
          <p>
            empecé a registrar lo que escuchaba en 2016, con spotify y youtube conectados a last.fm <Sources className="mx-1 align-middle" />.
            entre 2017 y 2019 no registré nada. en 2020 volví a conectarlo y desde entonces seguí acumulando escuchas.
          </p>
          <p>
            aproveché todo eso para poner en práctica cosas que vi en la facultad y también uso en el trabajo. entre ellas, la arquitectura medallón:
            bronze guarda lo original, silver lo limpia y gold prepara las estadísticas.
          </p>
          <p>
            lo armé con python, azure y github actions. todos los días corre el pipeline, consulta las nuevas escuchas y publica los datos procesados.
          </p>
          <p>y de ahí salió esta web. quería ver qué escuché durante todos estos años y, de paso, seguir probando cosas.</p>
        </div>
      </section>

      <section className="border-b border-line py-14">
        <h2 className="mb-3 font-serif text-2xl text-ink">arquitectura medallón</h2>
        <p className="mb-10 max-w-2xl text-sm text-muted">las tres capas que uso para procesar las escuchas.</p>
        <div className="overflow-x-auto pb-2">
          <Medallion scrobbles={stats?.totals.scrobbles ?? null} artists={stats?.totals.artists ?? null} years={stats?.years.length ?? null} />
        </div>
      </section>

      <section className="border-b border-line py-14">
        <h2 className="mb-3 font-serif text-2xl text-ink">el recorrido</h2>
        <p className="mb-10 max-w-2xl text-sm text-muted">de dónde sale cada dato y cómo llega acá.</p>
        <div className="overflow-x-auto pb-2"><Pipeline /></div>
      </section>

      <section className="border-b border-line py-14">
        <h2 className="mb-10 font-serif text-2xl text-ink">un día cualquiera</h2>
        <DailyRun />
      </section>

      <section className="grid gap-10 border-b border-line py-14 md:grid-cols-[14rem_minmax(0,1fr)]">
        <h2 className="font-serif text-2xl text-ink">paso a paso</h2>
        <ol className="flex flex-col gap-8">
          {steps.map(([title, text]) => (
            <li key={title} className="grid gap-2 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-8">
              <span className="text-sm text-ink">{title}</span>
              <p className="leading-relaxed text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-b border-line py-14">
        <h2 className="mb-10 font-serif text-2xl text-ink">decisiones</h2>
        <dl className="grid gap-x-12 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
          {decisions.map(([title, text]) => (
            <div key={title} className="border-t border-line pt-5">
              <dt className="text-ink">{title}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-muted">{text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="grid gap-10 py-14 md:grid-cols-[14rem_minmax(0,1fr)]">
        <h2 className="font-serif text-2xl text-ink">herramientas</h2>
        <div>
          <ul className="flex flex-wrap gap-2 text-sm">
            {["python", "pandas", "parquet", "azure data lake gen2", "github actions", "oidc / entra id", "react", "typescript", "vite", "tailwind", "cloudflare pages", "cloudflare functions"].map((tool) => (
              <li key={tool} className="rounded-full border border-line px-3 py-1 text-muted">{tool}</li>
            ))}
          </ul>
          <a href="https://github.com/deadour/lastfm-data-platform" target="_blank" rel="noreferrer" className="mt-8 inline-block text-sm text-ink underline decoration-white/20 underline-offset-4 hover:decoration-white/60">
            código en github
          </a>
        </div>
      </section>
    </article>
  );
}
