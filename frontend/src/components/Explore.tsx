import { useMemo, useState } from "react";
import type { ExploreFile, FamilyShare } from "../data/explore";
import { monthYear, n, pct } from "../utils/format";

// okabe-ito: readable on dark backgrounds and for colour-blind eyes.
// colour always comes with a text label, never alone.
const FAMILY_COLORS: Record<string, string> = {
  rock: "#D55E00", "hip-hop": "#56B4E9", latin: "#E69F00", pop: "#CC79A7",
  electronic: "#009E73", punk: "#F0E442", folk: "#0072B2",
};
const OTHER = "#7d766d";
const familyColor = (f: string) => FAMILY_COLORS[f] ?? OTHER;

/* ---------- genres: treemap ---------- */

interface Box { x: number; y: number; w: number; h: number; item: FamilyShare }

// squarified treemap (bruls et al.), enough for a dozen items
function squarify(items: FamilyShare[], x: number, y: number, w: number, h: number): Box[] {
  const total = items.reduce((s, i) => s + i.share, 0) || 1;
  const scaled = items.map((item) => ({ item, area: (item.share / total) * w * h }));
  const boxes: Box[] = [];
  let row: typeof scaled = [];
  let rect = { x, y, w, h };
  const worst = (r: typeof scaled, side: number) => {
    const s = r.reduce((a, b) => a + b.area, 0);
    const max = Math.max(...r.map((b) => b.area)), min = Math.min(...r.map((b) => b.area));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  const layout = (r: typeof scaled) => {
    const s = r.reduce((a, b) => a + b.area, 0);
    if (rect.w >= rect.h) {
      const colW = s / rect.h;
      let cy = rect.y;
      for (const b of r) { const bh = b.area / colW; boxes.push({ x: rect.x, y: cy, w: colW, h: bh, item: b.item }); cy += bh; }
      rect = { x: rect.x + colW, y: rect.y, w: rect.w - colW, h: rect.h };
    } else {
      const rowH = s / rect.w;
      let cx = rect.x;
      for (const b of r) { const bw = b.area / rowH; boxes.push({ x: cx, y: rect.y, w: bw, h: rowH, item: b.item }); cx += bw; }
      rect = { x: rect.x, y: rect.y + rowH, w: rect.w, h: rect.h - rowH };
    }
  };
  for (const b of scaled) {
    const side = Math.min(rect.w, rect.h);
    if (!row.length || worst([...row, b], side) <= worst(row, side)) row.push(b);
    else { layout(row); row = [b]; }
  }
  if (row.length) layout(row);
  return boxes;
}

export function GenreTreemap({ families, artists }: { families: FamilyShare[]; artists: Record<string, { name: string; plays: number }[]> }) {
  const main = families.slice(0, 7);
  const rest = families.slice(7).reduce((s, f) => s + f.share, 0);
  const items = rest > 0 ? [...main, { family: "otros", share: rest }] : main;
  const [hover, setHover] = useState<string | null>(null);
  const W = 800, H = 380;
  const boxes = squarify(items, 0, 0, W, H);
  const focus = hover ?? items[0]?.family;
  return (
    <div className="genre-map">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
        aria-label={`géneros por e: ${items.map((i) => `${i.family} ${pct(i.share)}`).join(", ")}`}>
        {boxes.map((b) => (
          <g key={b.item.family} onMouseEnter={() => setHover(b.item.family)} onFocus={() => setHover(b.item.family)} tabIndex={0}>
            <rect x={b.x + 1.5} y={b.y + 1.5} width={Math.max(0, b.w - 3)} height={Math.max(0, b.h - 3)}
              fill={familyColor(b.item.family)} fillOpacity={focus === b.item.family ? 0.95 : 0.7} className="genre-box" />
            {b.w > 70 && b.h > 34 && (
              <>
                <text x={b.x + 12} y={b.y + 26} className="genre-box-label">{b.item.family}</text>
                <text x={b.x + 12} y={b.y + 46} className="genre-box-share">{pct(b.item.share)}</text>
              </>
            )}
          </g>
        ))}
      </svg>
      <div className="genre-map-detail" aria-live="polite">
        <span className="genre-chip" style={{ background: familyColor(focus ?? "") }} aria-hidden />
        <strong>{focus}</strong>
        <span>{(artists[focus ?? ""] ?? []).slice(0, 5).map((a) => a.name).join(" · ") || "varios"}</span>
      </div>
    </div>
  );
}

/* ---------- genres: share by year, direct labels ---------- */

export function GenreLines({ byYear }: { byYear: { year: number; families: FamilyShare[] }[] }) {
  const years = byYear.map((y) => y.year);
  const overall = new Map<string, number>();
  byYear.forEach((y) => y.families.forEach((f) => overall.set(f.family, (overall.get(f.family) ?? 0) + f.share)));
  const top = [...overall.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([f]) => f);
  const W = 800, H = 280, L = 40, R = 110, T = 14, B = 28;
  const max = Math.max(0.1, ...byYear.flatMap((y) => y.families.filter((f) => top.includes(f.family)).map((f) => f.share)));
  const yMax = Math.ceil(max * 10) / 10;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, years.length - 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / yMax);
  const series = top.map((family) => ({ family, values: byYear.map((yr) => yr.families.find((f) => f.family === family)?.share ?? 0) }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
      aria-label={`peso de cada género por año: ${series.map((s) => s.family).join(", ")}`}>
      {[0, yMax / 2, yMax].map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="time-chart-grid" />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" className="time-chart-axis">{pct(t)}</text>
        </g>
      ))}
      {years.map((yr, i) => <text key={yr} x={x(i)} y={H - 8} textAnchor="middle" className="time-chart-axis">{String(yr).slice(2)}</text>)}
      {series.map((s) => (
        <g key={s.family}>
          <polyline points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={familyColor(s.family)} strokeWidth="2.2" />
          {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="2.8" fill={familyColor(s.family)} />)}
          <text x={x(years.length - 1) + 10} y={y(s.values[s.values.length - 1]) + 4} fill={familyColor(s.family)} className="genre-direct-label">{s.family}</text>
        </g>
      ))}
    </svg>
  );
}

