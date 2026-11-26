import { t as translate } from "../i18n";
import { n } from "../utils/format";
import { MedalIcon } from "./Icons";

// medallion architecture read top to bottom: the api feeds bronze, bronze is cleaned into
// silver, silver is aggregated into gold, gold is exported to the web. each layer shows its
// format and size; each step between layers lists what actually happens there.

interface Props {
  scrobbles: number | null;
  artists: number | null;
  years: number | null;
}

const layers = [
  { key: "bronze", color: "#c08552", title: "bronze", what: "registros originales", format: "json · 160 mb", detail: "una página de la api por archivo, sin tocar" },
  { key: "silver", color: "#c9c6c0", title: "silver", what: "datos limpios", format: "parquet · 11,4 mb", detail: "una fila por escucha, 20 columnas tipadas" },
  { key: "gold", color: "#d9a83a", title: "gold", what: "estadísticas", format: "parquet → json", detail: "7 tablas: años, meses, días, artistas, temas, horarios, rachas" },
] as const;

const steps = [
  { label: "transformar", items: ["descarta “now playing”", "id con sha-256", "elimina duplicados", "fechas y números tipados"] },
  { label: "agregar", items: ["utc → hora local", "agrega por año, mes y día", "rankings y rachas", "cruza portadas y géneros"] },
];

export function Medallion({ scrobbles, artists, years }: Props) {
  const counts: Record<string, string> = {
    bronze: scrobbles ? translate(`${n(scrobbles)} registros en lastfm`) : translate("registros en lastfm"),
    silver: scrobbles ? `${n(scrobbles)} ${translate("filas")}` : "parquet",
    gold: artists && years ? translate(`${n(artists)} artistas · ${years} años`) : translate("agregados"),
  };
  return (
    <figure className="medal" aria-label={translate("arquitectura medallion: bronze guarda los registros originales, silver los limpia, gold genera las estadísticas")}>
      <div className="medal-end medal-in">{translate("api de last.fm · cada día")}</div>
      <div className="medal-lake">
        <p className="medal-lake-label">{translate("azure data lake gen2 · privado · un snapshot por ejecución, con hash sha-256")}</p>
        {layers.map((layer, i) => (
          <div key={layer.key} className="medal-block">
            <article className="medal-layer" style={{ ["--m" as string]: layer.color, animationDelay: `${i * 0.15}s` }}>
              <header>
                <span className="medal-coin"><MedalIcon size={34} color={layer.color} title="" /></span>
                <div>
                  <h4>{translate(`capa ${layer.title}`)}</h4>
                  <p>{translate(layer.what)}</p>
                </div>
              </header>
              <dl>
                <dt className="tabular">{counts[layer.key]}</dt>
                <dd className="medal-format">{translate(layer.format)}</dd>
                <dd>{translate(layer.detail)}</dd>
              </dl>
            </article>
            {i < steps.length && (
              <div className="medal-step" style={{ ["--from" as string]: layer.color, ["--to" as string]: layers[i + 1].color }}>
                <span className="medal-step-label">{translate(steps[i].label)}</span>
                <ul>{steps[i].items.map((item) => <li key={item}>{translate(item)}</li>)}</ul>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="medal-end medal-out">{translate("esta web · cloudflare")}</div>
    </figure>
  );
}
