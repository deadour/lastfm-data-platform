import { t as translate } from "../i18n";
import { createPortal } from "react-dom";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadArtist } from "../data/insights";
import { ambientBeat } from "../utils/beat";
import type { AlbumStat, TrackStat } from "../data/types";
import { previewCandidates, type GenreArtists, type PreviewCandidate } from "../utils/previewFallbacks";

// one persistent <audio> behind a fixed dock with our own controls.
// sound starts only after a tap. mobile browsers may require a second tap once
// an asynchronously looked-up preview URL becomes ready. the dock exposes
// that action instead of hiding playback failures.

interface Selection { artist: string; title: string; status: "loading" | "ready" | "unavailable" | "error"; url?: string; source?: string; provider?: string; note?: string }
interface Context {
  /** title optional: without it, my most played song by that artist (or any playable one) */
  play: (artist: string, title?: string, slug?: string | null, albumKey?: string | null) => void;
  playQueue: (tracks: { artist: string; title: string }[]) => void;
  /** a genre: one of these artists, falling back to the others */
  playGenre: (artists: string[]) => void;
  selection: Selection | null;
  playing: boolean;
  enabled: boolean;
  /** something I listen to, at random */
  random: () => void;
  /** the catalog key of one of my albums, to play it as a queue */
  albumKeyFor: (artist: string, title: string) => string | null;
}
const PreviewContext = createContext<Context | null>(null);

const SILENCE = "/silence.wav";
interface PreviewPlan {
  request: { artist: string; title: string };
  candidates: PreviewCandidate[];
  cursor: number;
  active: { url: string; provider?: string } | null;
}

const ALLOWED = (u: URL) => u.protocol === "https:" && !u.username && !u.password && !u.port &&
  (u.hostname.endsWith(".dzcdn.net") || u.hostname === "audio-ssl.itunes.apple.com" || u.hostname.endsWith(".mzstatic.com"));

const fold = (v: string) => v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\(.*?\)|\[.*?\]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// AbortSignal.timeout is missing on older mobile Safari versions.
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  try { return await fetch(url, { signal: controller.signal }); }
  finally { window.clearTimeout(timer); }
}

/** strip version noise so "golden brown - slowed down version" finds "golden brown" */
const baseTitle = (t: string) => fold(t.replace(/\s[-–]\s.*$/, "").replace(/\s(remaster(ed)?|live|version|edit|mix|feat\.?)\b.*$/i, ""));

/** browser-side fallback: apple's search api allows cors. tries the argentine store, then the us one,
    and accepts the base title when the exact one isn't there */
async function applePreview(artist: string, title: string, country: "AR" | "US"): Promise<Found | null> {
  const url = new URL("https://itunes.apple.com/search");
  url.search = new URLSearchParams({ term: `${artist} ${title ? baseTitle(title) : ""}`.trim(),
    entity: "song", media: "music", limit: "50", country }).toString();
  let body: { results?: { artistName?: string; trackName?: string; previewUrl?: string; trackViewUrl?: string }[] };
  try {
    const response = await fetchWithTimeout(url.href, 2700);
    if (!response.ok) return null;
    body = await response.json();
  } catch { return null; }
  const byArtist = (body.results ?? []).filter((r) => r.artistName && r.trackName && r.previewUrl &&
    [r.artistName, r.artistName.split(",")[0], r.artistName.split(" & ")[0]].some((a) => fold(a) === fold(artist)));
  const pick = !title ? shuffle(byArtist)[0]
    : byArtist.find((r) => fold(r.trackName!) === fold(title))
      ?? byArtist.find((r) => baseTitle(r.trackName!) === baseTitle(title))
      ?? byArtist.find((r) => fold(r.trackName!).startsWith(baseTitle(title)));
  return pick?.previewUrl ? { url: pick.previewUrl, source_url: pick.trackViewUrl,
    provider: "apple", title: pick.trackName } : null;
}

type Found = { url: string; source_url?: string; provider?: string; title?: string };
const previewCache = new Map<string, { result: Found | null; expires: number }>();
const previewPending = new Map<string, Promise<Found | null>>();

