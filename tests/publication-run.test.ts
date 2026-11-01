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
import {
  PUBLIC_LEGACY_RUN_LIMITATIONS,
  PUBLIC_CURRENT_RUN_LIMITATIONS,
} from "../packages/publication/src/run-history.ts";
import { CONTRACT_VERSION } from "../packages/contracts/src/index.ts";
import { verifySnapshotDirectory } from "../packages/query/src/real.ts";
import {
  PUBLIC_PARCEL_FIELDS,
  PUBLIC_ADDRESS_FIELDS,
  sha256,
} from "../packages/county/src/model.ts";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "prism-public-run-"));
  const previousDirectory = await mkdtemp(
    path.join(os.tmpdir(), "prism-public-prior-"),
  );
  const snapshotId = "oakland-real-" + "a".repeat(20),
    digest = "b".repeat(64),
    priorSnapshotId = "oakland-real-" + "d".repeat(20),
    priorDigest = "e".repeat(64);
  const zero = { added: 0, changed: 0, deleted: 0, unchanged: 1 };
  const source =
    "https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/";
  const layer = (parcel: boolean, baseline: boolean) => ({
    source: source + (parcel ? "1" : "0"),
    count: 1,
    received: 1,
    complete: true,
    delta: baseline ? { added: 1, changed: 0, deleted: 0, unchanged: 0 } : zero,
  });
  const history = [1, 2, 3].map((n) => {
    const baseline = n === 1,
      latest = n === 3;
    const kind = baseline
      ? "full-baseline"
      : latest
        ? "full-public-field-incremental-reconciliation"
        : "complete-content-reconciliation";
    const startedAt = latest
      ? "2026-10-28T01:00:00Z"
      : `2026-10-27T0${n}:00:00Z`;
    const completedAt = latest
      ? "2026-10-28T01:10:00Z"
      : `2026-10-27T0${n}:10:00Z`;
    const deltas = baseline
      ? { added: 2, changed: 0, deleted: 0, unchanged: 0 }
      : { ...zero, unchanged: 2 };
    return {
      id: `run-0${n}`,
      at: completedAt,
      startedAt,
      completedAt,
      complete: true,
      kind,
      source: latest ? "official county GIS" : kind,
      state: "COMPLETE",
      sourceCount: 2,
      processed: 2,
      ...deltas,
      deltas,
      layers: latest
        ? {
            tax_parcel: layer(true, baseline),
            site_address: layer(false, baseline),
          }
        : { parcel: layer(true, baseline), address: layer(false, baseline) },
      snapshotId: latest ? snapshotId : priorSnapshotId,
      digest: latest ? digest : priorDigest,
      canonicalPropertyCount: 1,
      datasetReused: n === 2,
      ...(latest ? { priorDatasetSnapshotId: priorSnapshotId } : {}),
      limitations: latest
        ? [...PUBLIC_CURRENT_RUN_LIMITATIONS]
        : [...PUBLIC_LEGACY_RUN_LIMITATIONS],
    };
  });
  const files = [];
  for (const name of [...PUBLICATION_FILES, "runs.json"]) {
    const text = JSON.stringify(
      name === "dataset-manifest.json"
        ? {
            snapshotId,
            digest,
            contractVersion: CONTRACT_VERSION,
            transformVersion: "synthetic-byte-fixture",
            parcelProvenanceDigest: "1".repeat(64),
            addressProvenanceDigest: "1".repeat(64),
            termsDigest: "f".repeat(64),
            fieldClassificationDigest: "f".repeat(64),
            parcelContentDigest: "c".repeat(64),
            addressContentDigest: "c".repeat(64),
          }
        : name === "runs.json"
          ? history
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
  const priorFiles = [];
  for (const f of files) {
    let bytes = await readFile(path.join(directory, f.name));
    if (f.name === "runs.json")
      bytes = Buffer.from(JSON.stringify(history.slice(0, 2)));
    if (f.name === "dataset-manifest.json")
      bytes = Buffer.from(
        JSON.stringify({
          ...JSON.parse(bytes.toString()),
          snapshotId: priorSnapshotId,
          digest: priorDigest,
          parcelProvenanceDigest: "0".repeat(64),
          addressProvenanceDigest: "0".repeat(64),
        }),
      );
    await writeFile(path.join(previousDirectory, f.name), bytes);
    priorFiles.push({
      name: f.name,
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  await writeFile(
    path.join(previousDirectory, "artifact-manifest.json"),
    JSON.stringify({
      ...JSON.parse(
        await readFile(path.join(directory, "artifact-manifest.json"), "utf8"),
      ),
      snapshotId: priorSnapshotId,
      digest: priorDigest,
      files: priorFiles,
    }),
  );
  const legacy = await rehearsePublication(previousDirectory);
  const currentLegacy = await rehearsePublication(directory);
  const run = {
    version: "p4-public-run-manifest-v1",
    runId: "run-03",
    startedAt: "2026-10-28T01:00:00Z",
    completedAt: "2026-10-28T01:10:00Z",
    contractVersion: CONTRACT_VERSION,
    datasetSnapshotId: snapshotId,
    datasetDigest: digest,
    priorDatasetSnapshotId: priorSnapshotId,
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
  return { directory, previousDirectory, legacy, currentLegacy, files, run };
}
test("a verified zero-fact-delta run has a distinct reproducible history root and retains the legacy root", async () => {
  const { directory, previousDirectory, legacy, currentLegacy, files } =
    await fixture();
  const first = await rehearsePublication(directory, {
    profile: "run-history-v2",
    previousPublicationDirectory: previousDirectory,
  });
  const car = await readFile(path.join(directory, "snapshot.car"));
  const second = await rehearsePublication(directory, {
    profile: "run-history-v2",
    previousPublicationDirectory: previousDirectory,
  });
  expect(first.rootCid).not.toBe(legacy.rootCid);
  expect(first.rootCid).not.toBe(currentLegacy.rootCid);
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
  const { directory, previousDirectory, run } = await fixture();
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
    rehearsePublication(directory, {
      profile: "run-history-v2",
      previousPublicationDirectory: previousDirectory,
    }),
  ).rejects.toThrow();
});
test("a schema-valid run cannot relabel the verified source content", async () => {
  const { directory, previousDirectory, run } = await fixture();
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
    rehearsePublication(directory, {
      profile: "run-history-v2",
      previousPublicationDirectory: previousDirectory,
    }),
  ).rejects.toThrow("verified data/history identity");
});
async function rehashHistory(
  directory: string,
  run: Record<string, unknown>,
  history: unknown,
) {
  const bytes = Buffer.from(JSON.stringify(history));
  await writeFile(path.join(directory, "runs.json"), bytes);
  const file = path.join(directory, "artifact-manifest.json");
  const manifest = JSON.parse(await readFile(file, "utf8")) as {
    files: { name: string; bytes: number; sha256: string }[];
  };
  manifest.files = manifest.files.map((f) =>
    f.name === "runs.json"
      ? { name: f.name, bytes: bytes.length, sha256: sha256(bytes) }
      : f,
  );
  await writeFile(file, JSON.stringify(manifest));
  await writeFile(
    path.join(directory, "run-manifest.json"),
    JSON.stringify({ ...run, runsSha256: sha256(bytes) }),
  );
}
const privateHistoryMutations: [
  string,
  (history: Record<string, unknown>[]) => void,
][] = [
  [
    "legacy extra",
    (h) => {
      h[0]!.ownerName = "SYNTHETIC_PRIVATE_CANARY";
    },
  ],
  [
    "legacy nested",
    (h) => {
      const layers = h[1]!.layers as Record<string, Record<string, unknown>>;
      layers.parcel!.privateReceipt = { rawBody: "SYNTHETIC_PRIVATE_CANARY" };
    },
  ],
  [
    "current extra",
    (h) => {
      h[2]!.privateSource = "SYNTHETIC_PRIVATE_CANARY";
    },
  ],
  [
    "current nested",
    (h) => {
      const layers = h[2]!.layers as Record<string, Record<string, unknown>>;
      layers.site_address!.privateMetadata = "SYNTHETIC_PRIVATE_CANARY";
    },
  ],
  [
    "allowed limitation field",
    (h) => {
      h[0]!.limitations = [
        "SYNTHETIC_PRIVATE_CANARY",
        PUBLIC_LEGACY_RUN_LIMITATIONS[1],
      ];
    },
  ],
  [
    "allowed source field",
    (h) => {
      h[2]!.source = "SYNTHETIC_PRIVATE_CANARY";
    },
  ],
  [
    "extra history row",
    (h) => {
      h.push({ ownerName: "SYNTHETIC_PRIVATE_CANARY" });
    },
  ],
];
test.each(privateHistoryMutations)(
  "whole history rejects rehashed private canary in %s",
  async (_name, mutate) => {
    const { directory, previousDirectory, run } = await fixture();
    const history = JSON.parse(
      await readFile(path.join(directory, "runs.json"), "utf8"),
    ) as Record<string, unknown>[];
    mutate(history);
    await rehashHistory(directory, run, history);
    await expect(verifySnapshotDirectory(directory)).resolves.toHaveProperty(
      "manifest",
    );
    await expect(
      rehearsePublication(directory, {
        profile: "run-history-v2",
        previousPublicationDirectory: previousDirectory,
      }),
    ).rejects.toThrow();
  },
);
test("verified prior bytes bind lineage and schema/provenance claims", async () => {
  const { directory, previousDirectory, run, currentLegacy } = await fixture();
  for (const altered of [
    { ...run, priorRootCid: String(currentLegacy.rootCid) },
    { ...run, priorDatasetSnapshotId: "oakland-real-" + "f".repeat(20) },
    { ...run, schemaOrProvenanceChanged: false },
  ]) {
    expect(() => PublicRunManifestSchema.parse(altered)).not.toThrow();
    await writeFile(
      path.join(directory, "run-manifest.json"),
      JSON.stringify(altered),
    );
    await expect(
      rehearsePublication(directory, {
        profile: "run-history-v2",
        previousPublicationDirectory: previousDirectory,
      }),
    ).rejects.toThrow("verified data/history identity");
  }
  await writeFile(
    path.join(directory, "run-manifest.json"),
    JSON.stringify(run),
  );
  await expect(
    rehearsePublication(directory, { profile: "run-history-v2" }),
  ).rejects.toThrow("previous publication directory required");
  const history = JSON.parse(
    await readFile(path.join(directory, "runs.json"), "utf8"),
  ) as Record<string, unknown>[];
  history[0]!.startedAt = "2026-10-26T01:00:00Z";
  history[0]!.completedAt = "2026-10-26T01:10:00Z";
  history[0]!.at = history[0]!.completedAt;
  await rehashHistory(directory, run, history);
  await expect(
    rehearsePublication(directory, {
      profile: "run-history-v2",
      previousPublicationDirectory: previousDirectory,
    }),
  ).rejects.toThrow("verified data/history identity");
});
