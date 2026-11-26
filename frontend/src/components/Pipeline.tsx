import { t as translate } from "../i18n";
import { useEffect, useState } from "react";
import { AzureIcon, CloudflareIcon, GithubActionsIcon, LastfmIcon, MedalIcon, SpotifyIcon, YoutubeIcon } from "./Icons";

// an animated map of the pipeline: data pulses travel along the arrows,
// stages light up in order. static when the visitor prefers reduced motion.

interface Node {
  id: string;
  x: number;
  y: number;
  label: string;
  sub: string;
  icon?: keyof typeof icons;
  small?: boolean;
}

const W = 140;
const H = 64;
const SMALL_H = 46;

const nodes: Node[] = [
  { id: "spotify", x: 20, y: 74, label: "spotify", sub: "", icon: "spotify", small: true },
  { id: "youtube", x: 20, y: 150, label: "youtube", sub: "", icon: "youtube", small: true },
  { id: "lastfm", x: 215, y: 104, label: "last.fm", sub: "registra todo", icon: "lastfm" },
  { id: "bronze", x: 405, y: 104, label: "bronze", sub: "tal cual llega", icon: "bronze" },
  { id: "silver", x: 595, y: 104, label: "silver", sub: "limpio", icon: "silver" },
  { id: "gold", x: 785, y: 104, label: "gold", sub: "los números", icon: "gold" },
  { id: "export", x: 975, y: 104, label: "export", sub: "json público", icon: "actions" },
  { id: "web", x: 975, y: 280, label: "esta web", sub: "cloudflare", icon: "cloudflare" },
  { id: "now", x: 405, y: 280, label: "ahora suena", sub: "cada 30 s", icon: "cloudflare" },
];

const edges: [string, string][] = [
  ["spotify", "lastfm"], ["youtube", "lastfm"],
  ["lastfm", "bronze"], ["bronze", "silver"], ["silver", "gold"], ["gold", "export"], ["export", "web"],
  ["lastfm", "now"], ["now", "web"],
];

const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
const height = (n: Node) => (n.small ? SMALL_H : H);

function path(from: Node, to: Node): string {
  const fromMid = from.y + height(from) / 2;
  const toMid = to.y + height(to) / 2;
  if (from.x === to.x) return `M${from.x + W / 2},${from.y + height(from)} L${to.x + W / 2},${to.y - 6}`;
  if (to.y > from.y + height(from)) {
    // down then across
    return `M${from.x + W / 2},${from.y + height(from)} L${from.x + W / 2},${toMid} L${to.x - 6},${toMid}`;
  }
  if (fromMid === toMid) return `M${from.x + W},${fromMid} L${to.x - 6},${toMid}`;
  const mid = (from.x + W + to.x) / 2;
  return `M${from.x + W},${fromMid} C${mid},${fromMid} ${mid},${toMid} ${to.x - 6},${toMid}`;
}

const Bronze = ({ size }: { size?: number }) => <MedalIcon size={size} color="#b0703f" title="bronze" />;
const Silver = ({ size }: { size?: number }) => <MedalIcon size={size} color="#c9c6c0" title="silver" />;
const Gold = ({ size }: { size?: number }) => <MedalIcon size={size} color="#d9a83a" title="gold" />;

