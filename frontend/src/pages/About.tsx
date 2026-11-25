import type { InsightsFile, StatsFile } from "../data/types";
import { n, shortDate } from "../utils/format";
import { Sources } from "../components/Icons";
import { DailyRun, Pipeline } from "../components/Pipeline";

const steps = [
  ["1. bajar", "cada mañana un job pide a last.fm solo lo nuevo desde la última vez. si se corta a mitad de camino, no cuenta: la próxima vez arranca del mismo lugar."],
  ["2. guardar crudo", "las respuestas quedan tal cual en bronze. si algún día cambio la lógica, puedo rearmar todo desde ahí."],
  ["3. limpiar", "silver es una tabla parquet: una fila por escucha, sin duplicados ni temas a medio reproducir."],
  ["4. resumir", "gold arma los agregados: años, meses, artistas, rachas. sobre eso salen las lecturas de esta página."],
  ["5. publicar", "se exportan unos json chicos, sin nada privado, y se suben a cloudflare. antes de dar el deploy por bueno, se chequea que la web sirva exactamente esos archivos."],
] as const;

const decisions = [
  ["sin claves guardadas", "github entra a azure con identidad federada (oidc). no hay contraseñas ni tokens permanentes del data lake en ningún lado."],
  ["un checkpoint, una escritura", "el estado avanza solo si el día terminó completo, con escritura condicional (etag). dos corridas a la vez no se pisan."],
  ["portadas con cuidado", "cover art archive por mbid y deezer como respaldo. si hay dudas sobre qué disco es, no se muestra nada."],
  ["estático a propósito", "los datos cambian una vez por día; servirlos como archivos es más rápido, más barato y no hay servidor que se caiga."],
  ["hora local", "las horas usan la zona donde estaba en cada momento: argentina, y unos meses en francia."],
  ["costo", "github actions y cloudflare pages gratis, y unos centavos de almacenamiento en azure por mes."],
] as const;

export function About({ stats, insights }: { stats: StatsFile | null; insights: InsightsFile | null }) {
  return (
    <article className="fade-in">
      <header className="border-b border-line py-14 md:py-20">
        <h1 className="font-serif text-5xl leading-[0.95] tracking-tight text-ink md:text-7xl">cómo está hecho</h1>
        <div className="mt-10 grid max-w-3xl gap-6 text-lg leading-relaxed text-ink/85">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>escucho música en spotify y en youtube,</span>
            <Sources />
            <span>y todo queda anotado en last.fm.</span>
          </p>
          <p>
            cada mañana, un programa que corre solo en internet se fija qué escuché el día anterior, lo guarda ordenado y saca las cuentas: qué artista, qué disco, a qué hora. después actualiza esta página.
          </p>
          <p className="text-muted">
            no tengo que tocar nada. si un día algo falla, no se rompe lo que ya estaba: al día siguiente se pone al día solo.
          </p>
        </div>
        {stats && (
          <p className="tabular mt-6 text-sm text-muted">
            {n(stats.totals.scrobbles)} escuchas · {n(stats.totals.artists)} artistas · {insights ? `${n(insights.session.sessions)} sesiones · ` : ""}desde {shortDate(stats.range.first)}
          </p>
        )}
      </header>

      <section className="border-b border-line py-14">
        <h2 className="mb-3 font-serif text-2xl text-ink">el recorrido</h2>
        <p className="mb-10 max-w-2xl text-sm text-muted">lo mismo, con los nombres técnicos.</p>
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
            el código, en github ↗
          </a>
        </div>
      </section>
    </article>
  );
}