/** Query providers concurrently and return the first valid preview.
 * Signed CDN links are only cached briefly; misses are cached for 20 seconds.
 */
async function findPreview(artist: string, title: string): Promise<Found | null> {
  const key = `${fold(artist)}\0${baseTitle(title)}`;
  const cached = previewCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  const pending = previewPending.get(key);
  if (pending) return pending;

  const api = async (): Promise<Found | null> => {
    try {
      const query = new URLSearchParams(title ? { artist, title } : { artist });
      const response = await fetchWithTimeout(`/api/preview?${query}`, 3300);
      if (!response.ok) return null;
      const data = await response.json() as { preview?: Found | null };
      const url = data?.preview?.url ? new URL(data.preview.url) : null;
      return url && ALLOWED(url) ? data.preview! : null;
    } catch { return null; }
  };
  const validApple = async (country: "AR" | "US"): Promise<Found | null> => {
    const result = await applePreview(artist, title, country);
    if (!result) return null;
    try { return ALLOWED(new URL(result.url)) ? result : null; }
    catch { return null; }
  };
  const required = (search: Promise<Found | null>) => search.then((result) => {
    if (!result) throw new Error("No preview found");
    return result;
  });
  const work = Promise.any([required(validApple("AR")), required(api()), required(validApple("US"))])
    .catch(() => null)
    .then((result) => {
      previewCache.delete(key);
      previewCache.set(key, { result, expires: Date.now() + (result ? 180_000 : 20_000) });
      if (previewCache.size > 256) previewCache.delete(previewCache.keys().next().value!);
      return result;
    }).finally(() => previewPending.delete(key));
  previewPending.set(key, work);
  return work;
}

let lastSong = "";
let slugCache: Map<string, string> | null = null;
async function slugFor(artist: string): Promise<string | null> {
  if (!slugCache) {
    try {
      const body = await (await fetch("/data/insights.json")).json() as { artists?: { name: string; slug: string }[] };
      slugCache = new Map((body.artists ?? []).map((a) => [fold(a.name), a.slug]));
    } catch { slugCache = new Map(); }
  }
  return slugCache.get(fold(artist)) ?? null;
}

const shuffle = <T,>(list: T[]) => [...list].sort(() => Math.random() - .5);

const clock = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

