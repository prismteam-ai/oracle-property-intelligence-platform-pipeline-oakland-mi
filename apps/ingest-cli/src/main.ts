import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { RunLedger } from "../../../packages/run-ledger/src/index.ts";
import { syntheticProperties } from "../../../packages/test-support/src/fixtures.ts";
import { preserveReceipt } from "../../../packages/receipts/src/index.ts";
import { dryManifest } from "../../../packages/publication/src/index.ts";
const output = path.resolve(process.argv[2] ?? "data/fixture-replay");
await mkdir(output, { recursive: true, mode: 0o700 });
let clockIndex = 0;
const ledger = new RunLedger(path.join(output, "journal"), () =>
  new Date(Date.UTC(2026, 9, 26, 12, clockIndex++)).toISOString(),
);
const rows = syntheticProperties();
const initial = [
  ...rows.slice(0, -1).map((p) => ({
    nativeId: p.nativeId,
    content: { propertyId: p.id, age: p.roof.ageYears, sourceRevision: 1 },
  })),
  {
    nativeId: "SYN-RETIRED-TEST",
    content: { propertyId: "SYN-RETIRED", age: 9, sourceRevision: 1 },
  },
];
const final = [
  ...rows.map((p, i) => ({
    nativeId: p.nativeId,
    content: {
      propertyId: p.id,
      age: p.roof.ageYears,
      sourceRevision: i === 44 ? 2 : 1,
    },
  })),
  { nativeId: "SYN-RETIRED-TEST", content: {}, tombstone: true },
];
const receipt = await preserveReceipt(
  path.join(output, "receipts"),
  "synthetic-fixture",
  JSON.stringify(initial),
  "2026-10-26T12:00:00.000Z",
);
const first = await ledger.run("fixture-run-01", initial),
  second = await ledger.run("fixture-run-02", final),
  repeat = await ledger.run("fixture-run-02", final);
const ready = await ledger.readyRecords();
const summary = {
  mode: "synthetic",
  networkUsed: false,
  runs: [first, second],
  duplicateReplayIdempotent: JSON.stringify(second) === JSON.stringify(repeat),
  readyCount: ready.length,
  receiptDigest: receipt.bodyDigest,
  publicationAuthorized: false,
};
await writeFile(
  path.join(output, "replay-summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
await writeFile(
  path.join(output, "dry-manifest.json"),
  JSON.stringify(dryManifest("demo-oakland-v1", rows), null, 2) + "\n",
);
console.log(JSON.stringify(summary, null, 2));
