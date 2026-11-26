/** A small original desktop folder mark on a 16 px grid. */
export function RetroIcon({ kind = "folder" }: { kind?: "folder" | "calendar" | "disc" }) {
  if (kind === "calendar") return <svg className="retro-icon" width="24" height="24" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
    <path d="M1 2h14v13H1z" fill="#111" /><path d="M2 3h12v11H2z" fill="#f0f0e8" /><path d="M2 3h12v3H2z" fill="#164c93" />
    <path d="M4 1h1v3H4zM11 1h1v3h-1z" fill="#c0c0c0" /><path d="M4 8h2v2H4zM8 8h2v2H8zM4 11h2v2H4zM8 11h2v2H8z" fill="#666" />
  </svg>;
  if (kind === "disc") return <svg className="retro-icon" width="24" height="24" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
    <path d="M5 1h6v1h2v2h1v2h1v5h-1v2h-2v1h-2v1H5v-1H3v-2H2v-2H1V6h1V4h1V2h2z" fill="#111" />
    <path d="M5 2h6v1h2v3h1v4h-1v3h-3v1H6v-1H3v-3H2V6h1V3h2z" fill="#c0c0c0" />
    <path d="M4 4h2v2H4zM10 10h2v2h-2z" fill="#f0f0f0" /><path d="M9 3h2v2H9zM3 9h2v2H3z" fill="#80c8c8" />
    <path d="M6 6h4v4H6z" fill="#666" /><path d="M7 7h2v2H7z" fill="#111" />
  </svg>;
  return <svg className="retro-icon" width="24" height="24" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
    <path d="M1 3h5l2 2h7v9H1z" fill="#111" />
    <path d="M2 4h4l2 2h6v7H2z" fill="#ffff80" />
    <path d="M2 7h12v6H2z" fill="#e5b84a" />
    <path d="M2 7h12v1H2zM2 8h1v5H2z" fill="#fff7c0" />
    <path d="M11 3h4v4h-4z" fill="#111" />
    <path d="M11 2h4v4h-4z" fill="#70c8c8" />
    <path d="M8 8h4v4H8z" fill="#111" />
    <path d="M7 7h4v4H7z" fill="#bda0d9" />
    <path d="M4 10h3v3H4z" fill="#111" />
    <path d="M3 9h3v3H3z" fill="#e07070" />
  </svg>;
}
