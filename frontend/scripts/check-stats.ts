// Runs on Node 22 using --experimental-strip-types, with no build dependency.
import { readFileSync } from "node:fs";
import { isStatsFile } from "../src/data/contract.ts";

try {
  const document: unknown = JSON.parse(readFileSync(process.argv[2], "utf8"));
  if (!isStatsFile(document)) throw new Error("invalid public statistics");
  console.log("Verified public StatsFile v1 using the React contract");
} catch {
  console.error("Publication blocked: stats.json must contain valid public Gold statistics, without private fields or credential URLs");
  process.exitCode = 1;
}
