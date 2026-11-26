import { describe, expect, it } from "vitest";
import { ambientBeat } from "./beat";

describe("ambientBeat", () => {
  it("never switches off while the audio is playing", () => {
    for (let ms = 0; ms < 30_000; ms += 37) {
      const state = ambientBeat(ms);
      expect(state.beat).toBeGreaterThanOrEqual(0.18);
      expect(state.tint).toBeGreaterThanOrEqual(0.16);
    }
  });

  it("pulses steadily rather than fading out over time", () => {
    expect(ambientBeat(0)).toEqual(ambientBeat(580 * 10));
    expect(ambientBeat(580 * 10).beat).toBeGreaterThan(ambientBeat(580 * 10 + 290).beat);
  });
});
