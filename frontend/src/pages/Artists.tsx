import { useMemo, useState } from "react";
import { ArtistGrid } from "../components/Insights";
import type { InsightsFile } from "../data/types";

const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function Artists({ insights }: { insights: InsightsFile | null }) {
  const [query, setQuery] = useState("");
  const artists = useMemo(() => {
    const all = insights?.artists ?? [];
    const q = plain(query.trim());
    return q ? all.filter((a) => plain(a.name).includes(q)) : all;
  }, [insights, query]);

  if (!insights) return <p role="status" className="py-32 text-sm text-muted">cargando…</p>;

  return (
    <div className="fade-in">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-line py-12">
        <h1 className="font-serif text-5xl tracking-tight text-ink md:text-6xl">artistas</h1>
        <label className="w-full max-w-xs">
          <span className="sr-only">buscar artista</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="buscar…"
            className="w-full border-b border-line bg-transparent py-2 text-sm text-ink placeholder:text-muted focus:border-white/40 focus:outline-none"
          />
        </label>
      </header>
      <div className="py-12">
        {artists.length ? <ArtistGrid artists={artists} /> : <p className="text-sm text-muted">ninguno con ese nombre entre los {insights.artists.length} que más escuché.</p>}
      </div>
    </div>
  );
}
