import { n } from "../utils/format";

interface BarsProps {
  values: number[];
  labels: string[];
  /** indexes drawn dimmed, e.g. incomplete years */
  dim?: number[];
  height?: number;
  label: string;
  /** show the value above every bar */
  showValues?: boolean;
}

export function Bars({ values, labels, dim = [], height = 140, label, showValues = false }: BarsProps) {
  const max = Math.max(...values, 1);
  return (
    <figure role="img" aria-label={label} className="w-full">
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {values.map((v, i) => (
          <div key={i} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
            {showValues && v > 0 && (
              <span className="tabular mb-1 text-center text-[10px] text-muted">{n(v)}</span>
            )}
            <div
              className={`grow-up w-full rounded-[1px] transition-colors duration-300 ${dim.includes(i) ? "bg-white/12" : "bg-[#d9a66b]/45 group-hover:bg-[#e7b48c]/90"}`}
              style={{ height: `${Math.max(v > 0 ? 2 : 0, (v / max) * 100)}%` }}
              title={`${labels[i]}: ${n(v)}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-[3px]">
        {labels.map((l, i) => (
          <span key={i} className="tabular min-w-0 flex-1 truncate text-center text-[10px] text-muted">{l}</span>
        ))}
      </div>
    </figure>
  );
}

interface LineProps {
  values: number[];
  /** label every n-th point */
  ticks: { index: number; text: string }[];
  label: string;
  height?: number;
}

const WIDTH = 1000;

export function Line({ values, ticks, label, height = 140 }: LineProps) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const step = WIDTH / (values.length - 1);
  const y = (v: number) => (height - (v / max) * (height - 4)).toFixed(1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${y(v)}`).join(" ");
  const area = `0,${height} ${points} ${WIDTH},${height}`;
  return (
    <svg viewBox={`0 0 ${WIDTH} ${height + 22}`} preserveAspectRatio="none" className="h-auto w-full overflow-visible" role="img" aria-label={label}>
      <polygon points={area} className="fill-white/[0.04]" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.25" vectorEffect="non-scaling-stroke"
        pathLength={1} className="draw text-ink/75" />
      {ticks.map((t) => (
        <text key={t.index} x={t.index * step} y={height + 18} fontSize="11" textAnchor="middle" className="fill-current text-muted">
          {t.text}
        </text>
      ))}
    </svg>
  );
}

/** january ticks for a yyyy-mm series */
export function yearTicks(months: string[], every = 1) {
  return months
    .map((m, index) => ({ index, m }))
    .filter(({ m }) => m.endsWith("-01") && Number(m.slice(0, 4)) % every === 0)
    .map(({ index, m }) => ({ index, text: m.slice(0, 4) }));
}

export function HourBars({ values, label }: { values: number[]; label: string }) {
  return <Bars values={values} labels={values.map((_, h) => (h % 6 === 0 ? `${String(h).padStart(2, "0")}h` : ""))} height={90} label={label} />;
}
