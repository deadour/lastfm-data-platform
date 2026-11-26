import { useEffect, useState, type CSSProperties } from "react";
import { hash, secureImage } from "../utils/format";
import { cachedArtwork } from "../utils/artwork";

interface Props {
  seed: string;
  image?: string | null;
  label: string;
  className?: string;
  /** small thumbnail: no name overlay */
  compact?: boolean;
  style?: CSSProperties;
  priority?: boolean;
  /** when there is no image (or it fails), look the album up on apple */
  album?: { artist: string; title: string };
}

const found = new Map<string, string | null>();
const fold = (v: string) => v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\(.*?\)|\[.*?\]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

let photos: Promise<Map<string, string>> | null = null;
/** artist photos already published by the site (top artists and the odd ones out) */
function artistPhotos(): Promise<Map<string, string>> {
  photos ??= Promise.all([
    fetch("/data/insights.json").then((r) => r.json()).catch(() => ({})),
    fetch("/data/explore.json").then((r) => r.json()).catch(() => ({})),
  ]).then(([ins, exp]) => {
    const map = new Map<string, string>();
    for (const a of (ins as { artists?: { name: string; photo?: { url: string } | null }[] }).artists ?? []) if (a.photo?.url) map.set(fold(a.name), a.photo.url);
    const r = (exp as { rarities?: Record<string, { name: string; photo?: { url: string } | null }[]> }).rarities ?? {};
    for (const a of Object.values(r).flat()) if (a.photo?.url) map.set(fold(a.name), a.photo.url);
    return map;
  });
  return photos;
}

/** album artwork from apple's search (cors allowed), cached per page load */
async function appleAlbumArt(artist: string, title: string): Promise<string | null> {
  const key = `${fold(artist)}|${fold(title)}`;
  if (found.has(key)) return found.get(key)!;
  let art: string | null = null;
  try {
    const url = new URL("https://itunes.apple.com/search");
    url.search = new URLSearchParams({ term: `${artist} ${fold(title)}`, entity: "album", limit: "15" }).toString();
    const body = await (await fetch(url.href)).json() as { results?: { artistName?: string; collectionName?: string; artworkUrl100?: string }[] };
    const hit = body.results?.find((r) => r.artworkUrl100 && fold(r.artistName ?? "").includes(fold(artist).split(" ")[0])
      && fold(r.collectionName ?? "").includes(fold(title)))
      ?? body.results?.find((r) => r.artworkUrl100 && fold(r.artistName ?? "") === fold(artist));
    art = hit?.artworkUrl100?.replace("100x100bb", "600x600bb") ?? null;
  } catch { art = null; }
  found.set(key, art);
  return art;
}

// real artwork when there is a url; otherwise a quiet gradient derived from the name.
export function Cover({ seed, image, label, className = "", compact = false, style, priority = false, album }: Props) {
  const [failed, setFailed] = useState<string | null>(null);
  const [direct, setDirect] = useState<string | null>(null);
  const [extra, setExtra] = useState<string | null>(null);
  const needsExtra = !!album && (!secureImage(image) || failed !== null);
  useEffect(() => {
    if (!needsExtra || !album) return;
    let live = true;
    // album cover from apple; if there is none, at least the artist's photo
    void appleAlbumArt(album.artist, album.title)
      .then(async (art) => art ?? (await artistPhotos()).get(fold(album.artist)) ?? null)
      .then((art) => { if (live) setExtra(art); });
    return () => { live = false; };
  }, [needsExtra, album?.artist, album?.title]);
  const original = secureImage(image) && failed === null ? secureImage(image) : extra ?? secureImage(image);
  const src = direct === original ? original : cachedArtwork(original);
  const h = hash(seed);
  const hue = h % 360;
  const second = (hue + 25 + ((h >> 9) % 70)) % 360;
  const angle = (h >> 3) % 180;
  const background = `linear-gradient(${angle}deg, hsl(${hue} 30% 34%), hsl(${second} 26% 15%))`;

  return (
    <div className={`relative aspect-square overflow-hidden bg-neutral-900 ${className}`} style={style}>
      {src && failed !== src ? (
        <img
          src={src}
          alt={label}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          onError={() => src !== original ? setDirect(original) : setFailed(src)}
          className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
        />
      ) : (
        <div
          role="img"
          aria-label={label}
          className="h-full w-full transition-transform duration-700 ease-out group-hover:scale-[1.03]"
          style={{ background }}
        >
          {!compact && (
            <span className="absolute bottom-3 left-3 right-3 font-serif text-sm leading-tight text-white/55">{seed}</span>
          )}
        </div>
      )}
    </div>
  );
}
