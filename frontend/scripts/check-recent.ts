// Runs on Node 22 using --experimental-strip-types. Blocks publication unless
// recent.json matches the React contract and explore.json has its basic shape.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecentFile } from "../src/data/recent.ts";
import { isExploreFile } from "../src/data/explore.ts";

const dir = process.argv[2];
try {
  const recent: unknown = JSON.parse(readFileSync(join(dir, "recent.json"), "utf8"));
  if (!isRecentFile(recent)) throw new Error("recent.json");
  const explore = JSON.parse(readFileSync(join(dir, "explore.json"), "utf8"));
  if (!isExploreFile(explore)) {
    throw new Error("explore.json");
  }
  const text = readFileSync(join(dir, "recent.json"), "utf8") + readFileSync(join(dir, "explore.json"), "utf8");
  if (/blob\.core\.windows|snapshot=|watermark|scrobble_id|"example"/.test(text)) throw new Error("private or placeholder field");
  console.log("Verified recent.json and explore.json");
} catch {
  console.error("Publication blocked: recent.json or explore.json is missing, malformed or carries private fields");
  process.exitCode = 1;
}
