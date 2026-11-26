/** Only public artwork providers may be fetched by the shared image cache. */
export function artworkSource(value: string | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
    const host = url.hostname;
    const allowed = host === "coverartarchive.org" || host === "archive.org" || host.endsWith(".archive.org") ||
      host === "cdn-images.dzcdn.net" || host === "e-cdns-images.dzcdn.net" || host === "lastfm.freetls.fastly.net";
    return allowed ? url : null;
  } catch {
    return null;
  }
}

export function cachedArtwork(value: string | null): string | null {
  const source = artworkSource(value);
  return source ? `/api/artwork?url=${encodeURIComponent(source.href)}` : value;
}