/* ---------- months against my average (divergent) ---------- */

/** tracked months only: 2016 and from 2020; 2017–2019 were not recorded, so they don't pull the average down */
export function MonthsVsAverage({ months, monthly, show = 24 }: { months: string[]; monthly: number[]; show?: number }) {
  const tracked = months.map((m, i) => ({ month: m, value: monthly[i] })).filter(({ month }) => {
    const year = Number(month.slice(0, 4));
    return year === 2016 || year >= 2020;
  });
  const complete = tracked.slice(0, -1); // the running month is not finished
  const avg = complete.reduce((s, m) => s + m.value, 0) / Math.max(1, complete.length);
  const recent = tracked.slice(-show);
  const maxDev = Math.max(1, ...recent.map((m) => Math.abs(m.value - avg)));
  const [active, setActive] = useState<number | null>(null);
  const shown = active !== null ? recent[active] : null;
  return (
    <figure className="diverge">
      <div className="time-chart-readout" aria-live="polite">
        {shown ? (
          <><strong>{n(shown.value)}</strong><span>{monthYear(shown.month)} · {shown.value >= avg ? "+" : "−"}{n(Math.round(Math.abs(shown.value - avg)))} contra mi promedio</span></>
        ) : <span>mi promedio mensual es de {n(Math.round(avg))} e</span>}
      </div>
      <div className="diverge-bars" role="img" aria-label={`diferencia de cada mes contra el promedio de ${n(Math.round(avg))} e`}>
        {recent.map((m, i) => {
          const dev = m.value - avg;
          const running = i === recent.length - 1;
          return (
            <button key={m.month} className={`diverge-col ${running ? "running" : ""}`} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)}
              onClick={() => setActive(i)} aria-label={`${monthYear(m.month)}: ${n(m.value)} e`}>
              <span className={dev >= 0 ? "up" : "down"} style={{ height: `${(Math.abs(dev) / maxDev) * 50}%` }} />
            </button>
          );
        })}
      </div>
      <div className="diverge-axis"><span>{monthYear(recent[0]?.month ?? "")}</span><span>promedio</span><span>{monthYear(recent[recent.length - 1]?.month ?? "")}</span></div>
    </figure>
  );
}

