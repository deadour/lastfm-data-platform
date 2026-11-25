import type { MonthStat } from "../data/types";
import { monthLabel, n } from "../lib/format";

const WIDTH = 720;
const HEIGHT = 120;

export function Months({ months }: { months: MonthStat[] }) {
  if (months.length < 2) return null;
  const max = Math.max(...months.map((m) => m.scrobbles), 1);
  const step = WIDTH / (months.length - 1);
  const points = months
    .map((m, i) => `${(i * step).toFixed(1)},${(HEIGHT - (m.scrobbles / max) * HEIGHT).toFixed(1)}`)
    .join(" ");
  const last = months[months.length - 1];

  return (
    <figure>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT + 24}`} className="w-full overflow-visible" role="img" aria-label="escuchas por mes">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          pathLength={1}
          className="draw text-ink/80"
          vectorEffect="non-scaling-stroke"
        />
        {months.map((m, i) =>
          i % 3 === 0 ? (
            <text
              key={m.month}
              x={i * step}
              y={HEIGHT + 18}
              className="fill-current text-muted"
              fontSize="11"
              textAnchor={i === 0 ? "start" : "middle"}
            >
              {monthLabel(m.month)}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="mt-3 text-sm text-muted">último mes: {n(last.scrobbles)} escuchas</figcaption>
    </figure>
  );
}
