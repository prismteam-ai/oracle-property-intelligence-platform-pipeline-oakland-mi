import { z } from "zod";
import { CID } from "multiformats/cid";
import {
  PUBLIC_PARCEL_FIELDS,
  PUBLIC_ADDRESS_FIELDS,
} from "../../county/src/model.ts";
import {
  MAX_PUBLIC_HISTORY_RUNS,
  PublicRunIdSchema,
  PublicSourceObservationSchema,
  PublicFailureSchema,
} from "./run-history.ts";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const snapshot = z.string().regex(/^oakland-real-[a-f0-9]{20}$/);
const count = z.number().int().nonnegative().max(10000000);
const delta = z
  .object({ added: count, changed: count, deleted: count, unchanged: count })
  .strict();
const source = z
  .object({
    id: z.enum(["oakland-tax-parcel-plus", "oakland-site-address"]),
    url: z.string().url(),
    count,
    complete: z.literal(true),
    publicFields: z.array(z.string()),
    contentDigest: hash,
    schemaDigest: hash,
    initialCensusSha256: hash,
    finalCensusSha256: hash,
    delta,
  })
  .strict()
  .superRefine((x, ctx) => {
    const parcel = x.id === "oakland-tax-parcel-plus";
    const expected = parcel ? PUBLIC_PARCEL_FIELDS : PUBLIC_ADDRESS_FIELDS;
    const url =
      "https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/" +
      (parcel ? "1" : "0");
    if (
      x.url !== url ||
      x.publicFields.length !== expected.length ||
      new Set(x.publicFields).size !== expected.length ||
      x.publicFields.some((f) => !(expected as readonly string[]).includes(f))
    )
      ctx.addIssue({
        code: "custom",
        message: "Exact public source/field allowlist required",
      });
    if (x.delta.added + x.delta.changed + x.delta.unchanged !== x.count)
      ctx.addIssue({ code: "custom", message: "Source delta/count mismatch" });
  });
/** Frozen historical wire format only; new observations use the generic version below. */
const legacyShape = {
  version: z.literal("p4-public-run-manifest-v1"),
  runId: PublicRunIdSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  contractVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  datasetSnapshotId: snapshot,
  datasetDigest: hash,
  priorDatasetSnapshotId: snapshot,
  priorRootCid: z.string().refine((value) => {
    try {
      const cid = CID.parse(value);
      return (
        cid.version === 1 &&
        cid.code === 0x70 &&
        cid.multihash.code === 0x12 &&
        cid.multihash.digest.length === 32
      );
    } catch {
      return false;
    }
  }, "CIDv1 dag-pb prior root required"),
  datasetManifestSha256: hash,
  runsSha256: hash,
  factDelta: delta,
  dataFactsChanged: z.boolean(),
  schemaOrProvenanceChanged: z.boolean(),
  completePublicFieldReconciliation: z.literal(true),
  sourceConsistency: z.literal(
    "complete-oid-fenced-observation-window-not-transactional-server-snapshot",
  ),
  sourceLayers: z.array(source).length(2),
  rightsBasis: z.literal("accepted-county-open-data-license-reconfirmed"),
  currentLicenseInfoDigests: z.array(hash).length(2),
  acceptedTermsDigest: hash,
  publicFieldClassificationDigest: hash,
  privacy: z
    .object({
      ownerNamesExcluded: z.literal(true),
      ownerPostalAndContactsExcluded: z.literal(true),
      protectedEnrichmentExcluded: z.literal(true),
      vendorRowsExcluded: z.literal(true),
      sourceBodiesExcluded: z.literal(true),
    })
    .strict(),
  limits: z
    .object({
      requestCap: z.literal(600),
      actualRequests: z.number().int().min(1).max(600),
    })
    .strict(),
};
const legacyObject = z.object(legacyShape).strict();
type Aggregate = Pick<
  z.infer<typeof legacyObject>,
  | "startedAt"
  | "completedAt"
  | "sourceLayers"
  | "factDelta"
  | "dataFactsChanged"
