// classic windows 95 icons (provided as png), drawn crisp at small sizes
const files = {
  cd: "cd-music", recycle: "recycle", drive: "cd-drive", find: "find", speaker: "speaker",
  person: "person", briefcase: "briefcase", folder: "folder-open", calendar: "calendar",
} as const;

export type RetroKind = keyof typeof files | "disc";

export function RetroIcon({ kind = "folder", size = 30 }: { kind?: RetroKind; size?: number }) {
  const file = files[kind === "disc" ? "drive" : kind];
  return <img className="retro-icon" src={`/icons/win95/${file}.png`} width={size} height={size} alt="" aria-hidden="true" />;
}
