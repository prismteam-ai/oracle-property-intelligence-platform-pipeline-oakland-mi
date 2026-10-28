/** Build any private-receipt-backed observed run and local CAR; never contacts a service. */
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
  rehearsePublication,
  verifiedPreviousPublication,
  publicRunManifest,
} from "../packages/publication/src/local.ts";
import { PublicRunManifestSchema } from "../packages/publication/src/run-manifest.ts";
import {
  PublicRunHistorySchema,
  PublicRunIdSchema,
  appendPublicRun,
  PUBLIC_CURRENT_RUN_LIMITATIONS,
  type PublicFailure,
} from "../packages/publication/src/run-history.ts";
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
  runId?: string;
  responseByteCap?: number;
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
  byteCap: number;
  responseBytesKnown: number;
  unknownFailureMaxBytes: number;
  events: {
    sequence: number;
    state: string;
    status: number | null;
    purpose: string;
    requestUrlSha256: string;
  }[];
};
assert(plan.complete && plan.requestCap === 600 && requests.cap === 600);
assert(
  requests.events.length <= requests.cap &&
    requests.events.length >=
      Object.values(plan.layers).reduce((n, l) => n + l.pages.length, 0),
);
assert(
  requests.responseBytesKnown + requests.unknownFailureMaxBytes <=
    requests.byteCap,
);
const idOption = args.indexOf("--run-id");
const runId = PublicRunIdSchema.parse(
  idOption >= 0 ? args[idOption + 1] : plan.runId,
);
const observationDigest = sha256(
  stableJson({
    runId,
    startedAt: plan.startedAt,
    completedAt: plan.completedAt,
    priorRootCid: plan.priorRootCid,
    baselineArtifactManifestSha256: plan.baselineArtifactManifestSha256,
    fieldClassificationDigest: plan.fieldClassificationDigest,
    termsDigest: plan.termsDigest,
    layers: Object.fromEntries(
      Object.entries(plan.layers).map(([key, l]) => [
        key,
        {
          source: l.source,
          oidField: l.oidField,
          count: l.count,
          fields: l.publicFields,
          schemaDigest: l.schemaDigest,
          censusSha256: l.censusSha256,
          finalCensusSha256: l.finalCensusSha256,
          pages: l.pages.map((p) => ({
            sha256: p.sha256,
            observedAt: p.observedAt,
            index: p.index,
            records: p.records,
          })),
        },
      ]),
    ),
  }),
);
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
let outputExists = false;
try {
  await lstat(output);
  outputExists = true;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (outputExists) {
  const existing = await verifiedPreviousPublication(output);
  const current = existing.runManifest;
  if (
    !current ||
    current.version !== "public-run-manifest-v2" ||
    current.runId !== runId ||
    current.observationDigest !== observationDigest ||
    current.contractVersion !== CONTRACT_VERSION ||
    current.priorRootCid !== plan.priorRootCid
  )
    throw new Error("Immutable output conflicts with observation/run identity");
  await publicRunManifest(output, existing.manifest, baseline);
  console.log(
    JSON.stringify({
      runId,
      snapshotId: existing.manifest.snapshotId,
      rootCid: existing.rootCid,
      idempotentReplay: true,
      outputBytesUntouched: true,
      localOnly: true,
    }),
  );
  process.exit(0);
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
const verifiedPrior = await verifiedPreviousPublication(baseline);
const priorCarProof = verifiedPrior.carProof;
const normalized = {
  version: "source-public-full-reconciliation-v2",
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
const tombstones: Record<string, { count: number; nativeIdsSha256: string }> =
  {};
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
  const deleted: Record<string, string[]> = {};
  for (const [key, table] of [
    ["tax_parcel", "parcels"],
    ["site_address", "addresses"],
  ] as const) {
    const rows = await (
      await db.run(
        `SELECT o.native_id FROM old_${table} o LEFT JOIN new_${table} n ON n.native_id=o.native_id WHERE n.native_id IS NULL ORDER BY o.native_id`,
      )
    ).getRowObjectsJson();
    const ids = rows.map((r) => String(r.native_id));
    deleted[key] = ids;
    tombstones[key] = {
      count: ids.length,
      nativeIdsSha256: sha256(ids.join("\n")),
    };
  }
  assert.equal(tombstones.tax_parcel!.count, parcel.deleted);
  assert.equal(tombstones.site_address!.count, address.deleted);
  await writeFile(
    path.join(privateOut, "source-tombstones.json"),
    JSON.stringify({ runId, layers: deleted }, null, 2) + "\n",
    { mode: 0o600 },
  );
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
const oldRuns = PublicRunHistorySchema.parse(
  JSON.parse(await readFile(path.join(baseline, "runs.json"), "utf8")),
);
assert(
  !oldRuns.some((r) => r.id === runId),
  "Immutable run ID already exists in predecessor",
);
const previousRun = oldRuns.at(-1)!;
const sourceObservations = (["tax_parcel", "site_address"] as const).map(
  (key) => ({
    sourceId:
      key === "tax_parcel" ? "oakland-tax-parcel-plus" : "oakland-site-address",
    schemaDigest: plan.layers[key].schemaDigest,
    watermark: {
      mode: "complete-native-id-census",
      priorCount: key === "tax_parcel" ? prior.parcelCount : prior.addressCount,
      observedCount: plan.layers[key].count,
      initialCensusSha256: plan.layers[key].censusSha256,
      finalCensusSha256: plan.layers[key].finalCensusSha256,
    },
    tombstones: tombstones[key],
  }),
);
const failures: PublicFailure[] = [];
for (const event of requests.events) {
  const kind =
    event.state === "transport_error"
      ? "transport-error"
      : event.status !== null && event.status >= 500
        ? "http-server-error"
        : null;
  if (!kind) continue;
  const sourceId = event.purpose.startsWith("tax_parcel ")
    ? "oakland-tax-parcel-plus"
    : event.purpose.startsWith("site_address ")
      ? "oakland-site-address"
      : null;
  let group = failures.find((f) => f.sourceId === sourceId && f.kind === kind);
  if (!group) {
    group = { sourceId, kind, attempts: 0, requestDigests: [] };
    failures.push(group);
  }
  group.attempts++;
  group.requestDigests.push(event.requestUrlSha256);
}
const current = {
  version: "public-run-v2",
  id: runId,
  previousRunId: previousRun.id,
  priorDatasetDigest: prior.digest,
  observationDigest,
  sourceObservations,
  failures,
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
  limitations: [...PUBLIC_CURRENT_RUN_LIMITATIONS],
};
await writeFile(
  path.join(output, "runs.json"),
  JSON.stringify(appendPublicRun(oldRuns, current), null, 2) + "\n",
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
  version: "public-run-manifest-v2",
  runId,
  classification: "public-safe-assessment-product-snapshot",
  previousRunId: previousRun.id,
  previousArtifactManifestSha256: verifiedPrior.artifactManifestSha256,
  previousHistorySha256: verifiedPrior.historySha256,
  previousRunManifestSha256: verifiedPrior.runManifestSha256,
  predecessors: verifiedPrior.catalog,
  observationDigest,
  sourceObservations,
  failures,
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
  schemaOrProvenanceChanged: [
    "transformVersion",
    "contractVersion",
    "fieldClassificationDigest",
    "termsDigest",
    "parcelProvenanceDigest",
    "addressProvenanceDigest",
  ].some((k) => dataset[k] !== priorDataset[k]),
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
  limits: {
    requestCap: requests.cap,
    actualRequests: requests.events.length,
    responseByteCap: requests.byteCap,
    responseBytesKnown: requests.responseBytesKnown,
    unknownFailureMaxBytes: requests.unknownFailureMaxBytes,
  },
});
await writeFile(
  path.join(output, "run-manifest.json"),
  JSON.stringify(run, null, 2) + "\n",
);
const publication = await rehearsePublication(output, {
  profile: "run-history-v3",
  previousPublicationDirectory: baseline,
});
const first = sha256(await readFile(path.join(output, "snapshot.car")));
const repeated = await rehearsePublication(output, {
  profile: "run-history-v3",
  previousPublicationDirectory: baseline,
});
assert.equal(repeated.rootCid, publication.rootCid);
assert.equal(sha256(await readFile(path.join(output, "snapshot.car"))), first);
assert.notEqual(publication.rootCid, plan.priorRootCid);
const proof = {
  version: "complete-public-reconciliation-proof-v2",
  runId,
  observationDigest,
  predecessors: verifiedPrior.catalog,
  sourceObservations,
  failures,
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
  priorCarProof,
  deterministicRepeat: { rootCidUnchanged: true, carSha256Unchanged: true },
  priorHistoryRowsPreserved:
    stableJson(oldRuns) ===
    stableJson(
      (
        JSON.parse(
          await readFile(path.join(output, "runs.json"), "utf8"),
        ) as unknown[]
      ).slice(0, -1),
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
  path.join(evidence, runId + "-reconciliation-and-car-proof.json"),
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
