import { describe, expect, it } from "vitest";
import { spotifyUrl, youtubeUrl } from "./listen";

describe("listen links", () => {
  it("builds encoded search urls", () => {
    expect(spotifyUrl("los piojos", "verano del 92")).toBe("https://open.spotify.com/search/los%20piojos%20verano%20del%2092");
    expect(youtubeUrl("sumo", "mañana en el abasto")).toBe("https://www.youtube.com/results?search_query=sumo%20ma%C3%B1ana%20en%20el%20abasto");
  });
  it("works with just an artist", () => {
    expect(spotifyUrl("virus")).toBe("https://open.spotify.com/search/virus");
  });
});
