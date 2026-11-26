import { t as translate } from "../i18n";
import { SpotifyIcon, YoutubeIcon } from "./Icons";
import { spotifyUrl, youtubeUrl } from "../utils/listen";
import { PreviewButton } from "./PreviewPlayer";

/** two quiet icons that open the song (or artist) in spotify or youtube */
export function ListenLinks({ artist, title }: { artist: string; title?: string }) {
  const what = title ? `${title}, de ${artist}` : artist;
  return (
    <span className="listen-links">
      {title && <PreviewButton artist={artist} title={title} />}
      <a href={spotifyUrl(artist, title)} target="_blank" rel="noreferrer" aria-label={translate(`buscar ${what} en spotify`)} title="spotify">
        <SpotifyIcon size={15} className="text-[#1db954]" title="" />
      </a>
      <a href={youtubeUrl(artist, title)} target="_blank" rel="noreferrer" aria-label={translate(`buscar ${what} en youtube`)} title="youtube">
        <YoutubeIcon size={15} className="text-[#e0473c]" title="" />
      </a>
    </span>
  );
}
