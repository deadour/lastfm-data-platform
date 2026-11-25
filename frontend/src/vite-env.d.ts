/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "live" makes `npm run dev` call /api/now-playing instead of the mock */
  readonly VITE_NOW_PLAYING?: string;
}
