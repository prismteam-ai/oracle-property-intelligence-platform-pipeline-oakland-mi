import path from "node:path";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { DuckDBInstance } from "@duckdb/node-api";
import { applyProtectedPermitObservations } from "../packages/county/src/private-permits.ts";
import { sha256 } from "../packages/county/src/model.ts";
import { verifySnapshotDirectory } from "../packages/query/src/real.ts";

// This CLI consumes reviewed private observations; it never queries third parties.
const [
  publicDirectory,
  sourceFile,
  sourceSha256,
  overlayFile,
  outputDirectory,
] = process.argv.slice(2);
if (
  !publicDirectory ||
  !sourceFile ||
  !/^[a-f0-9]{64}$/.test(sourceSha256 ?? "") ||
  !overlayFile ||
  !outputDirectory ||
  process.argv.length !== 7
)
  throw new Error(
    "Usage: tsx scripts/overlay-private-permits.ts PUBLIC_DIRECTORY PRIVATE_PERMITS SHA256 PRIVATE_REVIEW_JSON NEW_PRIVATE_OUTPUT_DIRECTORY",
  );
for (const file of [publicDirectory, sourceFile, overlayFile, outputDirectory])
  if (!path.isAbsolute(file))
    throw new Error("Explicit absolute paths required");
const verified = await verifySnapshotDirectory(publicDirectory);
for (const file of [sourceFile, overlayFile]) {
  const meta = await lstat(file),
    resolved = await realpath(file);
  if (
    !meta.isFile() ||
    meta.isSymbolicLink() ||
    meta.nlink > 1 ||
    meta.size > 128 * 1024 ** 2 ||
    resolved.startsWith(verified.directory + path.sep)
  )
    throw new Error("Private input path/size rejected");
}
const source = await readFile(sourceFile),
  overlay = await readFile(overlayFile);
if (sha256(source) !== sourceSha256 || overlay.length > 2 * 1024 ** 2)
  throw new Error("Private input integrity/size rejected");
// New directory only: never overwrite an earlier attempt or place protected bytes in public artifacts.
const parent = await realpath(path.dirname(outputDirectory));
if (
  outputDirectory === verified.directory ||
  parent === verified.directory ||
  parent.startsWith(verified.directory + path.sep)
)
  throw new Error("Private output must be outside public snapshot");
await mkdir(outputDirectory, { mode: 0o700 });
const instance = await DuckDBInstance.create(":memory:", {
    threads: "1",
    memory_limit: "256MB",
  }),
  db = await instance.connect();
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
try {
  const count = await (
    await db.run(`SELECT count(*) AS n FROM read_parquet(${quote(sourceFile)})`)
  ).getRowObjectsJson();
  if (Number(count[0]!.n) > 750)
    throw new Error("Protected permit cohort bound rejected");
  const rows = await (
    await db.run(`SELECT * FROM read_parquet(${quote(sourceFile)})`)
  ).getRowObjectsJson();
  const updated = applyProtectedPermitObservations(
    rows,
    JSON.parse(overlay.toString("utf8")),
    verified.manifest.snapshotId,
  );
  await db.run(
    "CREATE TABLE staged(property_id VARCHAR,permit_json VARCHAR,public_snapshot_id VARCHAR,source_id VARCHAR,native_id VARCHAR,record_digest VARCHAR,observed_at VARCHAR)",
  );
  for (const r of updated)
    await db.run(
      "INSERT INTO staged VALUES($property,$permit,$snapshot,$source,$native,$digest,$observed)",
      {
        property: r.property_id,
        permit: r.permit_json,
        snapshot: r.public_snapshot_id,
        source: r.source_id,
        native: r.native_id,
        digest: r.record_digest,
        observed: r.observed_at,
      },
    );
  const parquet = path.join(outputDirectory, "protected-permits.parquet");
  await db.run(
    `COPY staged TO ${quote(parquet)} (FORMAT PARQUET,COMPRESSION ZSTD)`,
  );
  await chmod(parquet, 0o600);
  const bytes = await readFile(parquet),
    receipt = {
      version: "1",
      publicSnapshotId: verified.manifest.snapshotId,
      sourceSha256,
      reviewSha256: sha256(overlay),
      outputSha256: sha256(bytes),
      outputBytes: bytes.length,
      rows: updated.length,
      explicitStatuses: updated.filter((r) =>
        ["explicit_open", "explicit_closed"].includes(
          JSON.parse(r.permit_json).statusBasis,
        ),
      ).length,
      observedAt: new Date().toISOString(),
      rawRowsReturned: false,
    };
  await writeFile(
    path.join(outputDirectory, "overlay-receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  db.closeSync();
  instance.closeSync();
}
