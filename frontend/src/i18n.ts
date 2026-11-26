import { useSyncExternalStore } from "react";
import { english } from "./locales/en";

export type Language = "es" | "en";
let language: Language = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("lang") === "en" ? "en" : "es";
const listeners = new Set<() => void>();
export const getLanguage = () => language;
export const locale = () => language === "en" ? "en-US" : "es-AR";
export function setLanguage(value: Language) {
  language = value;
  document.documentElement.lang = value;
  const url = new URL(window.location.href);
  if (value === "en") url.searchParams.set("lang", "en");
  else url.searchParams.delete("lang");
  window.history.replaceState(null, "", url);
  for (const listener of listeners) listener();
}
export function useLanguage() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getLanguage, () => "es" as const);
}
export function t(text: string): string {
  if (language === "es") return text;
  const key = text.trim();
  const translated = english[text] ?? english[key];
  if (translated) return text.replace(key, translated);
  return text
    .replace(/^portada de /, "cover of ")
    .replace(/^escuchar algo de /, "play something by ")
    .replace(/^escuchar /, "listen to ")
    .replace(/, de /g, ", by ")
    .replace(/^buscar (.*) en spotify$/, "search $1 on spotify")
    .replace(/^buscar (.*) en youtube$/, "search $1 on youtube")
    .replace(/^semana del /, "week of ")
    .replace(/^los últimos (\d+) meses · $/, "the last $1 months · ")
    .replace(/^lo último que quedó registrado/, "last archived play")
    .replace(/^lo último, /, "last played, ")
    .replace(/^distribución por género: /, "genre distribution: ")
    .replace(/^peso de cada género por año: /, "genre shares by year: ")
    .replace(/^registros por día, del (.*) al (.*)$/, "daily records, from $1 to $2")
    .replace(/^(\d[\d.,]*) registros en lastfm$/, "$1 records on lastfm")
    .replace(/^(\d[\d.,]*) artistas · (\d+) años$/, "$1 artists · $2 years")
    .replace(/^no encontré «(.*)», pero encontré este de ese estilo$/, "no preview for ‘$1’; playing something similar")
    .replace(/^e en /, "plays in ")
    .replace(/^e de (.*) por mes$/, "monthly plays of $1");
}
