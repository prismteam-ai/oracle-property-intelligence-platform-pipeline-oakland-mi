import { z } from "zod";
import { sha256, stableJson } from "../../county/src/model.ts";
export const MAX_PUBLIC_HISTORY_RUNS = 10000;
export const PublicRunIdSchema = z
  .string()
  .max(96)
  .regex(/^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/);
function numericRunId(id: string): bigint | null {
  const found = /^run-([0-9]{1,12})$/.exec(id);
  return found ? BigInt(found[1]!) : null;
}
export const PublicCountSchema = z.number().int().nonnegative().max(10000000);
export const PublicHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const PublicSnapshotSchema = z
  .string()
  .regex(/^oakland-real-[a-f0-9]{20}$/);
export const PublicTimestampSchema = z.iso
  .datetime({ offset: true })
  .refine((s) => s.endsWith("Z") || s.endsWith("+00:00"));
export const PublicDeltaSchema = z
  .object({
    added: PublicCountSchema,
    changed: PublicCountSchema,
    deleted: PublicCountSchema,
    unchanged: PublicCountSchema,
  })
  .strict();
export type PublicDelta = z.infer<typeof PublicDeltaSchema>;
export const PUBLIC_LEGACY_RUN_LIMITATIONS = [
  "Deltas count source-layer records (parcels plus site addresses), not assessed properties.",
  "A complete no-change source check reuses the immutable dataset; history retains the actual observation window.",
] as const;
export const PUBLIC_CURRENT_RUN_LIMITATIONS = [
  "Deltas count public source-layer records, not assessed properties.",
  "Source IDs were fenced before and after the complete public-field read; content is an observation window, not a transactional server snapshot.",
  "A new contract/provenance/history root is not evidence of changed county facts.",
  "Protected enrichment and vendor/municipal rows are excluded.",
] as const;
export const PUBLIC_SOURCE_URLS = {
  tax_parcel:
    "https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/1",
  site_address:
    "https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/0",
} as const;
export const PublicSourceIdSchema = z.enum([
  "oakland-tax-parcel-plus",
  "oakland-site-address",
]);
function layer(url: string) {
  return z
    .object({
      source: z.literal(url),
      count: PublicCountSchema,
      received: PublicCountSchema,
      complete: z.literal(true),
      delta: PublicDeltaSchema,
    })
    .strict()
    .superRefine((x, ctx) => {
      if (
        x.count !== x.received ||
        x.count !== x.delta.added + x.delta.changed + x.delta.unchanged
      )
        ctx.addIssue({
          code: "custom",
          message: "History layer delta/count mismatch",
        });
    });
}
const currentLayers = z
  .object({
    tax_parcel: layer(PUBLIC_SOURCE_URLS.tax_parcel),
    site_address: layer(PUBLIC_SOURCE_URLS.site_address),
  })
  .strict();
const legacyLayers = z
  .object({
    parcel: layer(PUBLIC_SOURCE_URLS.tax_parcel),
    address: layer(PUBLIC_SOURCE_URLS.site_address),
  })
  .strict();
const base = {
  id: PublicRunIdSchema,
  at: PublicTimestampSchema,
  startedAt: PublicTimestampSchema,
  completedAt: PublicTimestampSchema,
  complete: z.literal(true),
  state: z.literal("COMPLETE"),
  sourceCount: PublicCountSchema,
  processed: PublicCountSchema,
  added: PublicCountSchema,
  changed: PublicCountSchema,
  deleted: PublicCountSchema,
  unchanged: PublicCountSchema,
  deltas: PublicDeltaSchema,
  snapshotId: PublicSnapshotSchema,
  digest: PublicHashSchema,
  canonicalPropertyCount: PublicCountSchema,
};
const legacyLimitations = z.tuple([
  z.literal(PUBLIC_LEGACY_RUN_LIMITATIONS[0]),
  z.literal(PUBLIC_LEGACY_RUN_LIMITATIONS[1]),
]);
const currentLimitations = z.tuple([
  z.literal(PUBLIC_CURRENT_RUN_LIMITATIONS[0]),
  z.literal(PUBLIC_CURRENT_RUN_LIMITATIONS[1]),
  z.literal(PUBLIC_CURRENT_RUN_LIMITATIONS[2]),
  z.literal(PUBLIC_CURRENT_RUN_LIMITATIONS[3]),
]);
export const PublicSourceObservationSchema = z
  .object({
    sourceId: PublicSourceIdSchema,
    schemaDigest: PublicHashSchema,
    watermark: z
      .object({
        mode: z.literal("complete-native-id-census"),
        priorCount: PublicCountSchema,
        observedCount: PublicCountSchema,
        initialCensusSha256: PublicHashSchema,
        finalCensusSha256: PublicHashSchema,
      })
      .strict(),
    tombstones: z
      .object({ count: PublicCountSchema, nativeIdsSha256: PublicHashSchema })
      .strict(),
  })
  .strict();
