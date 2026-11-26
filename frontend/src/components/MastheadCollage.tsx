import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { InsightsFile, StatsFile } from "../data/types";
import { cachedArtwork } from "../utils/artwork";

interface Tile { url: string; angle: number; offset: number }

function CollageStrip({ pool, row, seen }: { pool: Tile[]; row: number; seen: Set<string> }) {
  const element = useRef<HTMLDivElement>(null);
  const [tiles, setTiles] = useState(() => {
    const initial = pool.slice(row * 8, row * 8 + 8);
    initial.forEach((tile) => seen.add(tile.url));
    return initial;
  });
  useLayoutEffect(() => {
    const node = element.current;
    if (!node || !tiles.length) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const duration = row ? 7500 : 6000;
    // Advance one card, then recycle only the card that is entirely offscreen.
    const animation = node.animate([
      { transform: row ? "translate3d(-40%, 0, 0)" : "translate3d(0, 0, 0)" },
      { transform: row ? "translate3d(-20%, 0, 0)" : "translate3d(-20%, 0, 0)" },
    ], { duration: duration * (query.matches ? 2 : 1), fill: "forwards", easing: "linear" });
    animation.onfinish = () => {
      let candidates = pool.filter((tile) => !seen.has(tile.url));
      if (!candidates.length) {
        seen.clear(); tiles.forEach((tile) => seen.add(tile.url));
        candidates = pool.filter((tile) => !seen.has(tile.url));
      }
      const next = candidates[Math.floor(Math.random() * candidates.length)];
      if (!next) return;
      seen.add(next.url);
      setTiles(row ? [next, ...tiles.slice(0, -1)] : [...tiles.slice(1), next]);
    };
    const onPreference = () => animation.effect?.updateTiming({ duration: duration * (query.matches ? 2 : 1) });
    const onVisibility = () => document.visibilityState === "visible" ? animation.play() : animation.pause();
    onVisibility();
    query.addEventListener("change", onPreference);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { animation.cancel(); query.removeEventListener("change", onPreference); document.removeEventListener("visibilitychange", onVisibility); };
  }, [tiles, pool, row, seen]);
  return <div ref={element} className="collage-row">
    {tiles.map((tile) => <span key={tile.url} className="collage-slot" style={{ ["--tilt" as string]: `${tile.angle}deg`, ["--offset" as string]: `${tile.offset}px`, animationDelay: `${tile.offset}s` }}>
      <img src={cachedArtwork(tile.url) ?? undefined} alt="" decoding="async"
        onLoad={(e) => { e.currentTarget.dataset.loaded = "true"; }}
        onError={(e) => { if (!e.currentTarget.dataset.retry) { e.currentTarget.dataset.retry = "true"; e.currentTarget.src = tile.url; } }} />
    </span>)}
  </div>;
}

export function MastheadCollage({ stats, insights }: { stats: StatsFile | null; insights: InsightsFile | null }) {
  const seen = useRef(new Set<string>());
  const pool = useMemo(() => {
    if (!stats || !insights) return [];
    const artists = insights.artists.flatMap((a) => a.photo?.url ? [a.photo.url] : []);
    const albums = (stats.top_albums ?? []).flatMap((a) => a.cover?.url ? [a.cover.url] : a.image ? [a.image] : []);
    const shuffle = (items: string[]) => {
      const copy = [...new Set(items)];
      for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
      return copy;
    };
    const people = shuffle(artists), records = shuffle(albums);
    return Array.from({ length: people.length + records.length }, (_, i) => ({
      url: i % 2 ? people.pop() ?? records.pop() : records.pop() ?? people.pop(),
      angle: Math.random() * 18 - 9,
      offset: Math.random() * 20 - 10,
    })).filter((tile): tile is Tile => !!tile.url);
  }, [stats, insights]);
  return <div className="masthead-collage" aria-hidden="true">
    {pool.length > 0 && [0, 1].map((row) => <CollageStrip key={row} pool={pool} row={row} seen={seen.current} />)}
  </div>;
}
