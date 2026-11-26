import { t as translate } from "../i18n";
import { Count } from "./Count";
import { useEffect, useId, useRef, useState } from "react";
import { n } from "../utils/format";

// small time chart for recent listening. bars for days (discrete counts),
// a line for weeks and months (evolution). the y axis always starts at zero,
// unknown buckets (null) are gaps, never zeros, and the running period is
// drawn hollow so it doesn't read as a drop.

export interface TimePoint {
  key: string;
  label: string;
  /** long label for the tooltip and screen readers */
  title: string;
  value: number | null;
  complete: boolean;
  /** shown in the readout; the chart plays it when the bucket is tapped */
  track?: { artist: string; title: string } | null;
}

interface Props {
  points: TimePoint[];
  kind: "bars" | "line";
  label: string;
  height?: number;
  onPick?: (point: TimePoint) => void;
}

const PAD = { top: 14, right: 26, bottom: 26, left: 34 };

function niceMax(max: number): number {
  if (max <= 0) return 4;
  const step = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= max) return m * step;
  return 10 * step;
}

/** draw at the real container width so labels keep their size on phones */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function TimeChart({ points, kind, label, height = 190, onPick }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const [ref, W] = useWidth();
  const id = useId();
  const known = points.map((p) => p.value ?? 0);
  const top = niceMax(Math.max(...known, 0));
  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i * innerW) / (points.length - 1));
  const slot = innerW / points.length;
  const barX = (i: number) => PAD.left + i * slot;
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const ticks = [0, top / 2, top];

  // line segments break at unknown buckets
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current.length) segments.push(current.join(" "));
      current = [];
    } else current.push(`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  });
  if (current.length) segments.push(current.join(" "));

  const shown = active !== null ? points[active] : null;

  return (
    <figure className="time-chart" ref={ref}>
      <figcaption className="sr-only">{label}</figcaption>
      <div className="time-chart-readout" aria-live="polite">
        {shown ? (
          <>
            <strong>{shown.value === null ? translate("sin registro") : <Count value={shown.value} />}</strong>
            <span>{shown.title}{!shown.complete && shown.value !== null ? translate(" · en curso") : ""}</span>
            {shown.track && <span className="time-chart-track">▶ {shown.track.title ? `${shown.track.title} · ${shown.track.artist}` : `algo de ${shown.track.artist}`}</span>}
          </>
        ) : (
          <span>{onPick ? translate("tocá una barra o un punto y suena lo que más escuché ahí") : translate("tocá o pasá por encima para ver cada valor")}</span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-labelledby={`${id}-desc`}
        onMouseLeave={() => setActive(null)}>
        <desc id={`${id}-desc`}>
          {label}: {points.map((p) => `${p.title} ${p.value === null ? translate("sin registro") : n(p.value)}`).join(", ")}
        </desc>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="time-chart-grid" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="time-chart-axis">{n(Math.round(t))}</text>
          </g>
        ))}

        {kind === "bars" && points.map((p, i) => p.value !== null && (
          <rect key={p.key} x={barX(i) + slot * 0.18} width={slot * 0.64} y={y(p.value)}
            height={Math.max(0, y(0) - y(p.value))}
            className={`time-chart-bar ${p.complete ? "" : "running"} ${active === i ? "active" : ""}`} />
        ))}

        {kind === "line" && (
          <>
            {segments.map((s) => <polyline key={s} points={s} className="time-chart-line" />)}
            {points.map((p, i) => p.value !== null && (
              <circle key={p.key} cx={x(i)} cy={y(p.value)} r={active === i ? 5 : 3.2}
                className={`time-chart-dot ${p.complete ? "" : "running"}`} />
            ))}
          </>
        )}

        {points.map((p, i) => (
          <text key={`l-${p.key}`} x={kind === "bars" ? barX(i) + slot / 2 : x(i)} y={height - 8} textAnchor="middle"
            className={`time-chart-axis ${active === i ? "active" : ""}`}>{p.label}</text>
        ))}

        {/* invisible hit areas: hover on desktop, tap and keyboard everywhere */}
        {points.map((p, i) => (
          <rect key={`h-${p.key}`} x={kind === "bars" ? barX(i) : x(i) - slot / 2} y={PAD.top} width={slot} height={innerH + PAD.bottom}
            fill="transparent" tabIndex={0} role="button"
            aria-label={`${p.title}: ${p.value === null ? translate("sin registro") : n(p.value) + " e"}`}
            onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)}
            onClick={() => { setActive(i); if (p.track && onPick) onPick(p); }}
            onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && p.track && onPick) { e.preventDefault(); onPick(p); } }}
            onBlur={() => setActive((a) => (a === i ? null : a))} className="time-chart-hit" />
        ))}
      </svg>
    </figure>
  );
}
