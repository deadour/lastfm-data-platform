import { t as translate } from "../i18n";
import { n } from "../utils/format";
import { spotifyUrl } from "../utils/listen";

export function PlayCount({ count, artist, title }: { count: number; artist: string; title?: string }) {
  return <span className="tabular play-count">{n(count)}<a className="e-listen" href={spotifyUrl(artist, title)}
    target="_blank" rel="noreferrer" title={translate(`buscar ${title ?? artist} en spotify`)}
    aria-label={translate(`buscar ${title ? `${title}, de ${artist}` : artist} en spotify`)}>e</a></span>;
}
