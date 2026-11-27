import { t as translate } from "../i18n";
import { MedalIcon } from "./Icons";

// the engineering behind the site, shown with real data from the lake:
// one scrobble through every layer, the numbers of a full silver build, and the design decisions.
// values come from the first full build (oct 2026); they are illustrative, not live.

const bronze = `{
  "name": "Hawaii",
  "artist": { "#text": "The Strokes",
              "mbid": "f181961b-…" },
  "album":  { "#text": "Juicebox",
              "mbid": "2663f448-…" },
  "mbid": "e6b1e0e0-…",
  "date": { "uts": "1461711366",
            "#text": "26 Apr 2016, 22:56" },
  "image": [ …4 tamaños… ]
}`;

const silver: [string, string, string?][] = [
  ["scrobble_id", "36c2538f…2401a7b", "sha256(usuario · artista · tema · timestamp)"],
  ["track_name", "Hawaii"],
  ["artist_name", "The Strokes"],
  ["album_name", "Juicebox"],
  ["scrobbled_at", "2016-04-26 22:56:06 UTC", "fecha y hora con zona horaria"],
  ["scrobble_year · month · hour", "2016 · 4 · 22", "números enteros para agrupar"],
  ["track_mbid", "e6b1e0e0-…", "id de musicbrainz, para portadas y géneros"],
  ["bronze_run_id · page", "20261002T215941Z · 585", "de qué archivo crudo salió"],
];

const gold: [string, string][] = [
  ["escuchas de hawaii", "1 de 38"],
  ["the strokes en 2016", "1 de 220"],
  ["todo 2016", "1 de 999"],
  ["the strokes, histórico", "1 de 4.910"],
];

const build: [string, string][] = [
  ["registros crudos leídos", "117.367"],
  ["“now playing” descartados", "493"],
  ["duplicados eliminados", "3"],
  ["malformados", "0"],
  ["filas en la capa silver", "116.871"],
];

const lake: [string, string, string][] = [
  ["lake/", "contenedor privado", ""],
  ["  bronze/lastfm/recent_tracks/ingestion_date=2026-10-02/run_20261002T214613Z/page_0001.json", "una página cruda de la api por archivo, agrupadas por día y ejecución", "bronze"],
  ["  silver/scrobbles/snapshot=20261002T223940Z/scrobbles.parquet", "una tabla con todas las escuchas, una versión por ejecución", "silver"],
  ["  gold/snapshot=…/listening_yearly/", "las 7 tablas de estadísticas, también versionadas", "gold"],
  ["  metadata/state_backups/", "copias del checkpoint, por si hay que recuperar el estado", ""],
];

const zones: [string, string, string, string][] = [
  ["hasta el 27/01/2026", "argentina", "utc−3", "todo el historial anterior"],
  ["28/01 → 28/03/2026", "francia", "utc+1", "horario de invierno"],
  ["29/03 → 24/06/2026", "francia", "utc+2", "horario de verano"],
  ["desde el 25/06/2026", "argentina", "utc−3", "de vuelta"],
];

