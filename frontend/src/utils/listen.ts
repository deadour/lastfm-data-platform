// search links, no api and no keys: they open spotify or youtube already
// searching for the song. good enough to press play, not an exact match.

const query = (artist: string, title?: string) => [artist, title].filter(Boolean).join(" ");

export const spotifyUrl = (artist: string, title?: string) =>
  `https://open.spotify.com/search/${encodeURIComponent(query(artist, title))}`;

export const youtubeUrl = (artist: string, title?: string) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(query(artist, title))}`;
