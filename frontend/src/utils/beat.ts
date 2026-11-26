/**
 * Visual-only fallback for native audio players (not an audio-derived beat).
 * Safari/iOS plays media outside Web Audio so analyser data is unavailable.
 * Keep the subtle ambient movement alive for the whole preview.
 */
export function ambientBeat(elapsedMs: number): { beat: number; tint: number } {
  const phase = ((elapsedMs % 580) + 580) % 580 / 580;
  const hit = Math.pow(Math.max(0, Math.cos(phase * Math.PI * 2)), 6);
  return {
    beat: 0.18 + 0.55 * hit,
    tint: 0.16 + 0.15 * hit,
  };
}
