import { t as translate } from "../i18n";
export function Loading({ label = translate("abriendo el archivo") }: { label?: string }) {
  return <div className="archive-loading" role="status">
    <span className="archive-loading-bars" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ animationDelay: `${i * 130}ms` }} />)}</span>
    <span>{label}<span className="archive-loading-dots" aria-hidden="true">…</span></span>
  </div>;
}
