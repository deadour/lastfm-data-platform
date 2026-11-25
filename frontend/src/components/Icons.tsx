// small monochrome marks for where the listening comes from. they inherit
// currentColor, so they sit quietly next to text and inside the svg diagram.

interface Props {
  size?: number;
  className?: string;
  title?: string;
}

export function SpotifyIcon({ size = 16, className = "", title = "spotify" }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} role="img" aria-label={title}>
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.9" />
      <g fill="none" stroke="#0e0d0c" strokeLinecap="round">
        <path d="M6.2 9.2c3.9-1.2 8.3-.9 11.6 1" strokeWidth="1.9" />
        <path d="M7 12.6c3.2-.9 6.6-.6 9.3.9" strokeWidth="1.6" />
        <path d="M7.7 15.8c2.5-.6 5-.4 7.1.7" strokeWidth="1.3" />
      </g>
    </svg>
  );
}

export function YoutubeIcon({ size = 16, className = "", title = "youtube" }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} role="img" aria-label={title}>
      <rect x="1.5" y="5" width="21" height="14" rx="4" fill="currentColor" opacity="0.9" />
      <path d="M10 9l5 3-5 3z" fill="#0e0d0c" />
    </svg>
  );
}

export function LastfmIcon({ size = 16, className = "", title = "last.fm" }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} role="img" aria-label={title}>
      <rect x="1" y="1" width="22" height="22" rx="5" fill="#b9392f" />
      <text x="12" y="16.2" textAnchor="middle" fontSize="11.5" fontWeight="700" fontStyle="italic" fontFamily="Georgia, serif" fill="#fff">as</text>
    </svg>
  );
}

/** "spotify + youtube → last.fm" in one line */
export function Sources({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <SpotifyIcon size={14} className="text-[#1db954]" />
      <YoutubeIcon size={14} className="text-[#e0473c]" />
      <span aria-hidden className="text-muted">→</span>
      <LastfmIcon size={14} />
    </span>
  );
}
