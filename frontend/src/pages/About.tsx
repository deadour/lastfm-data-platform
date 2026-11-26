import type { InsightsFile, StatsFile } from "../data/types";
import { Medallion } from "../components/Medallion";
import { Pipeline } from "../components/Pipeline";
import { AzureIcon, CloudflareIcon, GithubActionsIcon } from "../components/Icons";

const tools = [["python", "python"], ["parquet", "apacheparquet"], ["streamlit", "streamlit"], ["react", "react"], ["typescript", "typescript"]] as const;

export function About({ stats }: { stats: StatsFile | null; insights: InsightsFile | null }) {
  return <section id="about" className="about-page scroll-mt-6" aria-labelledby="about-title">
    <header className="about-header">
      <h2 id="about-title">sobre este proyecto</h2>
      <p>proyecto personal de ingeniería de datos</p>
    </header>
    <div className="about-copy">
      <p>este es un proyecto personal que empecé para practicar ingeniería de datos, utilizando como base el historial de música que escucho desde 2016.</p>
      <p>todos esos datos se fueron guardando durante años en mi cuenta de last.fm, conectada a spotify y youtube. aunque hubo un período entre 2017 y 2019 en el que dejé de registrar mis escuchas, retomé la actividad en 2020 y desde entonces seguí acumulando datos.</p>
      <p>con toda esa información decidí poner en práctica algunos conceptos que fui viendo en la facultad, usando herramientas que uso en el trabajo y otras nuevas que quería aprender.</p>
      <p>básicamente, automaticé la extracción de años de mis datos musicales en crudo desde last.fm y los procesé utilizando una arquitectura llamada <strong>medallón</strong> (basada en la idea de que para procesar los datos vas escalando desde una medalla de bronce que representa datos crudos; una medalla de plata cuando organizás y ordenás tus datos y llegás a la de oro cuando los datos estan listos para presentar y los que uso para esta web)</p>
      <p>todo este proceso se ejecuta automáticamente todos los días, incorporando las nuevas canciones que voy escuchando.</p>
      <p>para armarlo estuve aprendiendo y experimentando con herramientas que antes no había utilizado, como trabajar en la nube con <strong>azure y parquet</strong>, además de otras con las que ya trabajo, como <strong>python, sql, github actions, react y typescript</strong>.</p>
      <p>de ahí nació esta web. una forma de visualizar todo lo que fui escuchando durante estos años y, de paso, seguir aprendiendo y experimentando con ingeniería de datos.</p>
    </div>
    <div className="about-medallion"><div className="about-medallion-chart"><Medallion scrobbles={stats?.totals.scrobbles ?? null} artists={stats?.totals.artists ?? null} years={stats?.years.length ?? null} /></div></div>
    <div className="about-pipeline-graphic"><Pipeline /></div>
    <section className="about-tools" aria-labelledby="tools-title">
      <h3 id="tools-title">herramientas</h3>
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