const decisions: [string, string][] = [
  ["por qué parquet",
    "elegí parquet porque guarda los datos por columna, comprime bastante y respeta el tipo de cada campo. para darme una idea, el historial en json ocupa 160 mb en la capa bronce y el mismo historial en parquet ocupa 11,4 mb en la capa plata. además, cuando armo algo por año puedo leer solamente las columnas de fecha."],
  ["pandas para procesar",
    "el historial completo son unas 117 mil filas y entra entero en memoria, así que todas las transformaciones las hago con pandas leyendo los parquet directamente. para este volumen no me hizo falta una base de datos ni spark. lo dejé fijo en pandas 2 porque con pandas 3 las fechas salían en microsegundos en vez de nanosegundos y no pasaban la validación de la capa silver."],
  ["un lago de datos en vez de una base de datos",
    "en azure cada capa se guarda como una foto fija del momento (un snapshot) con su hash sha-256. cada procesamiento genera una nueva y la anterior queda guardada, así que si algo sale mal puedo volver a la versión previa."],
  ["que una falla no rompa nada",
    "el pipeline guarda en un archivo hasta qué escucha llegó. ese archivo se actualiza con escritura condicional (etag) y con un bloqueo (lease), entonces si dos ejecuciones coinciden una de las dos falla y el estado queda bien. si una ejecución se corta a la mitad, ese punto no avanza y la siguiente arranca desde ahí."],
  ["solo lo nuevo",
    "todos los días le pido a last.fm las escuchas posteriores a la última que tengo guardada, así cada ejecución trae unos pocos registros y tarda alrededor de un minuto."],
  ["por qué cada 6 horas",
    "el pipeline corre a las 00:17, 06:17, 12:17 y 18:17, hora argentina. con un solo horario diario, si github no disparaba el cron la web se quedaba con el dato de todo un día. con cuatro corridas, si una se pierde el dato se actualiza igual. no lo pongo en punto porque github puede demorar los cron a la hora exacta, que es cuando más carga tiene. a las 02:47 corre otra vez por si alguna no arrancó o last.fm estaba caído; como solo trae lo nuevo, si ya estaba todo no cambia nada."],
  ["el hueco entre 2016 y 2020",
    "las primeras escuchas son del 26 de abril de 2016 y las últimas de esa etapa del 20 de agosto. después no usé más last.fm hasta el 25 de marzo de 2020, en plena pandemia, cuando redescubrí la app, y desde ahí no se cortó nunca. esos años vacíos no los completo con ceros: las 999 escuchas de 2016 quedan marcadas como registro parcial y todo lo que arranca en 2020 como registro continuo. las rachas y los artistas que volví a escuchar después de un año se calculan solo desde 2020, si no el hueco parecería que dejé de escuchar a todos."],
  ["un id para cada escucha",
    "last.fm no le asigna un id a cada escucha, así que armé uno propio con un hash del usuario, el artista, el tema y el segundo exacto en que sonó. con eso, si la misma escucha llega dos veces, la detecto y la descarto."],
  ["los títulos de youtube",
    "cuando escucho en youtube, last.fm toma el título del video, y a veces el artista y el tema quedan al revés o el título entero termina como nombre de artista. en la capa silver los dejo como llegaron, porque eso fue lo que se registró. en la web descarto de los artistas nuevos los nombres que parecen títulos de video (muy largos, con emojis o comillas), y para buscar los fragmentos limpio el título de cosas como “remastered” o “live”."],
  ["sin contraseñas guardadas",
    "para que github actions pueda entrar a azure usé oidc, que es una identidad federada: azure confía en github y le da un permiso temporal en cada ejecución, así no tengo que guardar claves del lago de datos."],
  ["la web lee archivos",
    "como los datos cambian una vez por día, después de armar la capa de oro exporto los resultados a archivos json que la web lee directamente desde cloudflare. por eso carga rápido y no necesito un servidor ni una base de datos respondiendo en cada visita."],
  ["controles antes de publicar",
    "antes de publicar valido que los json tengan la forma que espera la web, y después del despliegue reviso que la página pública esté sirviendo exactamente esos archivos. el proyecto tiene 184 tests en python y 95 en el frontend."],
  ["por qué winamp",
    "no sé, aguante la estética de los 2000s. el reproductor y los íconos son un guiño a cómo escuchaba música antes de spotify. para reproducir uso fragmentos de 30 segundos de apple o deezer, y si no aparece el tema pruebo con otro del mismo artista o con algo que escucho mucho, para que nunca quede en silencio."],
];

// medal and service colours, so each decision reads at a glance
const decisionColors = ["#c9a24a", "#5b9bd5", "#e07a5f", "#7fb069", "#b9b9b4", "#c879b0", "#f3a35c", "#56c1b4", "#e0473c", "#9b8cd9", "#d4c25a", "#6fa8dc", "#7fb069"];

