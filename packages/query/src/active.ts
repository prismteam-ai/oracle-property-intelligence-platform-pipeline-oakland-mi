import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import {
  syntheticProperties,
  SNAPSHOT_ID,
} from "../../test-support/src/fixtures.ts";
import { SnapshotReader } from "./index.ts";
import { DuckSnapshot } from "./duckdb.ts";
import { RealSnapshot } from "./real.ts";
import { parseFullSourceConfigs } from "../../county/src/private-full-source.ts";
import { digest } from "../../identity/src/index.ts";
import { RunLedger } from "../../run-ledger/src/index.ts";
import { dryManifest } from "../../publication/src/index.ts";
import type { Property, SearchResponse } from "../../contracts/src/index.ts";
export interface ActiveSnapshot {
  snapshotId: string;
  mode: "real" | "synthetic";
  digest: string;
  count: number;
  addressCount?: number;
  search(input: unknown): Promise<SearchResponse>;
  detail(id: string, snapshotId: string): Promise<Property>;
  coverage: unknown[];
  runs: unknown[];
  manifest: unknown;
  close(): void;
}
export async function createActiveSnapshot(): Promise<ActiveSnapshot> {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const mode = process.env.PRISM_DATA_MODE ?? "real";
  if (mode === "real") {
    const protectedDerivativeFile = process.env.PRISM_OWNER_DERIVATIVES;
    const protectedEnrichmentFile = process.env.PRISM_PRIVATE_ENRICHMENT;
    const protectedPermitsFile = process.env.PRISM_PRIVATE_PERMITS;
    const protectedSourceIntakeFile = process.env.PRISM_PRIVATE_SOURCE_INTAKE;
    const protectedFullSources = parseFullSourceConfigs(
      JSON.parse(process.env.PRISM_PRIVATE_FULL_SOURCES || "[]"),
    );
    if (
      (protectedDerivativeFile ||
        protectedEnrichmentFile ||
        protectedPermitsFile ||
        protectedSourceIntakeFile ||
        protectedFullSources.length > 0) &&
      process.env.PRISM_REQUIRE_AUTH !== "1"
    )
      throw new Error(
        "Protected derivatives require explicit authenticated runtime mode",
      );
    return RealSnapshot.open(
      process.env.PRISM_SNAPSHOT_DIR ?? path.join(root, "data/public-safe"),
      {
        protectedDerivativeFile,
        protectedDerivativeSha256: process.env.PRISM_OWNER_DERIVATIVES_SHA256,
        protectedEnrichmentFile,
        protectedEnrichmentSha256: process.env.PRISM_PRIVATE_ENRICHMENT_SHA256,
        protectedPermitsFile,
        protectedPermitsSha256: process.env.PRISM_PRIVATE_PERMITS_SHA256,
        protectedSourceIntakeFile,
        protectedSourceIntakeSha256:
          process.env.PRISM_PRIVATE_SOURCE_INTAKE_SHA256,
        protectedFullSources,
      },
    );
  }
  if (mode !== "synthetic")
    throw new Error("Unknown data mode; no implicit synthetic fallback");
  const rows = syntheticProperties(),
    reader = new SnapshotReader(SNAPSHOT_ID, rows),
    duck = await DuckSnapshot.create(SNAPSHOT_ID, rows);
  let tick = 0;
  const runDir =
    process.env.PRISM_FIXTURE_RUN_DIR ??
    path.join(root, "data/synthetic-p2-runs");
  await mkdir(runDir, { recursive: true });
  const ledger = new RunLedger(runDir, () =>
    new Date(Date.UTC(2026, 9, 26, 14, tick++)).toISOString(),
  );
  await ledger.run("fixture-run-01", [
    ...rows.slice(0, -1).map((p) => ({
      nativeId: p.nativeId,
      content: { propertyId: p.id, age: p.roof.ageYears, sourceRevision: 1 },
    })),
    {
      nativeId: "SYN-RETIRED-TEST",
      content: { propertyId: "SYN-RETIRED", age: 9, sourceRevision: 1 },
    },
  ]);
  await ledger.run(
    "fixture-run-02",
    [
      ...rows.map((p, i) => ({
        nativeId: p.nativeId,
        content: {
          propertyId: p.id,
          age: p.roof.ageYears,
          sourceRevision: i === 44 ? 2 : 1,
        },
      })),
      { nativeId: "SYN-RETIRED-TEST", content: {}, tombstone: true },
    ],
    { transformVersion: "v1" },
  );
  return {
    snapshotId: SNAPSHOT_ID,
    mode: "synthetic",
    digest: digest(rows),
    count: rows.length,
    search: (input) => duck.search(input),
    detail: async (id, s) => reader.detail(id, s),
    coverage: [
      {
        source: "Synthetic product fixtures",
        scope: "48 labeled synthetic properties; no real rows mixed",
        state: "synthetic",
        count: rows.length,
        limitations: ["Fixture behavior is not real county evidence."],
      },
    ],
    runs: (await ledger.inspect()).runs,
    manifest: dryManifest(SNAPSHOT_ID, rows),
    close: () => duck.close(),
  };
}
