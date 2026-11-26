import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

export type Route =
  | { page: "home" }
  | { page: "artists" }
  | { page: "artist"; slug: string };

export function parse(path: string): Route {
  const clean = path.replace(/\/+$/, "") || "/";
  const artist = /^\/artistas\/([a-z0-9-]{1,80})$/.exec(clean);
  if (artist) return { page: "artist", slug: artist[1] };
  if (clean === "/artistas") return { page: "artists" };
  return { page: "home" };
}

const EVENT = "fm:navigate";

export function navigate(href: string) {
  window.history.pushState(null, "", href);
  window.dispatchEvent(new Event(EVENT));
  const hash = href.split("#")[1];
  if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
  else window.scrollTo({ top: 0 });
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.pathname));
  useEffect(() => {
    const update = () => setRoute(parse(window.location.pathname));
    window.addEventListener("popstate", update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return route;
}

/** internal link that keeps the single page app instead of reloading */
export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (href.startsWith("#") && window.location.pathname === "/") return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}
