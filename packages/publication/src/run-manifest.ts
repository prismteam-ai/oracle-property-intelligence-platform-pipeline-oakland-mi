import { z } from "zod";
import { CID } from "multiformats/cid";
import {
  PUBLIC_PARCEL_FIELDS,
  PUBLIC_ADDRESS_FIELDS,
} from "../../county/src/model.ts";
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
export const PublicRunManifestSchema = z
  .object({
    version: z.literal("p4-public-run-manifest-v1"),
    runId: z.literal("run-03"),
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
  })
  .strict()
  .superRefine((x, ctx) => {
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
  });
export type PublicRunManifest = z.infer<typeof PublicRunManifestSchema>;