export const PublicFailureSchema = z
  .object({
    sourceId: PublicSourceIdSchema.nullable(),
    kind: z.enum(["transport-error", "http-server-error"]),
    attempts: z.number().int().min(1).max(600),
    requestDigests: z.array(PublicHashSchema).min(1).max(600),
  })
  .strict()
  .superRefine((x, ctx) => {
    if (x.attempts !== x.requestDigests.length)
      ctx.addIssue({
        code: "custom",
        message: "Failure attempts/digests disagree",
      });
  });
export type PublicFailure = z.infer<typeof PublicFailureSchema>;
const legacyBaseline = z
  .object({
    ...base,
    kind: z.literal("full-baseline"),
    source: z.literal("full-baseline"),
    datasetReused: z.literal(false),
    layers: legacyLayers,
    limitations: legacyLimitations,
  })
  .strict();
const legacyReuse = z
  .object({
    ...base,
    kind: z.literal("complete-content-reconciliation"),
    source: z.literal("complete-content-reconciliation"),
    datasetReused: z.literal(true),
    layers: legacyLayers,
    limitations: legacyLimitations,
  })
  .strict();
const historicalObserved = z
  .object({
    ...base,
    kind: z.literal("full-public-field-incremental-reconciliation"),
    source: z.literal("official county GIS"),
    datasetReused: z.literal(false),
    priorDatasetSnapshotId: PublicSnapshotSchema,
    layers: currentLayers,
    limitations: currentLimitations,
  })
  .strict();
export const GenericPublicRunSchema = z
  .object({
    ...base,
    version: z.literal("public-run-v2"),
    kind: z.literal("full-public-field-incremental-reconciliation"),
    source: z.literal("official county GIS"),
    datasetReused: z.boolean(),
    previousRunId: PublicRunIdSchema,
    priorDatasetSnapshotId: PublicSnapshotSchema,
    priorDatasetDigest: PublicHashSchema,
    observationDigest: PublicHashSchema,
    layers: currentLayers,
    sourceObservations: z.array(PublicSourceObservationSchema).length(2),
    failures: z.array(PublicFailureSchema).max(600),
    limitations: currentLimitations,
  })
  .strict();
export const PublicRunSchema = z
  .union([
    legacyBaseline,
    legacyReuse,
    historicalObserved,
    GenericPublicRunSchema,
  ])
  .superRefine((x, ctx) => {
    const layers = Object.values(x.layers),
      keys = ["added", "changed", "deleted", "unchanged"] as const;
    const totals = Object.fromEntries(
      keys.map((k) => [k, layers.reduce((n, l) => n + l.delta[k], 0)]),
    ) as PublicDelta;
    if (
      x.at !== x.completedAt ||
      Date.parse(x.completedAt) < Date.parse(x.startedAt) ||
      x.sourceCount !== layers.reduce((n, l) => n + l.count, 0) ||
      x.processed !== layers.reduce((n, l) => n + l.received, 0) ||
      keys.some((k) => x[k] !== totals[k] || x.deltas[k] !== totals[k])
    )
      ctx.addIssue({
        code: "custom",
        message: "History timestamps/counts/deltas disagree",
      });
    if ("version" in x) {
      if (new Set(x.sourceObservations.map((s) => s.sourceId)).size !== 2)
        ctx.addIssue({
          code: "custom",
          message: "Distinct source observations required",
        });
      for (const s of x.sourceObservations) {
        const l =
          x.layers[
            s.sourceId === "oakland-tax-parcel-plus"
              ? "tax_parcel"
              : "site_address"
          ];
        if (
          s.watermark.observedCount !== l.count ||
          s.watermark.priorCount !==
            l.delta.changed + l.delta.deleted + l.delta.unchanged ||
          s.tombstones.count !== l.delta.deleted ||
          (s.tombstones.count === 0 &&
            s.tombstones.nativeIdsSha256 !== sha256(""))
        )
          ctx.addIssue({
            code: "custom",
            message: "Watermark/tombstone semantics disagree",
          });
      }
    }
  });