>;
function refineAggregate(x: Aggregate, ctx: z.RefinementCtx) {
  if (Date.parse(x.completedAt) < Date.parse(x.startedAt))
    ctx.addIssue({
      code: "custom",
      message: "Run observation window invalid",
    });
  if (new Set(x.sourceLayers.map((s) => s.id)).size !== 2)
    ctx.addIssue({
      code: "custom",
      message: "Both distinct source layers required",
    });
  const sum = x.sourceLayers.reduce(
    (a, l) => ({
      added: a.added + l.delta.added,
      changed: a.changed + l.delta.changed,
      deleted: a.deleted + l.delta.deleted,
      unchanged: a.unchanged + l.delta.unchanged,
    }),
    { added: 0, changed: 0, deleted: 0, unchanged: 0 },
  );
  if (
    (Object.keys(sum) as (keyof typeof sum)[]).some(
      (k) => sum[k] !== x.factDelta[k],
    )
  )
    ctx.addIssue({ code: "custom", message: "Run/source deltas disagree" });
  if (
    x.dataFactsChanged !==
    x.factDelta.added + x.factDelta.changed + x.factDelta.deleted > 0
  )
    ctx.addIssue({
      code: "custom",
      message: "Fact change claim disagrees with measured deltas",
    });
}
export const HistoricalPublicRunManifestSchema =
  legacyObject.superRefine(refineAggregate);

const rootCid = legacyShape.priorRootCid;
export const PublicPredecessorSchema = z
  .object({
    runId: PublicRunIdSchema,
    snapshotId: snapshot,
    datasetDigest: hash,
    rootCid,
  })
  .strict();
export type PublicPredecessor = z.infer<typeof PublicPredecessorSchema>;
export const GenericPublicRunManifestSchema = z
  .object({
    ...legacyShape,
    version: z.literal("public-run-manifest-v2"),
    classification: z.literal("public-safe-assessment-product-snapshot"),
    previousRunId: PublicRunIdSchema,
    previousArtifactManifestSha256: hash,
    previousHistorySha256: hash,
    previousRunManifestSha256: hash.nullable(),
    predecessors: z
      .array(PublicPredecessorSchema)
      .min(1)
      .max(MAX_PUBLIC_HISTORY_RUNS),
    observationDigest: hash,
    sourceObservations: z.array(PublicSourceObservationSchema).length(2),
    failures: z.array(PublicFailureSchema).max(600),
    limits: z
      .object({
        requestCap: z.number().int().min(1).max(1000),
        actualRequests: z.number().int().min(1).max(1000),
        responseByteCap: z
          .number()
          .int()
          .min(1)
          .max(2 * 1024 ** 3),
        responseBytesKnown: z.number().int().nonnegative(),
        unknownFailureMaxBytes: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((x, ctx) => {
    refineAggregate(x, ctx);
    const last = x.predecessors.at(-1)!;
    if (
      last.runId !== x.previousRunId ||
      last.snapshotId !== x.priorDatasetSnapshotId ||
      last.rootCid !== x.priorRootCid ||
      new Set(x.predecessors.map((p) => p.runId)).size !==
        x.predecessors.length ||
      x.predecessors.some((p) => p.runId === x.runId)
    )
      ctx.addIssue({
        code: "custom",
        message: "Immutable predecessor catalog mismatch",
      });
    if (
      x.limits.actualRequests > x.limits.requestCap ||
      x.limits.responseBytesKnown + x.limits.unknownFailureMaxBytes >
        x.limits.responseByteCap
    )
      ctx.addIssue({
        code: "custom",
        message: "Observed request/byte budget exceeds envelope",
      });
    if (new Set(x.sourceObservations.map((s) => s.sourceId)).size !== 2)
      ctx.addIssue({
        code: "custom",
        message: "Distinct source observations required",
      });
    for (const observation of x.sourceObservations) {
      const layer = x.sourceLayers.find((l) => l.id === observation.sourceId);
      if (
        !layer ||
        observation.schemaDigest !== layer.schemaDigest ||
        observation.watermark.initialCensusSha256 !==
          layer.initialCensusSha256 ||
        observation.watermark.finalCensusSha256 !== layer.finalCensusSha256 ||
        observation.watermark.observedCount !== layer.count ||
        observation.watermark.priorCount !==
          layer.delta.changed + layer.delta.deleted + layer.delta.unchanged ||
        observation.tombstones.count !== layer.delta.deleted
      )
        ctx.addIssue({
          code: "custom",
          message: "Source version/watermark/tombstone mismatch",
        });
    }
  });
export const PublicRunManifestSchema = z.union([
  HistoricalPublicRunManifestSchema,
  GenericPublicRunManifestSchema,
]);
export type PublicRunManifest = z.infer<typeof PublicRunManifestSchema>;
