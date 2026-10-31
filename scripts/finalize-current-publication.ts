import { readFile } from "node:fs/promises";
import {
  finalizeCurrentPublicSnapshot,
  type CurrentPublicFinalizeOptions,
} from "../packages/publication/src/current-public-finalize.ts";
const args = process.argv.slice(2);
if (!args.includes("--execute"))
  console.log(JSON.stringify({ state: "PLAN_ONLY", publicationEffects: 0 }));
else {
  const i = args.indexOf("--input");
  if (i < 0 || !args[i + 1]) throw new Error("Required --input JSON");
  console.log(
    JSON.stringify(
      await finalizeCurrentPublicSnapshot(
        JSON.parse(
          await readFile(args[i + 1]!, "utf8"),
        ) as CurrentPublicFinalizeOptions,
      ),
    ),
  );
}
