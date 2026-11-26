/** Document-space top coordinate of a bottom-docked overlay.
 * iOS 26 may paint position: fixed; bottom:0 mid-screen after toolbar collapse.
 * An absolutely positioned portal updated from the actual visual viewport
 * avoids relying on that broken fixed-position compositor layer.
 */
export function mobileDockTop(pageTop: number, viewportHeight: number, dockHeight: number): number {
  if (![pageTop, viewportHeight, dockHeight].every(Number.isFinite)) return 0;
  return Math.max(0, Math.round(pageTop + viewportHeight - dockHeight));
}
