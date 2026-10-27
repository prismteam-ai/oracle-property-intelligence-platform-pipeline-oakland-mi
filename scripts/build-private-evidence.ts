import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProtectedEnrichment } from "../packages/county/src/enrichment.ts";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [snapshotDirectory, inputFile, outputDirectory] = process.argv.slice(2);
if (!snapshotDirectory || !inputFile || !outputDirectory)
  throw new Error(
    "Expected public snapshot directory, protected input and protected output directory",
  );
const summary = await buildProtectedEnrichment({
  snapshotDirectory,
  inputFile,
  outputDirectory,
  protectedRoots: [
    root,
    path.resolve(root, "../roofing-crm"),
    path.resolve(snapshotDirectory, "../.."),
  ],
});
console.log(JSON.stringify(summary, null, 2));
