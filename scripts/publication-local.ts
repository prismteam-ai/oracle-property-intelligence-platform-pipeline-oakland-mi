import { rehearsePublication } from "../packages/publication/src/local.ts";
const directory = process.argv[2] ?? process.env.PRISM_SNAPSHOT_DIR;
if (!directory) throw new Error("Snapshot directory required");
const manifest = await rehearsePublication(directory);
console.log(JSON.stringify(manifest, null, 2));
