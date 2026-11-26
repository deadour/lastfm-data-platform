import { SpotifyIcon, YoutubeIcon } from "./Icons";
import { spotifyUrl, youtubeUrl } from "../utils/listen";

/** two quiet icons that open the song (or artist) in spotify or youtube */
export function ListenLinks({ artist, title }: { artist: string; title?: string }) {
  const what = title ? `${title}, de ${artist}` : artist;
  return (
    <span className="listen-links">
      <a href={spotifyUrl(artist, title)} target="_blank" rel="noreferrer" aria-label={`buscar ${what} en spotify`} title="spotify">
        <SpotifyIcon size={15} className="text-[#1db954]" title="" />
      </a>
      <a href={youtubeUrl(artist, title)} target="_blank" rel="noreferrer" aria-label={`buscar ${what} en youtube`} title="youtube">
        <YoutubeIcon size={15} className="text-[#e0473c]" title="" />
      </a>
    </span>
  );
}