export function TechNotes() {
  return (
    <section className="tech" aria-labelledby="tech-title">
      <h3 id="tech-title" className="tech-title">{translate("una escucha, capa por capa")}</h3>
      <p className="tech-lead">{translate("tomé el primer registro de mi historial y lo seguí desde que llega de la api hasta que aparece en la web.")}</p>

      <div className="tech-trace">
        <article className="tech-layer bronze">
          <header><MedalIcon size={22} color="#b0703f" title="" />bronze<small>{translate("json crudo, tal cual responde la api")}</small></header>
          <pre><code>{bronze}</code></pre>
          <p>{translate("lo guardo tal cual llega, así si en algún momento cambio la forma de procesarlo puedo volver a armar todo desde acá.")}</p>
        </article>

        <article className="tech-layer silver">
          <header><MedalIcon size={22} color="#c9c6c0" title="" />silver<small>{translate("una fila de parquet, 20 columnas tipadas")}</small></header>
          <dl>
            {silver.map(([k, v, note]) => (
              <div key={k}><dt>{k}</dt><dd>{v}{note && <small>{translate(note)}</small>}</dd></div>
            ))}
          </dl>
        </article>

        <article className="tech-layer gold">
          <header><MedalIcon size={22} color="#d9a83a" title="" />gold<small>{translate("agregados listos para mostrar")}</small></header>
          <dl className="tech-gold">
            {gold.map(([k, v]) => <div key={k}><dt>{translate(k)}</dt><dd>{translate(v)}</dd></div>)}
          </dl>
          <p>{translate("de acá salen todos los números que se ven en la web, como los tops, los años, las rachas o los horarios.")}</p>
        </article>
      </div>

      <h3 className="tech-title">{translate("de la capa bronze a la capa silver, en números")}</h3>
      <ol className="tech-funnel">
        {build.map(([k, v]) => <li key={k}><span>{translate(k)}</span><strong className="tabular">{v}</strong></li>)}
      </ol>
      <p className="tech-lead">{translate("al 41% de las escuchas le falta el id de musicbrainz del tema y al 27% el del artista, por eso para las portadas y los géneros también busco por nombre.")}</p>

      <h3 className="tech-title">{translate("cómo está organizado el lago")}</h3>
      <p className="tech-lead">{translate("es un contenedor privado en azure data lake gen2, con una carpeta por capa. cada ejecución guarda una versión nueva con la fecha en el nombre, y las anteriores quedan.")}</p>
      <ul className="tech-lake">
        {lake.map(([path, note, tone]) => <li key={path} className={tone}><code>{path}</code><small>{translate(note)}</small></li>)}
      </ul>
      <p className="tech-lead">{translate("cada archivo se sube con su hash sha-256 guardado como metadato. si ya hay uno igual no lo vuelvo a subir, y si hay uno distinto el pipeline se niega a pisarlo salvo que se lo pida. para entrar no uso claves de la cuenta: tanto yo como github actions usamos identidades de azure que solo tienen permiso para leer y escribir datos.")}</p>

      <h3 className="tech-title">{translate("decisiones")}</h3>
      <dl className="tech-decisions">
        {decisions.map(([k, v], i) => <div key={k} style={{ ["--d" as string]: decisionColors[i % decisionColors.length] }}><dt>{translate(k)}</dt><dd>{translate(v)}</dd></div>)}
      </dl>

      <h3 className="tech-title">{translate("zonas horarias")}</h3>
      <p className="tech-lead">{translate("last.fm guarda todo en utc, pero para los horarios y los días quería la hora real en la que estaba escuchando. entre enero y junio de 2026 estuve de intercambio en francia, así que esas escuchas las paso a la hora de parís, teniendo en cuenta también el cambio al horario de verano del 29 de marzo. el resto va con la hora de argentina, que no cambia en el año.")}</p>
      <p className="tech-count">{translate("6.961 escuchas fueron en francia.")}</p>
      <ol className="tech-zones">
        {zones.map(([when, where, offset, n]) => <li key={when}><span>{translate(when)}</span><strong>{translate(where)}</strong><code>{offset}</code><small>{translate(n)}</small></li>)}
      </ol>
      <p className="tech-lead">{translate("por ejemplo, una escucha a las 23:30 utc del 15 de abril de 2026 en argentina hubiera sido a las 20:30 de ese día, pero como estaba en francia fue a la 01:30 del 16. en total, 21.022 escuchas cambian de día cuando paso de utc a la hora local.")}</p>
    </section>
  );
}