export function PreviewProvider({ children, artists = [], albums = [], tracks = [], genres = {} }: { children: ReactNode; artists?: { name: string; slug: string }[]; albums?: AlbumStat[]; tracks?: TrackStat[]; genres?: GenreArtists }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [playing, setPlaying] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [requiresTap, setRequiresTap] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const [shuffled, setShuffled] = useState(true);
  const queue = useRef<{ artist: string; title: string }[]>([]);
  const queueScope = useRef<{ slug: string | null; albumKey: string | null }>({ slug: null, albumKey: null });
  const playedInQueue = useRef(new Set<string>());
  const customQueue = useRef(false);
  // other artists of the genre being played, used only as fallbacks
  const relatedArtists = useRef<string[]>([]);
  const pendingRelated = useRef<string[]>([]);
  const playedAcrossQueues = useRef(new Set<string>());
  const [time, setTime] = useState({ current: 0, duration: 30 });
  const sequence = useRef(0);
  const previewPlan = useRef<PreviewPlan | null>(null);
  const failedUrls = useRef(new Set<string>());
  const audio = useRef<HTMLAudioElement>(null);
  // Keep non-CORS providers outside the Web Audio graph to avoid silent playback.
  const plainAudio = useRef<HTMLAudioElement>(null);
  const activeAudio = useRef<HTMLAudioElement | null>(null);
  const touchAudio = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const preferredAudio = () => touchAudio() ? plainAudio.current ?? audio.current : audio.current;
  const audioContext = useRef<AudioContext | null>(null);
  useEffect(() => () => { void audioContext.current?.close(); }, []);

  const unlock = (el: HTMLAudioElement) => {
    el.pause();
    el.src = SILENCE;
    void el.play().catch(() => {});
  };

  const toggle = () => {
    const el = activeAudio.current ?? preferredAudio();
    if (!el) return;
    if (el.paused) {
      void audioContext.current?.resume();
      void el.play().then(() => setRequiresTap(false)).catch(() => {
        setPlaying(false);
        setRequiresTap(true);
      });
    } else el.pause();
  };

  const advancePreview = async (requestId: number): Promise<void> => {
    const plan = previewPlan.current;
    if (!plan || requestId !== sequence.current) return;
    plan.active = null;
    setSelection({ artist: plan.request.artist, title: plan.request.title || "…", status: "loading" });
    while (plan.cursor < plan.candidates.length) {
      // Try the exact requested song first, then batches of three alternatives.
      const size = plan.cursor === 0 && plan.candidates[0]?.reason === "requested" ? 1 : 3;
      const batch = plan.candidates.slice(plan.cursor, plan.cursor + size);
      plan.cursor += batch.length;
      const first = await Promise.any(batch.map(async (candidate) => {
        const found = await findPreview(candidate.artist, candidate.title);
        if (!found || failedUrls.current.has(found.url)) throw new Error("No usable preview");
        return { candidate, found };
      })).catch(() => null);
      if (requestId !== sequence.current || plan !== previewPlan.current) return;
      if (!first) continue;
      const { candidate, found } = first;

      const target = preferredAudio();
      if (!target) return;
      audio.current?.pause();
      plainAudio.current?.pause();
      activeAudio.current = target;
      target.volume = volume;
      delete target.dataset.directRetry;
      plan.active = { url: found.url, provider: found.provider };
      const actualTitle = found.title || candidate.title;
      const note = candidate.reason === "requested" ? undefined
        : candidate.reason === "artist" || candidate.reason === "queue"
          ? translate("no encontré el tema; suena otro del mismo artista")
          : candidate.reason === "genre"
            ? translate("no encontré el tema; suena algo de la misma onda")
            : translate("no encontré algo de ese estilo; suena otra de mi biblioteca");
      setSelection({ artist: candidate.artist, title: actualTitle, status: "ready",
        url: found.url, source: found.source_url, provider: found.provider, note });
      const needsProxy = new URL(found.url).hostname.endsWith(".dzcdn.net");
      target.src = needsProxy ? `/api/audio?${new URLSearchParams({ url: found.url })}` : found.url;
      void target.play().then(() => {
        if (requestId === sequence.current) setRequiresTap(false);
      }).catch((error: unknown) => {
        if (requestId !== sequence.current || plan !== previewPlan.current) return;
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          // Mobile Safari requires a fresh tap after an asynchronous lookup.
          setRequiresTap(true);
          return;
        }
        // A URL can exist but fail to decode or load: continue to the next candidate.
        failPreview(found.url);
      });
      return;
    }
    activeAudio.current?.pause();
    setPlaying(false);
    setSelection({ artist: plan.request.artist, title: plan.request.title || "…", status: "unavailable" });
  };

  const failPreview = (url: string) => {
    const plan = previewPlan.current;
    if (!plan?.active || plan.active.url !== url || failedUrls.current.has(url)) return;
    failedUrls.current.add(url);
    setPlaying(false);
    void advancePreview(sequence.current);
  };

  const play = (artist: string, title = "", slug: string | null = null, albumKey: string | null = null, continuation = false) => {
    const el = preferredAudio();
    if (!el) return;
    setEnabled(true); // a tap on anything playable opens the dock
    setRequiresTap(false);
    if (!continuation && selection?.artist === artist && title && selection.title === title && selection.status === "ready" && queueScope.current.albumKey === albumKey) {
      toggle();
      return;
    }
    const current = ++sequence.current;
    previewPlan.current = null;
    failedUrls.current.clear();
    if (!continuation) customQueue.current = false;
    // artists of the same genre, set by playGenre just before this call; any other play has none
    const related = continuation ? relatedArtists.current : pendingRelated.current;
    relatedArtists.current = related;
    pendingRelated.current = [];
    // Mobile Safari can suspend Web Audio; use native HTMLAudioElement there.
    if (!touchAudio() && audio.current) wire(audio.current);
    if (!touchAudio()) void audioContext.current?.resume();
    unlock(el); // gesture-bound best effort; a retry control handles mobile restrictions
    setPlaying(false);
    setTime({ current: 0, duration: 30 });
    setSelection({ artist, title: title || "…", status: "loading" });
    void (async () => {
      try {
        // no song given: my most played one by this artist, from my own archive
        let song = title;
        if (!continuation && albumKey) {
          const album = albums.find((a) => a.key === albumKey);
          queue.current = (album?.details?.tracks ?? []).map((track) => ({ artist, title: track.title }));
          queueScope.current = { slug: null, albumKey };
        } else if (!continuation && (slug || !song)) {
          // The public top-1000 catalog is already loaded. Use it immediately
          // instead of waiting for artist metadata before the first sound.
          const loadedTracks = tracks.filter((track) => fold(track.artist) === fold(artist));
          const mine = slug || (loadedTracks.length ? null : await slugFor(artist));
          const tops = loadedTracks.length
            ? loadedTracks.map((track) => track.title)
            : mine ? (await loadArtist(mine))?.top_tracks.map((track) => track.title) ?? [] : [];
          if (current !== sequence.current) return;
          queue.current = tops.map((title) => ({ artist, title }));
          queueScope.current = { slug: mine, albumKey: null };
        } else if (!continuation && !(queueScope.current.albumKey && queue.current.some((track) => track.artist === artist && track.title === song))) {
          queue.current = tracks.map((track) => ({ artist: track.artist, title: track.title }));
          queueScope.current = { slug: null, albumKey: null };
        }
        // one in four artist plays goes to the artist's catalog instead of my archive: songs I may never have heard
        const discover = !song && !albumKey && !customQueue.current && Math.random() < 0.25;
        if (!song && !discover) {
          // any of the artist's 50 most played, skipping what sounded recently, so the same tap
          // doesn't always open with the same hit
          const pool = queue.current.filter((track) => track.artist === artist && track.title !== lastSong);
          const fresh = pool.filter((track) => !playedAcrossQueues.current.has(`${fold(track.artist)}\0${fold(track.title)}`));
          const from = fresh.length ? fresh : pool;
          const chosen = from[Math.floor(Math.random() * from.length)];
          song = chosen?.title ?? queue.current[0]?.title ?? "";
        }
        if (!continuation) playedInQueue.current.clear();
        if (song) lastSong = song;
        if (current !== sequence.current) return;
        // Search the chosen context first, then the artist's real genre, then the wider archive.
        previewPlan.current = {
          request: { artist, title: song || title },
          candidates: previewCandidates(artist, song, queue.current,
            tracks.map((track) => ({ artist: track.artist, title: track.title })),
            genres, related, Boolean(albumKey || customQueue.current)),
          cursor: 0,
          active: null,
        };
        failedUrls.current.clear();
        void advancePreview(current);
      } catch {
        if (current === sequence.current) {
          // Failed metadata lookups should not stop us trying the artist and genre catalog.
          previewPlan.current = {
            request: { artist, title },
            candidates: previewCandidates(artist, title, [],
              tracks.map((track) => ({ artist: track.artist, title: track.title })),
              genres, related),
            cursor: 0, active: null,
          };
          failedUrls.current.clear();
          void advancePreview(current);
        }
      }
    })();
  };

  useEffect(() => {
    const onArtist = (event: Event) => {
      const slug = (event as CustomEvent<string>).detail;
      const artist = artists.find((a) => a.slug === slug);
      if (artist && !(playing && selection?.artist === artist.name && !queueScope.current.albumKey)) play(artist.name, "", artist.slug);
    };
    const onAlbum = (event: Event) => {
      const album = albums.find((a) => a.key === (event as CustomEvent<string>).detail);
      if (album) play(album.artist, "", null, album.key);
    };
    window.addEventListener("fm:artist-navigation", onArtist);
    window.addEventListener("fm:album-navigation", onAlbum);
    return () => { window.removeEventListener("fm:artist-navigation", onArtist); window.removeEventListener("fm:album-navigation", onAlbum); };
  });

  const analyser = useRef<AnalyserNode | null>(null);
  const bars = useRef<HTMLDivElement>(null);
  const wire = (el: HTMLAudioElement) => {
    if (analyser.current || typeof AudioContext === "undefined") return;
    try {
      const ctx = new AudioContext();
      const node = ctx.createAnalyser();
      node.fftSize = 256;
      node.smoothingTimeConstant = 0.55;
      ctx.createMediaElementSource(el).connect(node);
      node.connect(ctx.destination);
      analyser.current = node;
      audioContext.current = ctx;
    } catch { /* no analyser: the bars just idle */ }
  };

  useEffect(() => {
    if (!playing || !selection) return;
    // Keep visual activity present for the full preview, not only the first loud moments.
    let hue = 0;
    for (const ch of selection.artist + selection.title) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
    const root = document.documentElement;
    root.style.setProperty("--tint-h", String(hue));

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const data = new Uint8Array(128);
    const bins = Array.from({ length: 12 }, (_, i) => Math.min(127, Math.round(2 * Math.pow(28, i / 11))));
    const shown = new Array(12).fill(0);
    let frame = 0;
    let last = 0;
    let energyAvg = 0;
    let bassAvg = 0;
    let beat = 0.18;
    let lastBeat = 0;
    let lastSignal = performance.now();

    const tick = (now: number) => {
      if (now - last >= 66) {
        last = now;
        if (reducedMotion.matches) {
          root.style.setProperty("--tint-a", "0.12");
          root.style.setProperty("--beat", "0");
        } else {
          const node = analyser.current;
          // Native mobile playback deliberately bypasses Web Audio to avoid
          // Safari silencing the media. Its visual pulse is illustrative,
          // never claimed to be synchronized to an analysed recording.
          const canAnalyse = node !== null && activeAudio.current === audio.current &&
            audioContext.current?.state === "running";
          let energy = 0;
          if (canAnalyse && node) {
            node.getByteFrequencyData(data);
            energy = data.subarray(1, 24).reduce((sum, value) => sum + value, 0) / (23 * 255);
            if (energy > 0.012) lastSignal = now;
          }
          const noSignal = !canAnalyse || now - lastSignal > 900;
          if (noSignal) {
            const visual = ambientBeat(now);
            root.style.setProperty("--tint-a", visual.tint.toFixed(3));
            root.style.setProperty("--beat", visual.beat.toFixed(3));
            // On desktop, visually idle analyzer bars are not a playback failure.
            if (bars.current) for (const child of bars.current.children)
              (child as HTMLElement).style.height = `${Math.round(10 + visual.beat * 60)}%`;
          } else {
            // Automatic per-song normalization: quiet passages no longer erase
            // the animation. Audio still controls the transient beats.
            energyAvg = energyAvg ? energyAvg * 0.97 + energy * 0.03 : energy;
            const energyRelative = Math.min(1, energy / Math.max(0.045, energyAvg * 1.4));
            const bass = data.subarray(1, 8).reduce((sum, value) => sum + value, 0) / (7 * 255);
            bassAvg = bassAvg ? bassAvg * 0.94 + bass * 0.06 : bass;
            const transient = (bass - bassAvg) / Math.max(bassAvg, 0.035);
            if (bass > 0.065 && transient > 0.16 && now - lastBeat > 220) {
              beat = 1;
              lastBeat = now;
            } else {
              beat = Math.max(0.18, beat - 0.075);
            }
            root.style.setProperty("--tint-a", Math.min(0.52, 0.16 + 0.13 * energyRelative + 0.17 * beat).toFixed(3));
            root.style.setProperty("--beat", beat.toFixed(3));

            const cells = bars.current?.children;
            if (cells) for (let i = 0; i < cells.length; i++) {
              const strength = Math.max(0, data[bins[i]] / 255);
              const target = Math.pow(strength, 0.9) * 100;
              shown[i] = target > shown[i] ? target : Math.max(target, shown[i] - 7);
              (cells[i] as HTMLElement).style.height = `${Math.max(8, Math.round(shown[i] / 12.5) * 12.5)}%`;
            }
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      root.style.setProperty("--tint-a", "0");
      root.style.setProperty("--beat", "0");
      if (bars.current) for (const cell of bars.current.children)
        (cell as HTMLElement).style.height = "6%";
    };
  }, [playing, selection]);

  const [volume, setVolume] = useState(0.8);
  useEffect(() => { if (audio.current) audio.current.volume = volume; if (plainAudio.current) plainAudio.current.volume = volume; }, [volume, selection?.url]);
  // what played before, to go back
  const history = useRef<{ artist: string; title: string; slug: string | null; albumKey: string | null }[]>([]);
  useEffect(() => {
    if (selection?.status !== "ready") return;
    const last = history.current[history.current.length - 1];
    if (!last || last.artist !== selection.artist || last.title !== selection.title) history.current.push({ artist: selection.artist, title: selection.title, ...queueScope.current });
  }, [selection]);
  const back = () => {
    if (history.current.length < 2) { const el = activeAudio.current; if (el) el.currentTime = 0; return; }
    history.current.pop();
    const prev = history.current.pop()!;
    play(prev.artist, prev.title, prev.slug, prev.albumKey);
  };

  const random = async () => {
    const pool = tracks.filter((track) => track.title !== selection?.title || track.artist !== selection?.artist);
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    if (chosen) { queueScope.current = { slug: null, albumKey: null }; play(chosen.artist, chosen.title); }
  };

  const next = async () => {
    const list = queue.current.length ? queue.current : tracks;
    if (!list.length) return;
    const index = list.findIndex((track) => track.artist === selection?.artist && track.title === selection?.title);
    let candidates = list.filter((track, i) => i !== index && !playedInQueue.current.has(`${track.artist}\0${track.title}`) &&
      (!customQueue.current || !playedAcrossQueues.current.has(`${fold(track.artist)}\0${fold(track.title)}`)));
    if (!candidates.length) {
      playedInQueue.current.clear();
      candidates = list.filter((track, i) => i !== index && (!customQueue.current || !playedAcrossQueues.current.has(`${fold(track.artist)}\0${fold(track.title)}`)));
      if (!candidates.length) candidates = list.filter((_, i) => i !== index);
    }
    const chosen = shuffled ? candidates[Math.floor(Math.random() * candidates.length)] ?? list[0] : list[(index + 1) % list.length];
    play(chosen.artist, chosen.title, queueScope.current.slug, queueScope.current.albumKey, true);
  };
  /** a genre: one of its artists, and if nothing of them is found, another artist of the same genre */
  const playGenre = (names: string[]) => {
    const pool = shuffle(names.filter(Boolean));
    if (!pool.length) return;
    pendingRelated.current = pool.slice(1);
    play(pool[0], "", null, null);
  };

  const playQueue = (tracks: { artist: string; title: string }[]) => {
    if (!tracks.length) return;
    let fresh = tracks.filter((track) => !playedAcrossQueues.current.has(`${fold(track.artist)}\0${fold(track.title)}`));
    if (!fresh.length) fresh = tracks.filter((track) => track.artist !== selection?.artist || track.title !== selection?.title);
    if (!fresh.length) fresh = tracks;
    const chosen = shuffled ? fresh[Math.floor(Math.random() * fresh.length)] : fresh[0];
    queue.current = tracks;
    queueScope.current = { slug: null, albumKey: null };
    playedInQueue.current.clear();
    customQueue.current = true;
    play(chosen.artist, chosen.title, null, null, true);
  };

  const mute = () => {
    sequence.current++;
    previewPlan.current = null;
    failedUrls.current.clear();
    audio.current?.pause();
    plainAudio.current?.pause();
    activeAudio.current = null;
    setSelection(null);
    setPlaying(false);
    setRequiresTap(false);
    setEnabled(false);
    setTime({ current: 0, duration: 30 });
  };

  const ready = selection?.status === "ready";
  const progress = time.duration ? Math.min(1, time.current / time.duration) : 0;
  const isSilence = (el: HTMLAudioElement) => el.src.endsWith(SILENCE);
  const display = selection ?? { artist: "e", title: translate("elegí un tema"), status: "idle" };
  const contextValue = useMemo<Context>(() => ({ play, playQueue, playGenre, selection, playing, enabled, random: () => void random(),
    albumKeyFor: (artist: string, title: string) => albums.find((a) => fold(a.artist) === fold(artist) && fold(a.title) === fold(title))?.key ?? null }),
    [selection, playing, enabled, volume, shuffled, tracks, albums, artists]);

  return <PreviewContext.Provider value={contextValue}>
    {children}
    {[audio, plainAudio].map((ref, i) => <audio key={i} ref={ref} preload="none" hidden loop={repeat} crossOrigin={i === 0 ? "anonymous" : undefined}
      onPlay={(e) => { if (e.currentTarget === activeAudio.current && !isSilence(e.currentTarget)) { setPlaying(true); setRequiresTap(false); } }}
      onPause={(e) => { if (e.currentTarget === activeAudio.current) setPlaying(false); }}
      onEnded={(e) => { if (e.currentTarget === activeAudio.current && !isSilence(e.currentTarget)) { setPlaying(false); if (autoNext) void next(); } }}
      onTimeUpdate={(e) => { if (e.currentTarget === activeAudio.current && !isSilence(e.currentTarget)) setTime({ current: e.currentTarget.currentTime, duration: e.currentTarget.duration || 30 }); }}
      onError={(e) => {
        const el = e.currentTarget;
        const active = previewPlan.current?.active;
        if (el !== activeAudio.current || !active || isSilence(el)) return;
        // A Deezer proxy failure might still play directly in the native element.
        if (el === plainAudio.current && active.provider === "deezer" && !el.dataset.directRetry) {
          el.dataset.directRetry = "true";
          el.src = active.url;
          void el.play().catch((error: unknown) => {
            if (error instanceof DOMException && error.name === "NotAllowedError") setRequiresTap(true);
            else failPreview(active.url);
          });
          return;
        }
        failPreview(active.url);
      }} />)}
    {enabled && createPortal(<aside className="winamp" aria-label={translate("reproductor de fragmentos")}>
      <div className="wa-titlebar"><span>winamp</span><button type="button" className="wa-x" aria-label={translate("cerrar reproductor")} title={translate("cerrar reproductor")} onClick={mute}>×</button></div>
      <div className="wa-main">
        <div className="wa-display">
          <div className="wa-left">
            <span className="wa-state">{display.status === "loading" ? "…" : playing ? "▶" : "❚❚"}</span>
            <span className="wa-time tabular">{display.status === "loading" ? "--:--" : clock(time.current)}</span>
            <div ref={bars} className="wa-viz" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} />)}</div>
          </div>
          <div className="wa-right">
            <div className="wa-marquee" title={`${display.artist} - ${display.title}`}>
              <span>{display.artist} - {display.title || "…"}{"  ✶  "}{display.artist} - {display.title || "…"}{"  ✶  "}</span>
            </div>
            <div className="wa-vol-row"><span>vol</span><input className="wa-volume" type="range" min={0} max={100} value={Math.round(volume * 100)} aria-label={translate("volumen")}
              style={{ ["--p" as string]: `${volume * 100}%` }} onChange={(e) => setVolume(Number(e.target.value) / 100)} /></div>
            <div className="wa-meta">
              {display.status === "idle" && translate("elegí una canción o tocá shuffle")}
              {selection?.status === "loading" && translate("buscando…")}
              {selection?.status === "unavailable" && <>{translate("no hay audio disponible ahora")} · <button type="button" onClick={() => play(selection.artist, selection.title)}>{translate("reintentar")}</button></>}
              {ready && requiresTap && translate("tocá ▶ para escuchar")}
              {ready && !requiresTap && selection?.note}
              {selection?.status === "error" && <>{translate("no hay audio disponible ahora")} · <button type="button" onClick={() => play(selection.artist, selection.title)}>{translate("reintentar")}</button></>}
            </div>
          </div>
        </div>
        <input className="wa-seek" type="range" min={0} max={1000} value={Math.round(progress * 1000)} aria-label={translate("posición del fragmento")}
          disabled={!ready} style={{ ["--p" as string]: `${progress * 100}%` }}
          onChange={(e) => { const el = activeAudio.current; if (el && el.duration) el.currentTime = (Number(e.target.value) / 1000) * el.duration; }} />
        <div className="wa-buttons">
          <button type="button" onClick={back} aria-label={translate("anterior")}>⏮</button>
          <button type="button" onClick={toggle} disabled={!ready} aria-label={playing ? translate("pausar") : translate("reproducir")}>{playing ? "❚❚" : "▶"}</button>
          <button type="button" onClick={() => void next()} aria-label={translate("siguiente tema")}>⏭</button>
          <button type="button" className="wa-mode" aria-label={translate("repetir fragmento")} aria-pressed={repeat} onClick={() => { setRepeat((v) => !v); setAutoNext(false); }} title={translate("repetir este fragmento")}>loop</button>
          <button type="button" className="wa-mode" aria-label={translate("reproducción automática")} aria-pressed={autoNext} onClick={() => { setAutoNext((v) => !v); setRepeat(false); }} title={translate("seguir con el siguiente tema del catálogo")}>auto</button>
          <button type="button" className="wa-shuffle wa-mode" aria-pressed={shuffled} onClick={() => setShuffled((v) => !v)}>shuffle</button>
        </div>
      </div>
    </aside>, document.body)}
  </PreviewContext.Provider>;
}

