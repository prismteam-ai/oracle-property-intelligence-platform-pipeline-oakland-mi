import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { sha256, stableJson } from "../packages/county/src/model.ts";
import {
  loadSourceObservations,
  PROVIDER_OBSERVATION_COLUMNS,
  TRANSFER_OBSERVATION_COLUMNS,
} from "../packages/query/src/real-source-observations.ts";
import { observation, deed, stamp } from "./p6-observations.fixture.ts";
import {
  EFFECTIVE_PERMIT_STATUS_SQL,
  SOURCE_OBSERVATION_FILTER_SQL,
  RECORDED_DEED_FILTER_SQL,
} from "../packages/query/src/source-predicates.ts";
async function fixture(
  providerChanges: Record<string, unknown> = {},
  duplicate = false,
) {
  const root = await mkdtemp(
    path.join(tmpdir(), "prism-source-observation-test-"),
  );
  const instance = await DuckDBInstance.create(":memory:");
  const db = await instance.connect();
  await db.run("CREATE TABLE properties(id VARCHAR)");
  await db.run("INSERT INTO properties VALUES('synthetic-property')");
  await db.run(
    "CREATE TABLE permits(property_id VARCHAR,id VARCHAR,status VARCHAR,kind VARCHAR,opened_at VARCHAR,closed_at VARCHAR,open_days INTEGER,reported_contractor VARCHAR,verified_company_id VARCHAR,license VARCHAR,rating DOUBLE,source_id VARCHAR,native_id VARCHAR,receipt_digest VARCHAR,observed_at VARCHAR,canonical_json VARCHAR)",
  );
  const provider = {
    ...observation(),
    reportedBusinessName: "SYNTHETIC PROTECTED SOURCE CANARY",
  };
  const providerJson = stableJson(provider),
    deedJson = stableJson(deed);
  const entries = [
    {
      name: "provider",
      columns: PROVIDER_OBSERVATION_COLUMNS,
      row: {
        version: "1",
        public_snapshot_id: "synthetic-snapshot",
        property_id: "synthetic-property",
        existing_permit_id: null,
        observation_json: providerJson,
        observation_digest: sha256(providerJson),
        observed_at: stamp,
        ...providerChanges,
      },
    },
    {
      name: "transfer",
      columns: TRANSFER_OBSERVATION_COLUMNS,
      row: {
        version: "1",
        public_snapshot_id: "synthetic-snapshot",
        property_id: "synthetic-property",
        observation_json: deedJson,
        observation_digest: sha256(deedJson),
        observed_at: stamp,
      },
    },
  ];
  for (const entry of entries) {
    await db.run(
      `CREATE TABLE ${entry.name}(${entry.columns.map((c) => c + " VARCHAR").join(",")})`,
    );
    const row = entry.row as Record<string, unknown>;
    await db.run(
      `INSERT INTO ${entry.name} VALUES(${entry.columns.map((_, i) => "$" + (i + 1)).join(",")})`,
      entry.columns.map((c) => row[c] as string | null),
    );
    if (duplicate && entry.name === "provider")
      await db.run("INSERT INTO provider SELECT * FROM provider");
    await db.run(
      `COPY ${entry.name} TO '${path.join(root, entry.name + ".parquet")}' (FORMAT PARQUET)`,
    );
  }
  const options = {
    protectedProviderObservationsFile: path.join(root, "provider.parquet"),
    protectedProviderObservationsSha256: sha256(
      await readFile(path.join(root, "provider.parquet")),
    ),
    protectedTransferObservationsFile: path.join(root, "transfer.parquet"),
    protectedTransferObservationsSha256: sha256(
      await readFile(path.join(root, "transfer.parquet")),
    ),
  };
  const run = (empty = false) =>
    loadSourceObservations({
      db,
      options: empty ? {} : options,
      publicSnapshotId: "synthetic-snapshot",
      overlayDigests: [],
      checkPrivate: async (file, expected) => {
        if (sha256(await readFile(file)) !== expected)
          throw new Error("synthetic integrity rejected");
      },
    });
  return {
    db,
    run,
    close: async () => {
      db.closeSync();
      instance.closeSync();
      await rm(root, { recursive: true, force: true });
    },
  };
}
it("loads strict bound source candidates and qualified deed gaps without promoting issued status to open", async () => {
  const f = await fixture();
  try {
    expect(await f.run()).toMatchObject({
      providerObservations: 1,
      newSourceCandidates: 1,
      existingPermitAssociations: 0,
      currentlyReportedActive: 0,
      deedObservations: 1,
      tenYearDeedObservations: 1,
      deedObservedThrough: "2026-10-19",
    });
    const result = await (
      await f.db.run(
        `SELECT x.status,${EFFECTIVE_PERMIT_STATUS_SQL} AS effective FROM permits x`,
      )
    ).getRowObjectsJson();
    expect(result).toEqual([{ status: "unknown", effective: "unknown" }]);
    const rows = await (
      await f.db.run(
        `SELECT p.id FROM properties p WHERE true ${RECORDED_DEED_FILTER_SQL}`,
        { deedGap: 10 },
      )
    ).getRowObjectsJson();
    expect(rows).toHaveLength(1);
    const source = `SELECT x.id FROM permits x WHERE true ${SOURCE_OBSERVATION_FILTER_SQL}`;
    expect(
      await (
        await f.db.run(source, {
          sourceRequired: true,
          providerStatus: "ISSUED",
          activityClaim: null,
          issueAge: 3650,
          status: "any",
          days: 0,
        })
      ).getRowObjectsJson(),
    ).toHaveLength(1);
    expect(
      await (
        await f.db.run(source, {
          sourceRequired: true,
          providerStatus: "ISSUED",
          activityClaim: "provider_reported_active",
          issueAge: 3650,
          status: "any",
          days: 0,
        })
      ).getRowObjectsJson(),
    ).toHaveLength(0);
  } finally {
    await f.close();
  }
});
it("public opening without private options has no protected observations or canary values", async () => {
  const f = await fixture();
  try {
    expect(await f.run(true)).toMatchObject({
      providerObservations: 0,
      deedObservations: 0,
      runs: [],
    });
    const rows = await (
      await f.db.run("SELECT * FROM private_provider_observations")
    ).getRowObjectsJson();
    expect(JSON.stringify(rows)).not.toContain(
      "SYNTHETIC PROTECTED SOURCE CANARY",
    );
    expect(rows).toHaveLength(0);
  } finally {
    await f.close();
  }
});
it.each([
  { public_snapshot_id: "wrong" },
  { property_id: "wrong" },
  { observation_digest: "b".repeat(64) },
  { existing_permit_id: "nonexistent-municipal-permit" },
])(
  "rejects incorrect row binding, digest or invented existing permit association",
  async (change) => {
    const f = await fixture(change);
    try {
      await expect(f.run()).rejects.toThrow();
    } finally {
      await f.close();
    }
  },
);
it("rejects duplicate provider observations rather than increasing source count", async () => {
  const f = await fixture({}, true);
  try {
    await expect(f.run()).rejects.toThrow("integrity rejected");
  } finally {
    await f.close();
  }
});
