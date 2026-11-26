import { t as translate } from "../i18n";
import { Link } from "../utils/router";

interface Item { name: string; href: string | null }

/** endless strip of names; doubled so the loop has no seam */
export function Marquee({ items }: { items: Item[] }) {
  if (!items.length) return null;
  const row = (copy: number) => items.map((item, i) => (
    <span key={`${copy}-${i}`} className="flex shrink-0 items-center gap-6 pr-6" aria-hidden={copy === 1}>
      {item.href && copy === 0 ? (
        <Link href={item.href} className="font-serif text-xl text-ink/70 transition-colors hover:text-ink md:text-2xl">{item.name}</Link>
      ) : (
        <span className="font-serif text-xl text-ink/70 md:text-2xl">{item.name}</span>
      )}
      <span className="text-[#a8533f]" aria-hidden>✶</span>
    </span>
  ));
  return (
    <div className="marquee border-b border-line py-5" aria-label={translate("los artistas que más escuché")}>
      <div className="marquee-track">{row(0)}{row(1)}</div>
    </div>
  );
}
