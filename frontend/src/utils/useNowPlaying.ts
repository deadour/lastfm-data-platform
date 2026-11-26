import { useEffect, useState } from "react";
import type { NowPlaying } from "../data/types";

const INTERVAL_MS = 30_000;

export function useNowPlaying(): NowPlaying | null {
  const [state, setState] = useState<NowPlaying | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    let controller: AbortController | undefined;

    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/now-playing", { signal: controller.signal });
        if (!response.ok) { setState(null); return; }
        const body = await response.json() as NowPlaying;
        setState(body.source === "lastfm" && typeof body.playing === "boolean" ? body : null);
      } catch {
        // Let the archive fallback take over; don't leave an old song "playing".
        if (!controller?.signal.aborted) setState(null);
      }
    };

    const start = () => {
      window.clearInterval(timer);
      void tick();
      timer = window.setInterval(tick, INTERVAL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else window.clearInterval(timer);
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return state;
}
