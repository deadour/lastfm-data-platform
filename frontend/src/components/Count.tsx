import { n } from "../utils/format";
import { t as translate } from "../i18n";

/** a scrobble count with its "e" unit, never split across lines */
export function Count({ value }: { value: number }) {
  return <span className="count-value tabular" title={translate("escuchas registradas")}>{n(value)}<small className="count-unit">e</small></span>;
}
