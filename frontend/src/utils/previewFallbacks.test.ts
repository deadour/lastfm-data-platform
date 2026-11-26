import { describe, expect, it } from "vitest";
import { previewCandidates } from "./previewFallbacks";

const library = [
  { artist: "Babasónicos", title: "Irresponsables" },
  { artist: "Pescado Rabioso", title: "Bajan" },
  { artist: "Daft Punk", title: "One More Time" },
];
const genres = {
  rock: [{ name: "Los Piojos" }, { name: "Babasónicos" }, { name: "Pescado Rabioso" }],
  electronic: [{ name: "Daft Punk" }],
};

describe("previewCandidates", () => {
  it("tries the requested song, same artist, then related rock before other genres", () => {
    const rows = previewCandidates("Los Piojos", "Ruleta", [{ artist: "Los Piojos", title: "Tan solo" }], library, genres);
    expect(rows[0]).toMatchObject({ artist: "Los Piojos", title: "Ruleta", reason: "requested" });
    expect(rows[1]).toMatchObject({ artist: "Los Piojos", title: "Tan solo", reason: "artist" });
    expect(rows.findIndex((r) => r.artist === "Babasónicos")).toBeLessThan(rows.findIndex((r) => r.artist === "Daft Punk"));
    expect(rows.some((r) => r.artist === "Los Piojos" && r.title === "")).toBe(true);
  });
  it("does not repeat duplicate titles or skip all music when genre data is absent", () => {
    const rows = previewCandidates("A", "hit", [{ artist: "A", title: "hit" }], library);
    expect(rows.filter((r) => r.artist === "A" && r.title === "hit")).toHaveLength(1);
    expect(rows.some((r) => r.artist === "Daft Punk")).toBe(true);
  });
  it("prioritizes the selected album or queue before genre fallbacks", () => {
    const rows = previewCandidates("Los Piojos", "Ruleta",
      [{ artist: "Los Piojos", title: "Ruleta" }, { artist: "Los Piojos", title: "Morella" }],
      library, genres, [], true);
    expect(rows[1]).toMatchObject({ title: "Morella", reason: "queue" });
  });
  it("uses the explicit genre selection even when the chosen artist is outside genre metadata", () => {
    const rows = previewCandidates("Indie A", "", [], library, {}, ["Indie B", "Indie C"]);
    expect(rows.some((r) => r.artist === "Indie B" && r.reason === "genre")).toBe(true);
  });
});
