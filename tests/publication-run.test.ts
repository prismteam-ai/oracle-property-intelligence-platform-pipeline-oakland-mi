import { expect, test } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PUBLICATION_FILES,
  RUN_PUBLICATION_FILES,
  rehearsePublication,
  verifyLocalCar,
} from "../packages/publication/src/local.ts";
import { PublicRunManifestSchema } from "../packages/publication/src/run-manifest.ts";
import { CONTRACT_VERSION } from "../packages/contracts/src/index.ts";
import {
  PUBLIC_PARCEL_FIELDS,
  PUBLIC_ADDRESS_FIELDS,
  sha256,
} from "../packages/county/src/model.ts";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "prism-public-run-"));
  const snapshotId = "oakland-real-" + "a".repeat(20),
    digest = "b".repeat(64);
  const files = [];
  for (const name of [...PUBLICATION_FILES, "runs.json"]) {
    const text = JSON.stringify(
      name === "dataset-manifest.json"
        ? {
            snapshotId,
            digest,
            termsDigest: "f".repeat(64),
            fieldClassificationDigest: "f".repeat(64),
            parcelContentDigest: "c".repeat(64),
            addressContentDigest: "c".repeat(64),
          }
        : name === "runs.json"
          ? [
              { id: "run-01", complete: true },
              { id: "run-02", complete: true },
              {
                id: "run-03",
                complete: true,
                kind: "synthetic-byte-fixture",
                snapshotId,
                digest,
                startedAt: "2026-10-28T01:00:00Z",
                completedAt: "2026-10-28T01:10:00Z",
                deltas: { added: 0, changed: 0, deleted: 0, unchanged: 2 },
              },
            ]
          : {
              name,
              content: "Synthetic fixture, not actual county/Parquet records.",
            },
    );
    await writeFile(path.join(directory, name), text);
    files.push({ name, bytes: Buffer.byteLength(text), sha256: sha256(text) });
  }
  await writeFile(
    path.join(directory, "artifact-manifest.json"),
    JSON.stringify({
      version: "1",
      contractVersion: CONTRACT_VERSION,
      snapshotId,
      digest,
      count: 1,
      addressCount: 1,
      parcelCount: 1,
      files,
      limitations: ["Synthetic byte-level fixture only"],
    }),
  );
  const legacy = await rehearsePublication(directory);
  const zero = { added: 0, changed: 0, deleted: 0, unchanged: 1 };
  const run = {
    version: "p4-public-run-manifest-v1",
    runId: "run-03",
    startedAt: "2026-10-28T01:00:00Z",
    completedAt: "2026-10-28T01:10:00Z",
    contractVersion: CONTRACT_VERSION,
    datasetSnapshotId: snapshotId,
    datasetDigest: digest,
    priorDatasetSnapshotId: snapshotId,
    priorRootCid: String(legacy.rootCid),
    datasetManifestSha256: files.find(
      (f) => f.name === "dataset-manifest.json",
    )!.sha256,
    runsSha256: files.find((f) => f.name === "runs.json")!.sha256,
    factDelta: { ...zero, unchanged: 2 },
    dataFactsChanged: false,
    schemaOrProvenanceChanged: true,
    completePublicFieldReconciliation: true,
    sourceConsistency:
      "complete-oid-fenced-observation-window-not-transactional-server-snapshot",
    sourceLayers: [
      {
        id: "oakland-tax-parcel-plus",
        url: "https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/1",
        count: 1,
        complete: true,
        publicFields: [...PUBLIC_PARCEL_FIELDS],
        contentDigest: "c".repeat(64),
        schemaDigest: "d".repeat(64),
        initialCensusSha256: "e".repeat(64),
        finalCensusSha256: "e".repeat(64),
        delta: zero,
      },
      {
        id: "oakland-site-address",
        url: "https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/0",
        count: 1,
        complete: true,
        publicFields: [...PUBLIC_ADDRESS_FIELDS],
        contentDigest: "c".repeat(64),
        schemaDigest: "d".repeat(64),
        initialCensusSha256: "e".repeat(64),
        finalCensusSha256: "e".repeat(64),
        delta: zero,
      },
    ],
    rightsBasis: "accepted-county-open-data-license-reconfirmed",
    currentLicenseInfoDigests: ["f".repeat(64), "f".repeat(64)],
    acceptedTermsDigest: "f".repeat(64),
    publicFieldClassificationDigest: "f".repeat(64),
    privacy: {
      ownerNamesExcluded: true,
      ownerPostalAndContactsExcluded: true,
      protectedEnrichmentExcluded: true,
      vendorRowsExcluded: true,
      sourceBodiesExcluded: true,
    },
    limits: { requestCap: 600, actualRequests: 15 },
  };
  await writeFile(
    path.join(directory, "run-manifest.json"),
    JSON.stringify(run),
  );
  return { directory, legacy, files, run };
}
test("a verified zero-fact-delta run has a distinct reproducible history root and retains the legacy root", async () => {
  const { directory, legacy, files } = await fixture();
  const first = await rehearsePublication(directory, {
    profile: "run-history-v2",
  });
  const car = await readFile(path.join(directory, "snapshot.car"));
  const second = await rehearsePublication(directory, {
    profile: "run-history-v2",
  });
  expect(first.rootCid).not.toBe(legacy.rootCid);
  expect(second.rootCid).toBe(first.rootCid);
  expect(sha256(await readFile(path.join(directory, "snapshot.car")))).toBe(
    sha256(car),
  );
  expect(first.dataFactsChanged).toBe(false);
  expect(first.priorRootCid).toBe(legacy.rootCid);
  expect(first.files).toHaveLength(10);
  expect(
    (first.history as { runId: string; datasetRootCid: string }[]).find(
      (x) => x.runId === "run-01",
    )?.datasetRootCid,
  ).toBe(legacy.rootCid);
  const extra = await readFile(path.join(directory, "run-manifest.json"));
  const expected = [
    ...files,
    { name: "run-manifest.json", bytes: extra.length, sha256: sha256(extra) },
  ];
  expect(
    (
      await verifyLocalCar(
        path.join(directory, "snapshot.car"),
        String(first.rootCid),
        expected,
        "run-history-v2",
      )
    ).files,
  ).toBe(RUN_PUBLICATION_FILES.length);
  await expect(
    verifyLocalCar(
      path.join(directory, "snapshot.car"),
      String(first.rootCid),
      expected,
    ),
  ).rejects.toThrow("allowlist");
});
test("publication rejects a changed history, private fields and inconsistent claims", async () => {
  const { directory, run } = await fixture();
  for (const altered of [
    { ...run, ownerName: "SYNTHETIC_PRIVATE_CANARY" },
    { ...run, dataFactsChanged: true },
    { ...run, factDelta: { ...run.factDelta, unchanged: 3 } },
    {
      ...run,
      sourceLayers: [
        {
          ...run.sourceLayers[0],
          publicFields: [...PUBLIC_PARCEL_FIELDS, "POSTALADDRESS"],
        },
        run.sourceLayers[1],
      ],
    },
  ])
    expect(() => PublicRunManifestSchema.parse(altered)).toThrow();
  await writeFile(path.join(directory, "runs.json"), "[]");
  // Core manifest integrity fails before the changed history can become a public CAR.
  await expect(
    rehearsePublication(directory, { profile: "run-history-v2" }),
  ).rejects.toThrow();
});
test("a schema-valid run cannot relabel the verified source content", async () => {
  const { directory, run } = await fixture();
  const altered = {
    ...run,
    sourceLayers: [
      { ...run.sourceLayers[0], contentDigest: "0".repeat(64) },
      run.sourceLayers[1],
    ],
  };
  expect(() => PublicRunManifestSchema.parse(altered)).not.toThrow();
  await writeFile(
    path.join(directory, "run-manifest.json"),
    JSON.stringify(altered),
  );
  await expect(
    rehearsePublication(directory, { profile: "run-history-v2" }),
  ).rejects.toThrow("verified data/history identity");
});
