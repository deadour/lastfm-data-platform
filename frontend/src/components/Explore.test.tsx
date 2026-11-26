import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MonthsVsAverage } from "./Explore";

describe("MonthsVsAverage", () => {
  it("shows full year labels, explains the colors and keeps monthly bars interactive", () => {
    const html = renderToStaticMarkup(
      <MonthsVsAverage months={["2025-12", "2026-01", "2026-02"]} monthly={[900, 1400, 1200]} />,
    );
    expect(html).toContain("ene 2026");
    expect(html).toContain("más que el promedio");
    expect(html).toContain("menos que el promedio");
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain("diverge-col running");
  });

  it("marks the current month as unfinished without excluding historical months", () => {
    const today = new Date();
    const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const previous = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const html = renderToStaticMarkup(
      <MonthsVsAverage months={[key(previous), key(today)]} monthly={[800, 150]} />,
    );
    expect(html).toContain("mes en curso");
    expect(html).toContain("diverge-col running");
  });
});
