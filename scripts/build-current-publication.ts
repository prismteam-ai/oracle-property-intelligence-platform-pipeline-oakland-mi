import { readFile } from "node:fs/promises";
import {
  buildCurrentPublicSnapshot,
  type CurrentPublicBuildOptions,
} from "../packages/publication/src/current-public-snapshot.ts";
const args = process.argv.slice(2);
if (!args.includes("--execute"))
  console.log(
    JSON.stringify({ state: "PLAN_ONLY", serviceCalls: 0, uploads: 0 }),
  );
else {
  const index = args.indexOf("--input");
  if (index < 0 || !args[index + 1]) throw new Error("Required --input JSON");
  const input = JSON.parse(
    await readFile(args[index + 1]!, "utf8"),
  ) as CurrentPublicBuildOptions;
  console.log(JSON.stringify(await buildCurrentPublicSnapshot(input)));
}
