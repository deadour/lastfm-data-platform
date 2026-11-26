import { t as translate } from "../i18n";
import type { InsightsFile, StatsFile } from "../data/types";
import { Medallion } from "../components/Medallion";
import { Pipeline } from "../components/Pipeline";
import { AzureIcon, CloudflareIcon, GithubActionsIcon } from "../components/Icons";

const tools = [["python", "python"], ["parquet", "apacheparquet"], ["streamlit", "streamlit"], ["react", "react"], ["typescript", "typescript"]] as const;

export function About({ stats }: { stats: StatsFile | null; insights: InsightsFile | null }) {
  return <section id="about" className="about-page scroll-mt-6" aria-labelledby="about-title">
    <header className="about-header">
      <h2 id="about-title">{translate("sobre este proyecto")}</h2>
      <p className="about-subtitle">{translate("proyecto personal para practicar ingeniería de datos")}</p>
    </header>
    <div className="about-copy">
      <p>{translate("empecé a registrar la música que escucho en abril de 2016 y, de forma ininterrumpida, desde 2020. lo hago a través de last.fm, un servicio que se conecta a mis cuentas de spotify y youtube y guarda mi historial musical.")}</p>
      <p>{translate("con todos esos datos, se me ocurrió poner en práctica algunas cosas que aprendí en la facultad, combinando herramientas que ya uso en el trabajo con otras que tenía ganas de aprender.")}</p>
      <p>{translate("básicamente, automaticé la extracción de mis datos desde last.fm y su procesamiento mediante una arquitectura ")}<strong>{translate("medallón")}</strong>{translate(": la idea es que los datos van subiendo de medalla: en bronce están tal cual llegan, en plata ya están limpios y ordenados, y en oro quedan listos para mostrar. esos son los que usa esta web.")}</p>
      <p>{translate("este proceso se ejecuta automáticamente todos los días, incorporando lo que voy escuchando.")}</p>
      <p>{translate("para desarrollarlo usé ")}<strong>python</strong>{translate(" y ")}<strong>sql</strong>{translate(" para procesar los datos; ")}<strong>react</strong>{translate(" y ")}<strong>typescript</strong>{translate(" para la interfaz; y ")}<strong>github actions</strong>{translate(" para automatizar las tareas. también aprendí a trabajar con ")}<strong>azure</strong>{translate(", donde armé un lago de datos privado en la nube que almacena las tres capas en archivos ")}<strong>parquet</strong>.</p>
      <p>{translate("la idea de este proyecto es poder recorrer todo lo que escuché durante estos años y, de paso, seguir aprendiendo ingeniería de datos.")}</p>
    </div>
    <div className="about-medallion"><div className="about-medallion-chart"><Medallion scrobbles={stats?.totals.scrobbles ?? null} artists={stats?.totals.artists ?? null} years={stats?.years.length ?? null} /></div></div>
    <div className="about-pipeline-graphic"><Pipeline /></div>
    <section className="about-tools" aria-labelledby="tools-title">
      <h3 id="tools-title">{translate("herramientas")}</h3>
      <ul>
        <li><AzureIcon size={25} title="" /><span>azure</span></li>
        {tools.map(([name, icon]) => <li key={name}><img src={`/icons/${icon}.svg`} width={25} height={25} alt="" loading="lazy" /><span>{name}</span></li>)}
        <li><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="#81a9c0" strokeWidth="1.5" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" /></svg><span>sql</span></li>
        <li><GithubActionsIcon size={25} title="" /><span>github actions</span></li>
        <li><CloudflareIcon size={25} title="" /><span>cloudflare pages</span></li>
      </ul>
    </section>
  </section>;
}
