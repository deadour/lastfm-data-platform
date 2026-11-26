import { n } from "../utils/format";

// medallion architecture as three tiers: raw records settle into bronze, get
// cleaned into silver, and are summarised into gold. small dots drift upward
// between tiers; the svg stays static when reduced motion is requested (css).

interface Props {
  /** allow shrinking to the container instead of scrolling */
  fluid?: boolean;
  scrobbles: number | null;
  artists: number | null;
  years: number | null;
}

const tiers = [
  { key: "gold", y: 20, color: "#c9a24a", title: "gold", what: "estadísticas", detail: "años, artistas, discos, rachas, horarios" },
  { key: "silver", y: 132, color: "#b9b9b4", title: "silver", what: "datos limpios", detail: "una fila por registro, sin duplicados" },
  { key: "bronze", y: 244, color: "#a8714a", title: "bronze", what: "registros originales", detail: "en formato crudo (json)" },
] as const;

export function Medallion({ scrobbles, artists, years, fluid = false }: Props) {
  const counts: Record<string, string> = {
    bronze: scrobbles ? `${scrobbles} registros en lastfm` : "registros en lastfm",
    silver: scrobbles ? `${n(scrobbles)} filas` : "parquet",
    gold: artists && years ? `${n(artists)} artistas · ${years} años` : "agregados",
  };
  return (
    <svg viewBox="0 0 760 340" className={`w-full ${fluid ? "" : "min-w-[560px]"}`} role="img"
      aria-label="arquitectura medallion: bronze guarda los registros originales, silver los limpia, gold genera las estadísticas">
      {tiers.map((t, i) => {
        // a pyramid: gold is the narrowest tier, less data and more meaning
        const width = 420 - (2 - i) * 84;
        const left = 40 + (420 - width) / 2;
        return (
          <g key={t.key} className="medal-tier" style={{ animationDelay: `${(2 - i) * 0.35}s` }}>
            <rect x={left} y={t.y} width={width} height="76" rx="4" fill={t.color} fillOpacity="0.1" stroke={t.color} strokeOpacity="0.65" />
            <circle cx={left + 26} cy={t.y + 38} r="9" fill={t.color} fillOpacity="0.85" />
            <text x={left + 46} y={t.y + 34} fontSize="20" fontFamily="var(--font-serif)" fontWeight="700" fill={t.color}>{t.title}</text>
            <text x={left + 46} y={t.y + 56} fontSize="12.5" className="fill-current text-ink/80">{t.what}</text>
            <text x={500} y={t.y + 34} fontSize="12.5" className="fill-current text-ink">{counts[t.key]}</text>
            <text x={500} y={t.y + 54} fontSize="11.5" className="fill-current text-muted">{t.detail}</text>
            <line x1={left + width + 8} y1={t.y + 38} x2="488" y2={t.y + 38} stroke="currentColor" strokeDasharray="2 4" className="text-white/20" />
          </g>
        );
      })}
      {[0, 1].map((gap) => {
        const fromY = tiers[2 - gap].y; // bronze → silver, silver → gold
        const toY = tiers[1 - gap].y + 76;
        return (
          <g key={gap}>
            <line x1="250" y1={fromY - 2} x2="250" y2={toY + 4} stroke="currentColor" className="text-white/25" />
            {[0, 1, 2].map((k) => (
              <circle key={k} r="2.6" cx="250" cy={fromY - 4} fill={tiers[1 - gap].color} className="medal-dot"
                style={{ ["--rise" as string]: `${toY + 6 - (fromY - 4)}px`, animationDelay: `${k * 0.6 + gap * 0.3}s` }} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
