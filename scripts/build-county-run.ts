/** Build a private-receipt-backed run-03 and local CAR; never contacts a service. */
import assert from "node:assert/strict";
import { readFile, writeFile, lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { CONTRACT_VERSION } from "../packages/contracts/src/index.ts";
import {
  buildCountySnapshot,
  type ArtifactManifest,
} from "../packages/county/src/build.ts";
import {
  sha256,
  stableJson,
  type SourceLayer,
  PUBLIC_PARCEL_FIELDS,
  PUBLIC_ADDRESS_FIELDS,
} from "../packages/county/src/model.ts";
import {
  PUBLICATION_FILES,
  rehearsePublication,
  verifyLocalCar,
} from "../packages/publication/src/local.ts";
import { PublicRunManifestSchema } from "../packages/publication/src/run-manifest.ts";
const args = process.argv.slice(2);
function arg(name: string): string {
  const i = args.indexOf(name);
  assert(i >= 0 && args[i + 1], "Required option " + name);
  return path.resolve(args[i + 1]!);
}
const planFile = arg("--plan"),
  stateFile = arg("--request-state"),
  baseline = arg("--baseline"),
  output = arg("--out"),
  privateOut = arg("--private-out"),
  evidence = arg("--evidence");
type Delta = {
  added: number;
  changed: number;
  deleted: number;
  unchanged: number;
};
type PlanLayer = SourceLayer & {
  censusSha256: string;
  finalCensusSha256: string;
};
type Plan = {
  complete: boolean;
  startedAt: string;
  completedAt: string;
  requestCap: number;
  baselineArtifactManifestSha256: string;
  baselineDatasetDigest: string;
  baselineSnapshotId: string;
  priorRootCid: string;
  fieldClassificationDigest: string;
  termsDigest: string;
  layers: { tax_parcel: PlanLayer; site_address: PlanLayer };
  rights: Record<
    string,
    {
      sameAcceptedLicense: boolean;
      publicAccess: boolean;
      licenseInfoSha256: string;
    }
  >;
};
const plan = JSON.parse(await readFile(planFile, "utf8")) as Plan;
const requests = JSON.parse(await readFile(stateFile, "utf8")) as {
  cap: number;
  events: { sequence: number; state: string; status: number | null }[];
};
assert(plan.complete && plan.requestCap === 600 && requests.cap === 600);
assert(requests.events.length <= 600 && requests.events.length > 526);
assert(
  requests.events.every(
    (e, i) => e.sequence === i + 1 && e.state !== "reserved",
  ),
);
assert(
  Object.values(plan.rights).length === 2 &&
    Object.values(plan.rights).every(
      (r) => r.sameAcceptedLicense && r.publicAccess,
    ),
);
for (const [layer, expected] of [
  [plan.layers.tax_parcel, PUBLIC_PARCEL_FIELDS],
  [plan.layers.site_address, PUBLIC_ADDRESS_FIELDS],
] as const) {
  assert(layer.complete);
  assert.deepEqual(layer.fields, [...expected]);
  assert.deepEqual(layer.publicFields, [...expected]);
  assert.deepEqual(layer.privateFields, []);
}
try {
  await lstat(output);
  throw new Error("New immutable output directory required");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
await mkdir(evidence, { recursive: true });
await mkdir(privateOut, { recursive: true, mode: 0o700 });
const oldManifestBytes = await readFile(
  path.join(baseline, "artifact-manifest.json"),
);
assert.equal(sha256(oldManifestBytes), plan.baselineArtifactManifestSha256);
const prior = JSON.parse(oldManifestBytes.toString()) as ArtifactManifest;
assert.equal(prior.snapshotId, plan.baselineSnapshotId);
assert.equal(prior.digest, plan.baselineDatasetDigest);
assert.equal(prior.files.length, 9);
for (const file of prior.files) {
  assert(/^[a-z-]+\.(json|parquet)$/.test(file.name));
  const full = path.join(baseline, file.name),
    info = await lstat(full),
    bytes = await readFile(full);
  assert(info.isFile() && !info.isSymbolicLink() && info.nlink === 1);
  assert.equal(bytes.length, file.bytes);
  assert.equal(sha256(bytes), file.sha256);
}
const priorDataset = JSON.parse(
  await readFile(path.join(baseline, "dataset-manifest.json"), "utf8"),
) as Record<string, unknown>;
assert.equal(priorDataset.snapshotId, prior.snapshotId);
assert.equal(priorDataset.digest, prior.digest);
const priorPublication = JSON.parse(
  await readFile(path.join(baseline, "publication-manifest.json"), "utf8"),
) as { rootCid: string; car: { bytes: number; sha256: string } };
assert.equal(priorPublication.rootCid, plan.priorRootCid);
const oldCar = await readFile(path.join(baseline, "snapshot.car"));
assert.equal(oldCar.length, priorPublication.car.bytes);
assert.equal(sha256(oldCar), priorPublication.car.sha256);
const legacyCarProof = await verifyLocalCar(
  path.join(baseline, "snapshot.car"),
  plan.priorRootCid,
  prior.files.filter((f) =>
    (PUBLICATION_FILES as readonly string[]).includes(f.name),
  ),
);
const normalized = {
  version: "p4-source-public-full-reconciliation-v1",
  layers: { parcel: plan.layers.tax_parcel, address: plan.layers.site_address },
  termsDigest: plan.termsDigest,
  fieldClassificationDigest: plan.fieldClassificationDigest,
  runs: [],
};
const sourceFile = path.join(privateOut, "normalized-source-manifest.json");
await writeFile(sourceFile, JSON.stringify(normalized, null, 2) + "\n", {
  mode: 0o600,
});
const manifest = await buildCountySnapshot({
  sourceManifest: sourceFile,
  outputDir: output,
  privateOutputDir: privateOut,
  protectedRoots: [process.cwd()],
});
const dataset = JSON.parse(
  await readFile(path.join(output, "dataset-manifest.json"), "utf8"),
) as Record<string, unknown>;
const instance = await DuckDBInstance.create(":memory:", {
    threads: "1",
    memory_limit: "1GB",
  }),
  db = await instance.connect();
const q = (s: string) => "'" + s.replaceAll("'", "''") + "'";
let parcel: Delta,
  address: Delta,
  propertyIds: Delta,
  watermark: Record<string, unknown>;
const publicParquetSchemas: Record<string, string[]> = {};
try {
  const expectedColumns: Record<string, string[]> = {
    "parcels.parquet": [
      "id",
      "source_id",
      "native_id",
      "pin",
      "keypin",
      "revision_date",
      "jurisdiction_code",
      "jurisdiction_name",
      "class_code",
      "address",
      "city",
      "state",
      "postal_code",
      "content_hash",
      "observed_at",
    ],
    "site-addresses.parquet": [
      "id",
      "source_id",
      "native_id",
      "pin",
      "address",
      "city",
      "state",
      "postal_code",
      "lat",
      "lng",
      "content_hash",
      "observed_at",
    ],
    "parcel-address-links.parquet": [
      "property_id",
      "address_id",
      "match_basis",
    ],
    "permits.parquet": [
      "property_id",
      "id",
      "status",
      "kind",
      "opened_at",
      "closed_at",
      "open_days",
      "reported_contractor",
      "verified_company_id",
      "license",
      "rating",
      "source_id",
      "native_id",
      "receipt_digest",
      "observed_at",
    ],
  };
  for (const [file, expected] of Object.entries(expectedColumns)) {
    const schema = (
      await (
        await db.run(
          `DESCRIBE SELECT * FROM read_parquet(${q(path.join(output, file))})`,
        )
      ).getRowObjectsJson()
    ).map((r) => String(r.column_name));
    assert.deepEqual(schema, expected, "Unexpected public Parquet field");
    publicParquetSchemas[file] = schema;
  }
  assert.equal(
    (
      await (
        await db.run(
          `SELECT count(*)::INTEGER AS n FROM read_parquet(${q(path.join(output, "permits.parquet"))})`,
        )
      ).getRowObjectsJson()
    )[0]?.n,
    0,
    "No rights-unknown municipal/vendor rows in public CAR",
  );
  for (const [prefix, directory] of [
    ["old", baseline],
    ["new", output],
  ])
    for (const [table, file] of [
      ["parcels", "parcels.parquet"],
      ["addresses", "site-addresses.parquet"],
    ])
      await db.run(
        `CREATE VIEW ${prefix}_${table} AS SELECT * FROM read_parquet(${q(path.join(directory!, file!))})`,
      );
  async function delta(
    table: string,
    key: string,
    hash: string,
  ): Promise<Delta> {
    return (
      await (
        await db.run(
          `SELECT count(*) FILTER(WHERE o.${key} IS NULL)::INTEGER AS added,count(*) FILTER(WHERE n.${key} IS NULL)::INTEGER AS deleted,count(*) FILTER(WHERE o.${key} IS NOT NULL AND n.${key} IS NOT NULL AND o.${hash} IS DISTINCT FROM n.${hash})::INTEGER AS changed,count(*) FILTER(WHERE o.${key} IS NOT NULL AND n.${key} IS NOT NULL AND o.${hash} IS NOT DISTINCT FROM n.${hash})::INTEGER AS unchanged FROM old_${table} o FULL OUTER JOIN new_${table} n ON o.${key}=n.${key}`,
        )
      ).getRowObjectsJson()
    )[0] as Delta;
  }
  parcel = await delta("parcels", "native_id", "content_hash");
  address = await delta("addresses", "native_id", "content_hash");
  for (const prefix of ["old", "new"])
    await db.run(
      `CREATE VIEW ${prefix}_properties AS SELECT id,id AS content_hash FROM ${prefix}_parcels UNION ALL SELECT 'oakland-address-'||a.native_id AS id,'oakland-address-'||a.native_id AS content_hash FROM ${prefix}_addresses a WHERE NOT EXISTS(SELECT 1 FROM ${prefix}_parcels p WHERE p.pin IS NOT NULL AND p.pin=a.pin)`,
    );
  propertyIds = await delta("properties", "id", "content_hash");
  watermark = (
    await (
      await db.run(
        "SELECT min(revision_date) AS minRevisionDate,max(revision_date) AS maxRevisionDate,count(*) FILTER(WHERE revision_date IS NULL)::INTEGER AS revisionUnknown FROM new_parcels",
      )
    ).getRowObjectsJson()
  )[0]!;
} finally {
  db.closeSync();
  instance.closeSync();
}
const factDelta: Delta = {
  added: parcel.added + address.added,
  changed: parcel.changed + address.changed,
  deleted: parcel.deleted + address.deleted,
  unchanged: parcel.unchanged + address.unchanged,
};
const startedAt = new Date(plan.startedAt).toISOString(),
  completedAt = new Date(plan.completedAt).toISOString();
const oldRuns = JSON.parse(
  await readFile(path.join(baseline, "runs.json"), "utf8"),
) as Record<string, unknown>[];
assert.deepEqual(
  oldRuns.map((r) => r.id),
  ["run-01", "run-02"],
);
const current = {
  id: "run-03",
  at: completedAt,
  startedAt,
  completedAt,
  complete: true,
  kind: "full-public-field-incremental-reconciliation",
  source: "official county GIS",
  state: "COMPLETE",
  sourceCount: manifest.parcelCount + manifest.addressCount,
  processed: manifest.parcelCount + manifest.addressCount,
  ...factDelta,
  deltas: factDelta,
  layers: {
    tax_parcel: {
      source: plan.layers.tax_parcel.source,
      count: manifest.parcelCount,
      received: manifest.parcelCount,
      complete: true,
      delta: parcel,
    },
    site_address: {
      source: plan.layers.site_address.source,
      count: manifest.addressCount,
      received: manifest.addressCount,
      complete: true,
      delta: address,
    },
  },
  snapshotId: manifest.snapshotId,
  digest: manifest.digest,
  canonicalPropertyCount: manifest.count,
  datasetReused: false,
  priorDatasetSnapshotId: prior.snapshotId,
  limitations: [
    "Deltas count public source-layer records, not assessed properties.",
    "Source IDs were fenced before and after the complete public-field read; content is an observation window, not a transactional server snapshot.",
    "A new contract/provenance/history root is not evidence of changed county facts.",
    "Protected enrichment and vendor/municipal rows are excluded.",
  ],
};
await writeFile(
  path.join(output, "runs.json"),
  JSON.stringify([...oldRuns, current], null, 2) + "\n",
);
const runsBytes = await readFile(path.join(output, "runs.json"));
manifest.files = manifest.files.map((f) =>
  f.name === "runs.json"
    ? { name: f.name, bytes: runsBytes.length, sha256: sha256(runsBytes) }
    : f,
);
await writeFile(
  path.join(output, "artifact-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
const run = PublicRunManifestSchema.parse({
  version: "p4-public-run-manifest-v1",
  runId: "run-03",
  startedAt,
  completedAt,
  contractVersion: CONTRACT_VERSION,
  datasetSnapshotId: manifest.snapshotId,
  datasetDigest: manifest.digest,
  priorDatasetSnapshotId: prior.snapshotId,
  priorRootCid: plan.priorRootCid,
  datasetManifestSha256: manifest.files.find(
    (f) => f.name === "dataset-manifest.json",
  )!.sha256,
  runsSha256: sha256(runsBytes),
  factDelta,
  dataFactsChanged: factDelta.added + factDelta.changed + factDelta.deleted > 0,
  schemaOrProvenanceChanged: manifest.digest !== prior.digest,
  completePublicFieldReconciliation: true,
  sourceConsistency:
    "complete-oid-fenced-observation-window-not-transactional-server-snapshot",
  sourceLayers: [
    [
      "oakland-tax-parcel-plus",
      plan.layers.tax_parcel,
      parcel,
      dataset.parcelContentDigest,
    ],
    [
      "oakland-site-address",
      plan.layers.site_address,
      address,
      dataset.addressContentDigest,
    ],
  ].map(([id, raw, delta, contentDigest]) => {
    const l = raw as PlanLayer;
    return {
      id,
      url: l.source,
      count: l.count,
      complete: l.complete,
      publicFields: l.publicFields,
      contentDigest,
      schemaDigest: l.schemaDigest,
      initialCensusSha256: l.censusSha256,
      finalCensusSha256: l.finalCensusSha256,
      delta,
    };
  }),
  rightsBasis: "accepted-county-open-data-license-reconfirmed",
  currentLicenseInfoDigests: Object.values(plan.rights).map(
    (r) => r.licenseInfoSha256,
  ),
  acceptedTermsDigest: plan.termsDigest,
  publicFieldClassificationDigest: plan.fieldClassificationDigest,
  privacy: {
    ownerNamesExcluded: true,
    ownerPostalAndContactsExcluded: true,
    protectedEnrichmentExcluded: true,
    vendorRowsExcluded: true,
    sourceBodiesExcluded: true,
  },
  limits: { requestCap: 600, actualRequests: requests.events.length },
});
await writeFile(
  path.join(output, "run-manifest.json"),
  JSON.stringify(run, null, 2) + "\n",
);
const publication = await rehearsePublication(output, {
  profile: "run-history-v2",
});
const first = sha256(await readFile(path.join(output, "snapshot.car")));
const repeated = await rehearsePublication(output, {
  profile: "run-history-v2",
});
assert.equal(repeated.rootCid, publication.rootCid);
assert.equal(sha256(await readFile(path.join(output, "snapshot.car"))), first);
assert.notEqual(publication.rootCid, plan.priorRootCid);
const proof = {
  version: "p4-complete-public-reconciliation-proof-v1",
  startedAt,
  completedAt,
  priorSnapshotId: prior.snapshotId,
  snapshotId: manifest.snapshotId,
  priorRootCid: plan.priorRootCid,
  rootCid: publication.rootCid,
  priorContractVersion: prior.contractVersion,
  contractVersion: CONTRACT_VERSION,
  artifactManifestSha256: sha256(
    await readFile(path.join(output, "artifact-manifest.json")),
  ),
  publicRunManifestSha256: sha256(
    await readFile(path.join(output, "run-manifest.json")),
  ),
  datasetDigest: manifest.digest,
  sourcePlanSha256: sha256(await readFile(planFile)),
  privateRequestLedgerSha256: sha256(await readFile(stateFile)),
  factDelta,
  layerDeltas: { parcel, address },
  propertyIdDelta: propertyIds,
  publicFactsChanged: run.dataFactsChanged,
  schemaOrProvenanceChanged: run.schemaOrProvenanceChanged,
  identityFieldChanges: Object.fromEntries(
    [
      "transformVersion",
      "contractVersion",
      "fieldClassificationDigest",
      "termsDigest",
      "parcelContentDigest",
      "addressContentDigest",
      "parcelProvenanceDigest",
      "addressProvenanceDigest",
    ].map((key) => [
      key,
      {
        prior: priorDataset[key],
        current: dataset[key],
        changed: priorDataset[key] !== dataset[key],
      },
    ]),
  ),
  watermark,
  watermarkCaveat:
    "Parcel REVISIONDATE is not an all-field edit watermark; SiteAddress has no reliable revision field. Both layers received a complete public-field reconciliation.",
  counts: {
    properties: manifest.count,
    parcels: manifest.parcelCount,
    addresses: manifest.addressCount,
  },
  actualOfficialRequests: requests.events.length,
  requestCap: 600,
  legacyCarProof,
  deterministicRepeat: { rootCidUnchanged: true, carSha256Unchanged: true },
  priorHistoryRowsPreserved:
    stableJson(oldRuns) ===
    stableJson(
      (
        JSON.parse(
          await readFile(path.join(output, "runs.json"), "utf8"),
        ) as unknown[]
      ).slice(0, 2),
    ),
  publicFieldScan: {
    exactParquetSchemasVerified: true,
    schemas: publicParquetSchemas,
    publicPermitRows: 0,
    sourcePublicFieldAllowlistVerifiedByBuilder: true,
    publicRunManifestStrictSchemaVerified: true,
  },
  protectedRebindingRule:
    "Rebind only independently verified stable property IDs; never treat unchanged source-native IDs as refreshed protected observations. Generated unknown owner derivatives from this public-only build are NOT promoted.",
  localOnly: true,
  publication: { files: publication.files, car: publication.car },
};
await writeFile(
  path.join(evidence, "run3_reconciliation_and_car_proof.json"),
  JSON.stringify(proof, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    snapshotId: manifest.snapshotId,
    artifactManifestSha256: proof.artifactManifestSha256,
    rootCid: publication.rootCid,
    factDelta,
    propertyIdDelta: propertyIds,
    actualRequests: requests.events.length,
    localOnly: true,
  }),
);
