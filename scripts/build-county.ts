import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCountySnapshot } from "../packages/county/src/build.ts";
const args = process.argv.slice(2);
function arg(k: string) {
  const i = args.indexOf(k);
  if (i < 0 || !args[i + 1]) throw new Error("Required option: " + k);
  return args[i + 1]!;
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const m = await buildCountySnapshot({
  sourceManifest: arg("--source-manifest"),
  outputDir: arg("--out"),
  privateOutputDir: arg("--private-out"),
  protectedRoots: [root, path.resolve(root, "../roofing-crm")],
  previousSnapshotDir: args.includes("--previous")
    ? arg("--previous")
    : undefined,
});
console.log(
  JSON.stringify({
    snapshotId: m.snapshotId,
    mode: "real",
    properties: m.count,
    parcels: m.parcelCount,
    addresses: m.addressCount,
    digest: m.digest,
    rawSourceOrOwnerValuesPrinted: false,
  }),
);
