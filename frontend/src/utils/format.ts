import { getLanguage, locale } from "../i18n";
const numbers = { es: new Intl.NumberFormat("es-AR"), en: new Intl.NumberFormat("en-US") };

export const n = (value: number) => numbers[getLanguage()].format(value);

export function ago(unixSeconds: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now / 1000 - unixSeconds) / 60));
  if (getLanguage() === "en") {
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
    return minutes < 2880 ? "yesterday" : `${Math.floor(minutes / 1440)} days ago`;
  }
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "ayer" : `hace ${days} días`;
}

const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const shortMonth = (index: number) => (getLanguage() === "en" ? ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] : months)[index];
export const shortWeekday = (index: number) => (getLanguage() === "en" ? ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] : ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"])[index];

export function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${shortMonth(m - 1)} ${y}`;
}

export function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  return m === 1 ? `${shortMonth(0)} ${String(y).slice(2)}` : shortMonth(m - 1);
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

export const pct = (share: number, digits = 0) =>
  `${(share * 100).toLocaleString(locale(), { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;

export function hourLabel(hour: number): string {
  return `${hour} h`;
}

export function days(count: number): string {
  if (getLanguage() === "en") {
    if (count >= 730) return `${(count / 365).toLocaleString(locale(), { maximumFractionDigits: 1 })} years`;
    if (count >= 60) return `${Math.round(count / 30)} months`;
    return `${count} days`;
  }
  if (count >= 730) return `${(count / 365).toLocaleString("es-AR", { maximumFractionDigits: 1 })} años`;
  if (count >= 60) return `${Math.round(count / 30)} meses`;
  return `${count} días`;
}

const monthNames = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** 2020-05-27 -> "27 de mayo de 2020" */
export function longDate(iso: string): string {
  if (getLanguage() === "en") return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0,10)}T12:00:00Z`)).toLowerCase();
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} de ${monthNames[m - 1]} de ${y}`;
}

/** 2023-08-13 -> "agosto de 2023" */
export function monthYear(iso: string): string {
  if (getLanguage() === "en") return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0,7)}-01T12:00:00Z`)).toLowerCase();
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  return `${monthNames[m - 1]} de ${y}`;
}
