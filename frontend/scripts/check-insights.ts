// Runs on Node 22 using --experimental-strip-types. Validates insights.json and
// every artists/<slug>.json in a data directory before it can be published.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isArtistPage, isInsightsFile } from "../src/data/insights.ts";

const dir = process.argv[2];
try {
  const insights: unknown = JSON.parse(readFileSync(join(dir, "insights.json"), "utf8"));
  if (!isInsightsFile(insights)) throw new Error("insights.json");
  const files = readdirSync(join(dir, "artists")).sort();
  const expected = insights.artists.map((a) => `${a.slug}.json`).sort();
  if (files.join() !== expected.join()) throw new Error("artist pages do not match the index");
  for (const file of files) {
    const page: unknown = JSON.parse(readFileSync(join(dir, "artists", file), "utf8"));
    if (!isArtistPage(page) || `${page.slug}.json` !== file) throw new Error(file);
  }
  const text = readFileSync(join(dir, "insights.json"), "utf8");
  if (/blob\.core\.windows|snapshot=|watermark|scrobble_id/.test(text)) throw new Error("private field");
  console.log(`Verified insights.json and ${files.length} artist pages`);
} catch {
  console.error("Publication blocked: insights.json or an artist page is missing, malformed or carries private fields");
  process.exitCode = 1;
}
