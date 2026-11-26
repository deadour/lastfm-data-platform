/** Ordered, deduplicated preview fallback plan. Genre matches come from the user's real archive. */
export interface PreviewTrack { artist: string; title: string }
export interface PreviewCandidate extends PreviewTrack { reason: "requested" | "artist" | "queue" | "genre" | "library" }
export type GenreArtists = Record<string, { name: string }[]>;
const fold = (v: string) => v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();

export function previewCandidates(
  artist: string, title: string, queue: PreviewTrack[], library: PreviewTrack[],
  genres: GenreArtists = {}, related: string[] = [], queueFirst = false,
): PreviewCandidate[] {
  const result: PreviewCandidate[] = [];
  const seen = new Set<string>();
  const add = (who: string, what: string, reason: PreviewCandidate["reason"]) => {
    if (!who.trim()) return;
    const key = `${fold(who)}|\0|${fold(what)}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ artist: who, title: what, reason });
  };
  if (title) add(artist, title, "requested");
  const sameArtist = queue.filter((item) => fold(item.artist) === fold(artist));
  if (queueFirst) {
    for (const item of queue.slice(0, 48)) add(item.artist, item.title, "queue");
  } else {
    for (const item of sameArtist.slice(0, 28)) add(item.artist, item.title, "artist");
  }
  // Artist-only search can find a popular, playable recording outside the user's top tracks.
  add(artist, "", "artist");

  const matchingFamilies = Object.values(genres).filter((members) =>
    members.some((member) => fold(member.name) === fold(artist)));
  const relatedNames = new Set(related.map(fold));
  for (const members of matchingFamilies) for (const member of members) relatedNames.add(fold(member.name));
  const matchesGenre = (name: string) => relatedNames.has(fold(name)) && fold(name) !== fold(artist);
  const relatedMembers = [
    ...related.filter((name) => matchesGenre(name)),
    ...matchingFamilies.flatMap((members) => members.map((member) => member.name)).filter(matchesGenre),
  ];
  // Prefer real tracks from the same genre before asking providers for any artist song.
  for (const item of library.filter((track) => matchesGenre(track.artist)).slice(0, 24))
    add(item.artist, item.title, "genre");
  for (const name of relatedMembers.slice(0, 32)) add(name, "", "genre");

  // If the exact context is unavailable, keep searching the user's own listening archive.
  for (const item of library.slice(0, 48)) add(item.artist, item.title, "library");
  return result;
}
