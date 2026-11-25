import { useEffect, useState } from "react";
import { mockNowPlaying } from "../data/mock";
import type { NowPlaying } from "../data/types";

const INTERVAL_MS = 30_000;

// vite's dev server has no pages functions; use the mock unless asked otherwise.
const useMock = import.meta.env.DEV && import.meta.env.VITE_NOW_PLAYING !== "live";

export function useNowPlaying(): NowPlaying | null {
  const [state, setState] = useState<NowPlaying | null>(useMock ? mockNowPlaying : null);

  useEffect(() => {
    if (useMock) return;
    let timer: number | undefined;
    let controller: AbortController | undefined;

    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/now-playing", { signal: controller.signal });
        if (response.ok) setState((await response.json()) as NowPlaying);
      } catch {
        // keep the last value; the next tick retries
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
