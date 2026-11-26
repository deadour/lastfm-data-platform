import { getScrollContainer } from "./scrollContainer";

// jump to the #section in the url once the page is really there.
// data, covers and reveal animations keep changing the page height for a
// moment after load, and the browser restores its own scroll on top of that,
// so a single scrollIntoView lands in the wrong place. retry until the target
// stops moving, and give up as soon as the visitor scrolls on their own.

export function scrollToHashWhenSettled(win: Window = window, attempts = [0, 150, 400, 900, 1600, 2600]): () => void {
  const id = decodeURIComponent(win.location.hash.slice(1));
  if (!id) return () => {};
  if ("scrollRestoration" in win.history) win.history.scrollRestoration = "manual";
  let cancelled = false;
  const stop = () => { cancelled = true; };
  const events = ["wheel", "touchstart", "keydown", "mousedown"] as const;
  events.forEach((e) => win.addEventListener(e, stop, { once: true, passive: true }));
  const timers = attempts.map((delay) => win.setTimeout(() => {
    if (cancelled) return;
    const target = win.document.getElementById(id);
    if (target) {
      const scrollRoot = getScrollContainer();
      const anchorTop = scrollRoot === win ? 0 : (scrollRoot as HTMLElement).getBoundingClientRect().top;
      if (Math.abs(target.getBoundingClientRect().top - anchorTop) > 2) target.scrollIntoView({ block: "start" });
    }
  }, delay));
  return () => {
    stop();
    timers.forEach((t) => win.clearTimeout(t));
    events.forEach((e) => win.removeEventListener(e, stop));
  };
}