export function usePreview() {
  return useContext(PreviewContext);
}

export function PreviewButton({ artist, title, slug, albumKey }: { artist: string; title: string; slug?: string; albumKey?: string }) {
  const context = useContext(PreviewContext);
  if (!context) return null;
  const active = context.selection?.artist === artist && context.selection.title === title;
  const playing = active && context.playing;
  const loading = active && context.selection?.status === "loading";
  return <button type="button" className={`preview-button ${playing ? "on" : ""}`}
    aria-label={translate(`${playing ? translate("pausar") : translate("escuchar un fragmento de")} ${title}, de ${artist}`)}
    title={playing ? translate("pausar") : translate("escuchar")} onClick={() => context.play(artist, title, slug, albumKey)}>
    {loading ? "…" : playing ? "❚❚" : "▶"}
  </button>;
}

/** the song name itself is the play button */
export function PlayableTitle({ artist, title, className = "", slug, albumKey }: { artist: string; title: string; className?: string; slug?: string; albumKey?: string }) {
  const context = useContext(PreviewContext);
  if (!context) return <span className={className}>{title}</span>;
  const playing = context.selection?.artist === artist && context.selection.title === title && context.playing;
  return <button type="button" className={`playable ${playing ? "on" : ""} ${className}`} onClick={() => context.play(artist, title, slug, albumKey)}
    aria-label={translate(`escuchar ${title}, de ${artist}`)}>{title}</button>;
}

/** round play button for an artist (my most played songs) or one of my albums */
export function PlaySomething({ artist, album, label }: { artist: string; album?: string; label: string }) {
  const context = useContext(PreviewContext);
  if (!context) return null;
  const key = album ? context.albumKeyFor(artist, album) : null;
  const active = context.selection?.artist === artist && context.playing;
  return <button type="button" className={`preview-button ${active ? "on" : ""}`} aria-label={label} title={translate("escuchar")}
    onClick={() => context.play(artist, "", null, key)}>▶</button>;
}

/** small header button: plays something I listen to, at random */
export function RandomPlay() {
  const context = useContext(PreviewContext);
  if (!context) return null;
  return <button type="button" className="random-play" onClick={context.random} aria-label={translate("▶ algo al azar")}><span className="random-desktop">{translate("▶ algo al azar")}</span><span className="random-mobile" aria-hidden="true">{translate("▶ azar")}</span></button>;
}
