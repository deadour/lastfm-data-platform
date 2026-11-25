import type { ReactNode } from "react";

interface Props {
  id: string;
  title: string;
  note?: string;
  children: ReactNode;
}

export function Section({ id, title, note, children }: Props) {
  return (
    <section id={id} className="reveal border-t border-line py-14 md:py-20">
      <header className="mb-10 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <h2 className="font-serif text-3xl text-ink md:text-4xl">{title}</h2>
        {note && <p className="max-w-md text-sm text-muted">{note}</p>}
      </header>
      {children}
    </section>
  );
}
