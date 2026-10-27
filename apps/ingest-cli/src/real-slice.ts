import { RedactedSummarySchema } from "../../../packages/receipts/src/redacted-summary.ts";
import { fileURLToPath } from "node:url";
import { assertPrivateDestination } from "../../../packages/receipts/src/private-paths.ts";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import {
  transformOaklandFeature,
  type ArcGISFeature,
} from "../../../packages/adapters/src/oakland.ts";
import { digest } from "../../../packages/identity/src/index.ts";
import { preserveReceipt } from "../../../packages/receipts/src/index.ts";
import { RunLedger } from "../../../packages/run-ledger/src/index.ts";
import { DuckSnapshot } from "../../../packages/query/src/duckdb.ts";
const [input, output, evidence, capturedAt] = process.argv.slice(2);
if (!input || !output || !evidence)
  throw new Error(
    "Usage: real-slice.ts PRIVATE_SAMPLE PRIVATE_OUTPUT REDACTED_SUMMARY",
  );
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const projectRoot = path.dirname(path.dirname(repo));
const protectedRoots = [path.dirname(repo), path.join(projectRoot, "return")];
for (const target of [
  output,
  path.join(output, "receipts"),
  path.join(output, "ledger"),
  path.join(output, "canonical.json"),
  path.join(output, "analytic.json"),
  path.join(output, "sample.parquet"),
])
  await assertPrivateDestination(target, protectedRoots);
await mkdir(output, { recursive: true, mode: 0o700 });
const body = await readFile(input, "utf8");
const sample = JSON.parse(body) as {
  features: ArcGISFeature[];
  spatialReference?: { wkid?: number };
};
if (!sample.features?.length || sample.features.length > 500)
  throw new Error("Sample size outside P1 envelope");
if (sample.spatialReference?.wkid !== 4326)
  throw new Error("Real slice expects requested WGS84 spatial reference");
if (capturedAt && !/^\d{4}-\d{2}-\d{2}T/.test(capturedAt))
  throw new Error("Invalid captured-at timestamp");
const observedAt = capturedAt
    ? new Date(capturedAt).toISOString()
    : (await stat(input)).mtime.toISOString(),
  properties = sample.features.map((f) =>
    transformOaklandFeature(f, observedAt),
  );
const receipt = await preserveReceipt(
  path.join(output, "receipts"),
  "oakland-official-parcel",
  body,
  observedAt,
);
await writeFile(
  path.join(output, "canonical.json"),
  JSON.stringify(properties),
  { mode: 0o600 },
);
const ledger = new RunLedger(path.join(output, "ledger"), () => observedAt);
const run = await ledger.run(
  "real-minimized-01",
  properties.map((p) => ({ nativeId: p.nativeId, content: p })),
  { source: "oakland-official-parcel" },
);
const repeat = await ledger.run(
  "real-minimized-01",
  properties.map((p) => ({ nativeId: p.nativeId, content: p })),
  { source: "oakland-official-parcel" },
);
const ready = await ledger.readyRecords();
if (ready.length !== properties.length)
  throw new Error("Ready set does not reconcile to canonical set");
const rows = properties.map((p) => ({
  id: p.id,
  lat: p.coordinates?.lat ?? null,
  lng: p.coordinates?.lng ?? null,
  roof_age: p.roof.ageYears,
  kind: "real-minimized",
}));
const jsonPath = path.join(output, "analytic.json");
await writeFile(jsonPath, JSON.stringify(rows), { mode: 0o600 });
const db = await (
  await DuckDBInstance.create(":memory:", { threads: "2" })
).connect();
await db.run("CREATE TABLE sample AS SELECT * FROM read_json_auto($1)", [
  jsonPath,
]);
const parquetPath = path.join(output, "sample.parquet");
await db.run(
  "COPY sample TO '" + parquetPath.replaceAll("'", "''") + "' (FORMAT PARQUET)",
);
const countResult = await db.run(
  "SELECT count(*) AS count FROM read_parquet($1)",
  [parquetPath],
);
const count = Number((await countResult.getRowObjectsJson())[0]!.count);
db.closeSync();
const reader = await DuckSnapshot.create("private-real-sample-v1", properties);
const point = properties.find((p) => p.coordinates)?.coordinates;
if (!point)
  throw new Error("Sample has no valid geometry for local vertical slice");
const found = await reader.search({
  snapshotId: "private-real-sample-v1",
  ...point,
  radiusMeters: 32187,
  limit: 50,
});
reader.close();
const result = {
  mode: "real-minimized-private",
  source: "Oakland County Enterprise GIS / Tax Parcel Plus",
  sampleCount: properties.length,
  canonicalCount: properties.length,
  coordinateCount: properties.filter((p) => p.coordinates).length,
  parquetCount: count,
  runState: run.state,
  replayIdempotent: JSON.stringify(run) === JSON.stringify(repeat),
  rawBodyDigest: receipt.bodyDigest,
  canonicalDigest: digest(properties),
  parquetDigest: digest(await readFile(parquetPath)),
  radiusResultCount: found.total,
  knownRoofAges: properties.filter((p) => p.roof.ageYears !== null).length,
  permitCount: 0,
  ownerContactFieldsRequested: false,
  publicPublication: false,
  unknowns: [
    "Roof age",
    "Permit history",
    "Official contractor/license/rating",
    "Ownership history",
  ],
  evidenceLevels: [
    "protected raw sample",
    "canonical minimized transform",
    "idempotent ledger",
    "DuckDB Parquet round-trip",
    "bounded source-backed radius query",
  ],
  rawRowsIncluded: false,
};
await writeFile(
  evidence,
  JSON.stringify(RedactedSummarySchema.parse(result), null, 2) + "\n",
);
console.log(JSON.stringify(result));
