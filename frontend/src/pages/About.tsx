import { t as translate } from "../i18n";
import type { InsightsFile, StatsFile } from "../data/types";
import { Medallion } from "../components/Medallion";
import { Pipeline } from "../components/Pipeline";
import { TechNotes } from "../components/TechNotes";
import { AzureIcon, CloudflareIcon, GithubActionsIcon } from "../components/Icons";

const tools = [
  ["python", "python", "la extracción desde last.fm y todo el pipeline"],
  ["pandas", "data", "limpiar, unir y agregar los datos de cada capa"],
  ["parquet", "apacheparquet", "el formato en el que guardo las capas de plata y oro"],
  ["azure", "azure", "el lago de datos privado donde viven las tres capas"],
  ["github actions", "actions", "corre el pipeline todos los días y publica la web"],
  ["cloudflare pages", "cloudflare", "aloja la web y las funciones de lo que suena ahora"],
  ["react", "react", "la interfaz de esta web"],
  ["typescript", "typescript", "para tipar los datos que llegan a la web"],
  ["streamlit", "streamlit", "un tablero local para revisar los datos mientras armaba todo"],
] as const;

function iconFor(icon: string) {
  if (icon === "azure") return <AzureIcon size={25} title="" />;
  if (icon === "actions") return <GithubActionsIcon size={25} title="" />;
  if (icon === "cloudflare") return <CloudflareIcon size={25} title="" />;
  if (icon === "data") return <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="#81a9c0" strokeWidth="1.5" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" /></svg>;
  return <img src={`/icons/${icon}.svg`} width={25} height={25} alt="" loading="lazy" />;
}

export function About({ stats }: { stats: StatsFile | null; insights: InsightsFile | null }) {
  return <section id="about" className="about-page scroll-mt-6" aria-labelledby="about-title">
    <header className="about-header">
      <h2 id="about-title">{translate("sobre este proyecto")}</h2>
      <p className="about-subtitle">{translate("proyecto personal para practicar ingeniería de datos")}</p>
    </header>
    <div className="about-copy">
      <p>{translate("empecé a registrar la música que escucho en abril de 2016 y, de forma ininterrumpida, desde 2020. lo hago a través de last.fm, un servicio que se conecta a mis cuentas de spotify y youtube y guarda mi historial musical.")}</p>
      <p>{translate("con todos esos datos, se me ocurrió poner en práctica algunas cosas que aprendí en la facultad, combinando herramientas que ya uso en el trabajo con otras que tenía ganas de aprender.")}</p>
      <p>{translate("básicamente, automaticé la extracción de mis datos desde last.fm y su procesamiento mediante una arquitectura ")}<strong>{translate("medallón")}</strong>{translate(": la idea es que los datos van subiendo de medalla: en la capa de bronce están tal cual llegan, en la capa de plata ya están limpios y ordenados, y en la capa de oro quedan listos para mostrar. esos son los que usa esta web.")}</p>
      <p>{translate("este proceso se ejecuta automáticamente todos los días, incorporando lo que voy escuchando.")}</p>
      <p>{translate("para desarrollarlo usé ")}<strong>python</strong>{translate(" con ")}<strong>pandas</strong>{translate(" para procesar los datos; ")}<strong>react</strong>{translate(" y ")}<strong>typescript</strong>{translate(" para la interfaz; y ")}<strong>github actions</strong>{translate(" para automatizar las tareas. también aprendí a trabajar con ")}<strong>azure</strong>{translate(", donde armé un lago de datos privado en la nube que almacena las tres capas en archivos ")}<strong>parquet</strong>.</p>
      <p>{translate("la idea de este proyecto es poder recorrer todo lo que escuché durante estos años y, de paso, seguir aprendiendo ingeniería de datos.")}</p>
    </div>
    <div className="about-medallion"><div className="about-medallion-chart medal-wrap"><Medallion scrobbles={stats?.totals.scrobbles ?? null} artists={stats?.totals.artists ?? null} years={stats?.years.length ?? null} /></div></div>
    <div className="about-pipeline-graphic"><Pipeline /></div>
    <TechNotes />
    <section className="about-tools" aria-labelledby="tools-title">
      <h3 id="tools-title">{translate("herramientas")}</h3>
      <ul>
        {tools.map(([name, icon, use]) => <li key={name}>{iconFor(icon)}<span><strong>{name}</strong><small>{translate(use)}</small></span></li>)}
      </ul>
    </section>
  </section>;
}
