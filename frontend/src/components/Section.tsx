import type { ReactNode } from "react";

interface Props {
  id: string;
  title: string;
  /** small right-aligned aside, e.g. a link; never a tagline */
  aside?: ReactNode;
  children: ReactNode;
}

export function Section({ id, title, aside, children }: Props) {
  return (
    <section id={id} className="reveal scroll-mt-6 border-t border-line py-14 md:py-20">
      <header className="mb-10 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <h2 className="font-serif text-2xl text-ink md:text-3xl">{title}</h2>
        {aside && <div className="text-sm text-muted">{aside}</div>}
      </header>
      {children}
    </section>
  );
}
