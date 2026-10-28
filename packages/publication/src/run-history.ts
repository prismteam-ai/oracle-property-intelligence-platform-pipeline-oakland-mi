import { z } from "zod";
const count = z.number().int().nonnegative().max(10000000);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const snapshot = z.string().regex(/^oakland-real-[a-f0-9]{20}$/);
const timestamp = z.iso
  .datetime({ offset: true })
  .refine((s) => s.endsWith("Z") || s.endsWith("+00:00"));
const delta = z
  .object({ added: count, changed: count, deleted: count, unchanged: count })
  .strict();
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
const urls = [
  "https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/1",
  "https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/0",
] as const;
function layer(url: (typeof urls)[number]) {
  return z
    .object({
      source: z.literal(url),
      count,
      received: count,
      complete: z.literal(true),
      delta,
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
const base = {
  at: timestamp,
  startedAt: timestamp,
  completedAt: timestamp,
  complete: z.literal(true),
  state: z.literal("COMPLETE"),
  sourceCount: count,
  processed: count,
  added: count,
  changed: count,
  deleted: count,
  unchanged: count,
  deltas: delta,
  snapshotId: snapshot,
  digest: hash,
  canonicalPropertyCount: count,
};
const legacy = {
  ...base,
  layers: z
    .object({ parcel: layer(urls[0]), address: layer(urls[1]) })
    .strict(),
  limitations: z.tuple([
    z.literal(PUBLIC_LEGACY_RUN_LIMITATIONS[0]),
    z.literal(PUBLIC_LEGACY_RUN_LIMITATIONS[1]),
  ]),
};
type Delta = z.infer<typeof delta>;
type RefinedRun = {
  at: string;
  startedAt: string;
  completedAt: string;
  sourceCount: number;
  processed: number;
  added: number;
  changed: number;
  deleted: number;
  unchanged: number;
  deltas: Delta;
  layers: Record<string, { count: number; received: number; delta: Delta }>;
};
function refineRun(x: RefinedRun, ctx: z.RefinementCtx) {
  const values = Object.values(x.layers);
  const totals = values.reduce(
    (sum, l) => ({
      added: sum.added + l.delta.added,
      changed: sum.changed + l.delta.changed,
      deleted: sum.deleted + l.delta.deleted,
      unchanged: sum.unchanged + l.delta.unchanged,
    }),
    { added: 0, changed: 0, deleted: 0, unchanged: 0 },
  );
  if (
    x.at !== x.completedAt ||
    Date.parse(x.completedAt) < Date.parse(x.startedAt) ||
    x.sourceCount !== values.reduce((s, l) => s + l.count, 0) ||
    x.processed !== values.reduce((s, l) => s + l.received, 0) ||
    (Object.keys(totals) as (keyof Delta)[]).some(
      (k) => x[k] !== totals[k] || x.deltas[k] !== totals[k],
    )
  )
    ctx.addIssue({
      code: "custom",
      message: "History timestamps, counts or deltas disagree",
    });
}
export const PublicRunHistorySchema = z
  .tuple([
    z
      .object({
        ...legacy,
        id: z.literal("run-01"),
        kind: z.literal("full-baseline"),
        source: z.literal("full-baseline"),
        datasetReused: z.literal(false),
      })
      .strict()
      .superRefine(refineRun),
    z
      .object({
        ...legacy,
        id: z.literal("run-02"),
        kind: z.literal("complete-content-reconciliation"),
        source: z.literal("complete-content-reconciliation"),
        datasetReused: z.literal(true),
      })
      .strict()
      .superRefine(refineRun),
    z
      .object({
        ...base,
        id: z.literal("run-03"),
        kind: z.literal("full-public-field-incremental-reconciliation"),
        source: z.literal("official county GIS"),
        datasetReused: z.literal(false),
        priorDatasetSnapshotId: snapshot,
        layers: z
          .object({ tax_parcel: layer(urls[0]), site_address: layer(urls[1]) })
          .strict(),
        limitations: z.tuple([
          z.literal(PUBLIC_CURRENT_RUN_LIMITATIONS[0]),
          z.literal(PUBLIC_CURRENT_RUN_LIMITATIONS[1]),
          z.literal(PUBLIC_CURRENT_RUN_LIMITATIONS[2]),
          z.literal(PUBLIC_CURRENT_RUN_LIMITATIONS[3]),
        ]),
      })
      .strict()
      .superRefine(refineRun),
  ])
  .superRefine((runs, ctx) => {
    if (
      runs[0].snapshotId !== runs[1].snapshotId ||
      runs[0].digest !== runs[1].digest ||
      runs[0].canonicalPropertyCount !== runs[1].canonicalPropertyCount ||
      runs[1].added + runs[1].changed + runs[1].deleted !== 0 ||
      runs[2].priorDatasetSnapshotId !== runs[1].snapshotId ||
      runs.some(
        (r, i) =>
          i > 0 &&
          Date.parse(r.startedAt) < Date.parse(runs[i - 1]!.completedAt),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "History lineage/observation windows disagree",
      });
  });
export type PublicRunHistory = z.infer<typeof PublicRunHistorySchema>;
