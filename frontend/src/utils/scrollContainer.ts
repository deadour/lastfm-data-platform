/** On mobile, only the archive scrolls. The document stays still so Safari's
 * collapsing toolbar cannot displace the header or the player.
 * Desktop keeps native window scrolling.
 */
export function getScrollContainer(): Window | HTMLElement {
  if (typeof window === "undefined") throw new Error("Browser required");
  const inner = document.getElementById("app-scroll");
  return window.matchMedia("(max-width: 640px)").matches && inner ? inner : window;
}

export function readingScrollTop(): number {
  const scrolling = getScrollContainer();
  return scrolling === window ? window.scrollY : (scrolling as HTMLElement).scrollTop;
}

export function scrollArchiveTo(top: number, behavior: ScrollBehavior = "instant"): void {
  getScrollContainer().scrollTo({ top, behavior });
}

export function isInnerScroll(): boolean {
  return typeof window !== "undefined" && getScrollContainer() !== window;
}