export type PublicRun = z.infer<typeof PublicRunSchema>;
export function publicRunLayers(run: PublicRun) {
  return "parcel" in run.layers
    ? { tax_parcel: run.layers.parcel, site_address: run.layers.address }
    : run.layers;
}
export const PublicRunHistorySchema = z
  .array(PublicRunSchema)
  .min(1)
  .max(MAX_PUBLIC_HISTORY_RUNS)
  .superRefine((runs, ctx) => {
    const ids = new Set<string>(),
      numbers = new Set<bigint>();
    for (const [index, run] of runs.entries()) {
      const numeric = numericRunId(run.id);
      if (
        ids.has(run.id) ||
        (numeric !== null && numbers.has(numeric)) ||
        numeric === 0n
      )
        ctx.addIssue({
          code: "custom",
          message: "Duplicate/ambiguous/zero run ID",
        });
      ids.add(run.id);
      if (numeric !== null) numbers.add(numeric);
      const previous = runs[index - 1];
      if (!previous) {
        if (
          run.kind !== "full-baseline" ||
          run.changed + run.deleted + run.unchanged !== 0
        )
          ctx.addIssue({
            code: "custom",
            message: "History must begin with a full added baseline",
          });
        continue;
      }
      const oldLayers = publicRunLayers(previous),
        newLayers = publicRunLayers(run);
      if (
        Date.parse(run.startedAt) < Date.parse(previous.completedAt) ||
        run.kind === "full-baseline" ||
        (["tax_parcel", "site_address"] as const).some(
          (k) =>
            newLayers[k].delta.changed +
              newLayers[k].delta.deleted +
              newLayers[k].delta.unchanged !==
            oldLayers[k].count,
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "History order/predecessor source counts disagree",
        });
      if (
        "priorDatasetSnapshotId" in run &&
        run.priorDatasetSnapshotId !== previous.snapshotId
      )
        ctx.addIssue({
          code: "custom",
          message: "History snapshot lineage mismatch",
        });
      if (
        "version" in run &&
        (run.previousRunId !== previous.id ||
          run.priorDatasetDigest !== previous.digest)
      )
        ctx.addIssue({
          code: "custom",
          message: "History immediate predecessor mismatch",
        });
      if (
        run.datasetReused &&
        (run.snapshotId !== previous.snapshotId ||
          run.digest !== previous.digest ||
          run.added + run.changed + run.deleted !== 0 ||
          run.canonicalPropertyCount !== previous.canonicalPropertyCount)
      )
        ctx.addIssue({
          code: "custom",
          message: "Dataset reuse claim is inconsistent",
        });
    }
  });
export type PublicRunHistory = z.infer<typeof PublicRunHistorySchema>;
/** Exact retries return the same sequence; an ID may never be relabeled or appended twice. */
export function appendPublicRun(
  history: unknown,
  run: unknown,
): PublicRunHistory {
  const prior = PublicRunHistorySchema.parse(history),
    next = PublicRunSchema.parse(run),
    existing = prior.find(
      (r) =>
        r.id === next.id ||
        (numericRunId(r.id) !== null &&
          numericRunId(r.id) === numericRunId(next.id)),
    );
  if (existing) {
    if (prior.at(-1) !== existing || stableJson(existing) !== stableJson(next))
      throw new Error("Immutable run ID conflicts with prior history");
    return prior;
  }
  return PublicRunHistorySchema.parse([...prior, next]);
}
/** Complete source reconciliation: missing old IDs become tombstones, never silently disappear. */
export function reconcilePublicRecords(
  previous: readonly { nativeId: string; contentHash: string }[],
  current: readonly { nativeId: string; contentHash: string }[],
) {
  const map = (rows: typeof previous) => {
    const out = new Map<string, string>();
    for (const r of rows) {
      if (
        !/^\d{1,16}$/.test(r.nativeId) ||
        !PublicHashSchema.safeParse(r.contentHash).success ||
        out.has(r.nativeId)
      )
        throw new Error("Invalid/duplicate source-native record");
      out.set(r.nativeId, r.contentHash);
    }
    return out;
  };
  const old = map(previous),
    next = map(current),
    delta: PublicDelta = { added: 0, changed: 0, deleted: 0, unchanged: 0 },
    deleted: string[] = [];
  for (const [id, hash] of next) {
    if (!old.has(id)) delta.added++;
    else if (old.get(id) === hash) delta.unchanged++;
    else delta.changed++;
  }
  for (const id of old.keys())
    if (!next.has(id)) {
      delta.deleted++;
      deleted.push(id);
    }
  deleted.sort();
  return {
    delta,
    tombstones: {
      count: deleted.length,
      nativeIdsSha256: sha256(deleted.join("\n")),
    },
    deletedNativeIds: deleted,
  };
}
