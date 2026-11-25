import { useState, type CSSProperties } from "react";
import { hash, secureImage } from "../utils/format";

interface Props {
  seed: string;
  image?: string | null;
  label: string;
  className?: string;
  /** small thumbnail: no name overlay */
  compact?: boolean;
  style?: CSSProperties;
}

// real artwork when there is a url; otherwise a quiet gradient derived from the name.
export function Cover({ seed, image, label, className = "", compact = false, style }: Props) {
  const [failed, setFailed] = useState(false);
  const src = secureImage(image);
  const h = hash(seed);
  const hue = h % 360;
  const second = (hue + 25 + ((h >> 9) % 70)) % 360;
  const angle = (h >> 3) % 180;
  const background = `linear-gradient(${angle}deg, hsl(${hue} 30% 34%), hsl(${second} 26% 15%))`;

  return (
    <div className={`relative aspect-square overflow-hidden bg-neutral-900 ${className}`} style={style}>
      {src && !failed ? (
        <img
          src={src}
          alt={label}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
        />
      ) : (
        <div
          role="img"
          aria-label={label}
          className="h-full w-full transition-transform duration-700 ease-out group-hover:scale-[1.03]"
          style={{ background }}
        >
          {!compact && (
            <span className="absolute bottom-3 left-3 right-3 font-serif text-sm leading-tight text-white/55">{seed}</span>
          )}
        </div>
      )}
    </div>
  );
}
