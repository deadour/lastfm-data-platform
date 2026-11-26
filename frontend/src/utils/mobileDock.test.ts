import { describe, expect, it } from "vitest";
import { mobileDockTop } from "./mobileDock";

describe("mobileDockTop", () => {
  it("pins the bottom to the visible viewport", () => {
    expect(mobileDockTop(0, 700, 74)).toBe(626);
    expect(mobileDockTop(1200, 700, 74)).toBe(1826);
  });
  it("tracks mobile chrome hiding and showing", () => {
    expect(mobileDockTop(1200, 740, 74)).toBe(1866);
    expect(mobileDockTop(1200, 620, 74)).toBe(1746);
  });
  it("never places the dock above document origin", () => {
    expect(mobileDockTop(0, 40, 74)).toBe(0);
  });
});
