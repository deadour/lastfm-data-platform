import { t as translate } from "../i18n";
import type { RhythmCell } from "../data/types";
import { shortWeekday } from "../utils/format";

const days = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

export function Rhythm({ cells }: { cells: RhythmCell[] }) {
  const max = Math.max(...cells.map((c) => c.share), Number.EPSILON);
  const grid = new Map(cells.map((c) => [`${c.weekday}-${c.hour}`, c.share]));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-1.5">
        <caption className="sr-only">{translate("e por día de la semana y hora")}</caption>
        <thead>
          <tr>
            <th />
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} scope="col" className="tabular text-[10px] font-normal text-muted">
                {h % 6 === 0 ? `${h}h` : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((day, d) => (
            <tr key={day}>
              <th scope="row" className="pr-3 text-left text-xs font-normal text-muted">
                {shortWeekday((d + 1) % 7)}
              </th>
              {Array.from({ length: 24 }, (_, h) => {
                const share = grid.get(`${d}-${h}`) ?? 0;
                return (
                  <td key={h} title={`${shortWeekday((d + 1) % 7)} ${h}h`}>
                    <span
                      className="mx-auto block aspect-square w-full max-w-4 rounded-full bg-ink"
                      style={{ opacity: 0.06 + (share / max) * 0.9 }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
