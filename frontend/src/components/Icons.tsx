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

export function AzureIcon({ size = 16, className = "", title = "azure" }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} role="img" aria-label={title}>
      <path d="M9.3 3h5.4L8.4 21H2.6z" fill="#0a5bb5" />
      <path d="M15.2 7.6 21.4 21H7.2l9.1-2.6-4.6-5.2z" fill="#3ba1f0" />
    </svg>
  );
}

export function GithubActionsIcon({ size = 16, className = "", title = "github actions" }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} role="img" aria-label={title}>
      <circle cx="6" cy="6" r="3" fill="none" stroke="#e7e3dc" strokeWidth="1.8" />
      <circle cx="18" cy="18" r="3" fill="none" stroke="#e7e3dc" strokeWidth="1.8" />
      <path d="M6 9v4a4 4 0 0 0 4 4h5" fill="none" stroke="#e7e3dc" strokeWidth="1.8" />
      <path d="M16 4.5 21 7l-5 2.5z" fill="#2da44e" />
    </svg>
  );
}

export function CloudflareIcon({ size = 16, className = "", title = "cloudflare" }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} role="img" aria-label={title}>
      <path d="M17.6 16.5H5.2a3 3 0 0 1-.4-6 4.6 4.6 0 0 1 8.8-1.6 3.5 3.5 0 0 1 4.6 3.3h.1a2.2 2.2 0 0 1 0 4.3z" fill="#f38020" />
    </svg>
  );
}

export function MedalIcon({ size = 16, color, title }: { size?: number; color: string; title: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={title}>
      <path d="M8 2h3l1 5-3 1zM16 2h-3l-1 5 3 1z" fill={color} opacity=".55" />
      <circle cx="12" cy="15" r="6.5" fill={color} />
      <circle cx="12" cy="15" r="3.6" fill="none" stroke="#141210" strokeOpacity=".45" strokeWidth="1.2" />
    </svg>
  );
}
