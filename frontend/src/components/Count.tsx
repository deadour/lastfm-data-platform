import { n } from "../utils/format";

/** a scrobble count with its "e" unit, never split across lines */
export function Count({ value }: { value: number }) {
  return <span className="count-value tabular">{n(value)}<small className="count-unit">e</small></span>;
}