/* ---------- top artists per year: dot plot ---------- */

export function YearRanks({ ranks }: { ranks: ExploreFile["year_ranks"] }) {
  const [year, setYear] = useState(ranks[ranks.length - 1]?.year);
  const current = ranks.find((r) => r.year === year);
  const max = Math.max(1, ...(current?.top_artists.map((a) => a.plays) ?? [1]));
  return (
    <div className="year-ranks">
      <div className="year-ranks-years" role="tablist" aria-label="año">
        {ranks.map((r) => (
          <button key={r.year} role="tab" aria-selected={r.year === year} className={r.year === year ? "on" : ""} onClick={() => setYear(r.year)}>{r.year}</button>
        ))}
      </div>
      <ol className="dot-plot">
        {current?.top_artists.map((a, i) => (
          <li key={a.name}>
            <span className="dot-plot-name"><span className="tabular">{i + 1}</span>{a.name}</span>
            <span className="dot-plot-track" aria-hidden>
              <span className="dot-plot-stem" style={{ width: `${(a.plays / max) * 100}%` }} />
              <span className="dot-plot-dot" style={{ left: `${(a.plays / max) * 100}%` }} />
            </span>
            <span className="tabular dot-plot-value">{n(a.plays)}</span>
          </li>
        ))}
      </ol>
      {current?.top_family && <p className="year-ranks-note">ese año pesó más el {current.top_family}.</p>}
    </div>
  );
}

/* ---------- the last year, day by day ---------- */

const weekdayNames = ["lun", "", "mié", "", "vie", "", "dom"];
const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function CalendarHeatmap({ calendar }: { calendar: ExploreFile["calendar"] }) {
  const cells = useMemo(() => {
    const start = new Date(`${calendar.start}T12:00:00Z`);
    const offset = (start.getUTCDay() + 6) % 7; // monday = 0
    return calendar.counts.map((count, i) => {
      const d = new Date(start.getTime() + i * 86_400_000);
      const index = i + offset;
      return { count, date: d, col: Math.floor(index / 7), row: index % 7 };
    });
  }, [calendar]);
  const cols = Math.max(...cells.map((c) => c.col)) + 1;
  // square-root scale so a few huge days don't wash out the rest
  const level = (c: number) => (c === 0 ? 0 : Math.max(0.12, Math.sqrt(c / Math.max(1, calendar.max))));
  const S = 13, G = 3, L = 28, T = 18;
  const months = cells.filter((c) => c.date.getUTCDate() <= 7 && c.row === 0);
  return (
    <figure className="calendar">
      <svg viewBox={`0 0 ${L + cols * (S + G)} ${T + 7 * (S + G)}`} className="h-auto w-full" role="img"
        aria-label={`e por día, del ${calendar.start} al ${calendar.end}`}>
        {months.map((c) => <text key={c.col} x={L + c.col * (S + G)} y={11} className="time-chart-axis">{monthNames[c.date.getUTCMonth()]}</text>)}
        {weekdayNames.map((d, i) => d && <text key={d} x={0} y={T + i * (S + G) + 10} className="time-chart-axis">{d}</text>)}
        {cells.map((c) => (
          <rect key={c.date.toISOString()} x={L + c.col * (S + G)} y={T + c.row * (S + G)} width={S} height={S} rx="2"
            className={c.count === 0 ? "cal-empty" : "cal-day"} style={{ opacity: c.count === 0 ? 1 : level(c.count) }}>
            <title>{`${c.date.getUTCDate()} ${monthNames[c.date.getUTCMonth()]}: ${c.count} e`}</title>
          </rect>
        ))}
      </svg>
      <figcaption className="calendar-legend">
        <span>menos</span>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => <span key={v} className={v === 0 ? "cal-swatch empty" : "cal-swatch"} style={{ opacity: v === 0 ? 1 : Math.max(0.12, Math.sqrt(v)) }} />)}
        <span>más</span>
      </figcaption>
    </figure>
  );
}