const icons = {
  spotify: { color: "#1db954", stroke: "#1db954", Icon: SpotifyIcon },
  youtube: { color: "#e0473c", stroke: "#e0473c", Icon: YoutubeIcon },
  lastfm: { color: "", stroke: "#b9392f", Icon: LastfmIcon },
  bronze: { color: "", stroke: "#b0703f", Icon: Bronze },
  silver: { color: "", stroke: "#c9c6c0", Icon: Silver },
  gold: { color: "", stroke: "#d9a83a", Icon: Gold },
  actions: { color: "", stroke: "#2da44e", Icon: GithubActionsIcon },
  cloudflare: { color: "", stroke: "#f38020", Icon: CloudflareIcon },
};

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function Pipeline() {
  const reduced = useReducedMotion();
  return (
    <svg viewBox="0 0 1135 375" className="pipeline w-full min-w-[780px]" role="img"
      aria-label={translate("spotify y youtube registran en last.fm; last.fm alimenta bronze, silver y gold en un data lake privado; de gold sale un json público que publica esta web. aparte, una función consulta last.fm para mostrar qué suena ahora.")}>
      <defs>
        <marker id="pipe-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8" fill="none" stroke="currentColor" className="text-white/45" />
        </marker>
        <radialGradient id="pipe-dot">
          <stop offset="0%" stopColor="#e7b48c" stopOpacity="1" />
          <stop offset="100%" stopColor="#e7b48c" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x="385" y="66" width="580" height="132" rx="8" fill="#073b65" fillOpacity="0.65" stroke="#38a8ed" strokeOpacity="0.65" />
      <g transform="translate(400, 74)"><AzureIcon size={16} /></g>
      <text x="422" y="88" fontSize="12" fill="#9ad7ff">{translate("azure · lago de datos privado")}</text>
      <text x="20" y="34" fontSize="12" className="fill-current text-muted">{translate("github actions · 00:17 · recuperación 02:47 · hora argentina")}</text>
      <line x1="20" y1="44" x2="1115" y2="44" stroke="currentColor" className="text-white/10" />

      {edges.map(([a, b], i) => {
        const d = path(byId[a], byId[b]);
        const live = b === "now" || a === "now";
        return (
          <g key={`${a}-${b}`}>
            <path d={d} fill="none" stroke="currentColor" className="text-white/20" markerEnd="url(#pipe-arrow)" />
            {!reduced && (
              <>
                <path d={d} fill="none" stroke="currentColor" strokeDasharray="4 14" className={`pipe-flow ${live ? "text-[#e7b48c]/60" : "text-white/45"}`}
                  style={{ animationDuration: live ? "1.2s" : "2.4s" }} />
                <circle r="5" fill="url(#pipe-dot)">
                  <animateMotion dur={live ? "2.4s" : "4.8s"} begin={`${i * 0.6}s`} repeatCount="indefinite" path={d} />
                </circle>
              </>
            )}
          </g>
        );
      })}

      {nodes.map((n, i) => {
        const h = height(n);
        const icon = n.icon ? icons[n.icon] : null;
        const textX = icon ? n.x + 40 : n.x + W / 2;
        const anchor = icon ? "start" : "middle";
        return (
          <g key={n.id} className={reduced ? "" : "pipe-node"} style={{ animationDelay: `${i * 0.5}s` }}>
            <rect x={n.x} y={n.y} width={W} height={h} rx="3" className="pipe-box" style={icon ? { stroke: icon.stroke, strokeOpacity: 0.7 } : undefined} />
            {icon && (
              <g transform={`translate(${n.x + 12}, ${n.y + h / 2 - 10})`} style={{ color: icon.color || undefined }}>
                <icon.Icon size={20} />
              </g>
            )}
            <text x={textX} y={n.sub ? n.y + 28 : n.y + h / 2 + 6} textAnchor={anchor} fontSize={icon && n.label.length > 9 ? 14 : 17} textLength={icon && n.label.length > 9 ? W - 50 : undefined} lengthAdjust="spacingAndGlyphs" fontFamily="var(--font-serif)" className="fill-current text-ink">{translate(n.label)}</text>
            {n.sub && <text x={textX} y={n.y + 47} textAnchor={anchor} fontSize="11.5" className="fill-current text-muted">{translate(n.sub)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

const run = [
  ["00:17", "arranca", "github actions levanta el job"],
  ["+1 min", "lee el checkpoint", "y toma un candado para correr solo"],
  ["+2 min", "baja lo nuevo", "de last.fm, desde el último registro"],
  ["+3 min", "capas silver y gold", "se rearman y se suben con hash"],
  ["+4 min", "avanza el checkpoint", "solo si todo salió completo"],
  ["+6 min", "publica", "exporta, despliega y verifica la web"],
] as const;

/** the daily run as a timeline; the active step walks along */
export function DailyRun() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => setActive((a) => (a + 1) % run.length), 1800);
    return () => window.clearInterval(timer);
  }, [reduced]);

  return (
    <ol className="relative grid gap-6 md:grid-cols-6 md:gap-4">
      <span className="absolute left-[5px] top-0 h-full w-px bg-line md:left-0 md:top-[5px] md:h-px md:w-full" aria-hidden />
      {run.map(([time, title, text], i) => {
        const on = reduced || i <= active;
        return (
          <li key={title} className="relative pl-6 md:pl-0 md:pt-7">
            <span aria-hidden className={`absolute left-0 top-1 h-[11px] w-[11px] rounded-full border transition-colors duration-500 md:top-0 ${i === active && !reduced ? "border-[#e7b48c] bg-[#e7b48c]" : on ? "border-white/60 bg-white/60" : "border-white/25 bg-[#0e0d0c]"}`} />
            <span className="tabular block text-xs text-muted">{time}</span>
            <span className={`mt-1 block text-sm transition-colors duration-500 ${on ? "text-ink" : "text-muted"}`}>{translate(title)}</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted">{translate(text)}</span>
          </li>
        );
      })}
    </ol>
  );
}
