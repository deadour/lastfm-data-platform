import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLanguage, setLanguage, t } from "./i18n";
import { ago, days, monthYear, n, shortMonth, shortWeekday } from "./utils/format";

beforeEach(() => {
  vi.stubGlobal("document", { documentElement: { lang: "es" } });
  vi.stubGlobal("window", { location: { href: "https://fm.example/canciones#top" }, history: { replaceState: vi.fn() } });
  setLanguage("es");
});
afterEach(() => { setLanguage("es"); vi.unstubAllGlobals(); });

describe("language selection", () => {
  it("defaults to Spanish and changes copy, dates and counts together", () => {
    expect(getLanguage()).toBe("es");
    expect(n(12500)).toBe("12.500");
    setLanguage("en");
    expect(t("sobre este proyecto")).toBe("about this project");
    expect(n(12500)).toBe("12,500");
    expect(monthYear("2026-08")).toBe("august 2026");
    expect(shortMonth(11)).toBe("dec");
    expect(shortWeekday(2)).toBe("tue");
    expect(days(15)).toBe("15 days");
    expect(ago(100, 160000)).toBe("1 min ago");
    expect(document.documentElement.lang).toBe("en");
    setLanguage("es");
    expect(t("sobre este proyecto")).toBe("sobre este proyecto");
  });
  it("preserves spacing and music names when translating interface text", () => {
    setLanguage("en");
    expect(t(" artistas ")).toBe(" artists ");
    expect(t("portada de Un verano sin ti")).toBe("cover of Un verano sin ti");
    expect(t("Patricio Rey y sus Redonditos de Ricota")).toBe("Patricio Rey y sus Redonditos de Ricota");
    const args = vi.mocked(window.history.replaceState).mock.calls.at(-1);
    expect(String(args?.[2])).toBe("https://fm.example/canciones?lang=en#top");
  });
});
