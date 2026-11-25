const number = new Intl.NumberFormat("es-AR");

export const n = (value: number) => number.format(value);

export function ago(unixSeconds: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now / 1000 - unixSeconds) / 60));
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "ayer" : `hace ${days} días`;
}

const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${months[m - 1]} ${y}`;
}

export function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  return m === 1 ? `${months[0]} ${String(y).slice(2)}` : months[m - 1];
}

/**
 * image urls as the browser should request them: https only (the page is
 * https and the csp lists https hosts), anything else is dropped.
 * cover art archive emits http:// thumbnails that also work over https.
 */
export function secureImage(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("https://")) return url;
  if (url.startsWith("http://")) return `https://${url.slice("http://".length)}`;
  return null;
}

/** stable 32-bit hash for generated cover colors */
export function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
