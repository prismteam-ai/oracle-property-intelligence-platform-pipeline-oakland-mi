import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import current from "../packages/hosted-runtime/src/current-public-evidence.json" with { type: "json" };

const directory = new URL("../apps/pipeline-web/public/", import.meta.url);
async function json(name: string) {
  return JSON.parse(await readFile(new URL(name, directory), "utf8"));
}

test("current publication proof covers every file through both public operators", async () => {
  const manifest = await json("assessment-current-publication-manifest.json");
  const proof = await json("assessment-current-gateway-proof.json");
  expect(manifest.state).toBe(
    "CURRENT_ROOT_PUBLISHED_TWO_OPERATOR_READBACK_PASS",
  );
  expect(current.rootCid).toBe(manifest.rootCid);
  expect(proof.rootCid).toBe(manifest.rootCid);
  expect(manifest.verification.independentOperatorRetrieval).toBe(
    manifest.state,
  );
  expect(manifest.verification.distinctOperatorFilePairs).toBe(58);
  expect(manifest.publicationEffects.paidPlanChanges).toBe(0);
  expect(manifest.frozenPrepublicationContext.state).toBe(
    "CANONICAL_FROZEN_AND_TWO_WRAPS_VERIFIED_NOT_YET_PUBLISHED",
  );
  const pairs = new Set<string>();
  for (const file of manifest.files) {
    expect(file.objectType).toBe("file");
    const rows = proof.readbackRows.filter(
      (row: { name: string }) => row.name === file.name,
    );
    expect(
      rows.map((row: { operator: string }) => row.operator).sort(),
    ).toEqual(["filebase", "pinata"]);
    for (const row of rows) {
      expect(row.state).toBe("PASS");
      expect(row.authenticated).toBe(false);
      expect(row.expectedFileCid).toBe(file.cid);
      expect(row.actualBytes).toBe(file.bytes);
      expect(row.actualSha256).toBe(file.sha256);
      const pair = row.operator + "/" + row.name;
      expect(pairs.has(pair)).toBe(false);
      pairs.add(pair);
    }
  }
  expect(pairs.size).toBe(manifest.files.length * 2);
  expect(manifest.rootArtifact.objectType).toBe("directory");
  expect(manifest.rootArtifact.publicReadbacks).toHaveLength(2);
  expect(
    manifest.rootArtifact.publicReadbacks.every(
      (row: { expectedBytesAndShaMatch: boolean }) =>
        row.expectedBytesAndShaMatch,
    ),
  ).toBe(true);
  expect(
    manifest.car.publicDownloadImportProof.importExportVerification,
  ).toEqual({
    roots: [manifest.rootCid],
    blocks: manifest.car.blocks,
    files: manifest.files.length,
    everyFileVerified: true,
  });
});

test("downloadable reconciliation preserves the exact IPFS artifact bytes", async () => {
  const manifest = await json("assessment-current-publication-manifest.json");
  const file = manifest.files.find(
    (row: { name: string }) => row.name === "reconciliation-report.json",
  );
  const bytes = await readFile(
    new URL("assessment-reconciliation-report.json", directory),
  );
  expect(bytes.byteLength).toBe(file.bytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
  const report = JSON.parse(bytes.toString());
  expect(report.counts.permits).toBe(
    current.permitReconciliation.publishedPermitObservations,
  );
  expect(report.sourceCategories.excludedProvider.includedRows).toBe(0);
});

test("portable result summary is bound to the actual public download and SQL proof", async () => {
  const proof = await json("assessment-portable-consumer-proof.json");
  expect(proof.status).toBe(
    "PASS_PUBLIC_GET_DOWNLOAD_AND_ORDINARY_READ_ONLY_QUERIES",
  );
  expect(proof.canonicalHashUnchanged).toBe(true);
  expect(proof.ordinaryConsumer.readOnly).toBe(true);
  expect(proof.ordinaryConsumer.oracleApiRequired).toBe(false);
  expect(proof.downloadedDatabaseBeforeQueries).toEqual(
    proof.downloadedDatabaseAfterQueries,
  );
  expect(current.consumer.databaseSha256).toBe(
    proof.ordinaryConsumer.database.sha256,
  );
  expect(current.consumer.databaseBytes).toBe(
    proof.ordinaryConsumer.database.bytes,
  );
  const keys = [
    "noviOfficialCityRoofs",
    "strictTroyOpen",
    "troyVerification",
    "troyRegionalOwners",
    "qualifiedTroyDeedGaps",
  ];
  expect(current.consumer.queryResults.map((row) => row.count)).toEqual(
    keys.map((key) =>
      Number(proof.ordinaryConsumer.results[key].rows[0].matches),
    ),
  );
});
