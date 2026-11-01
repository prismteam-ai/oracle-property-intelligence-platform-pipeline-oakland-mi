import { z } from "zod";
import { readFile } from "node:fs/promises";
const count = z.number().int().min(0).max(500);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const RedactedSummarySchema = z
  .object({
    mode: z.literal("real-minimized-private"),
    source: z.literal("Oakland County Enterprise GIS / Tax Parcel Plus"),
    sampleCount: count,
    canonicalCount: count,
    coordinateCount: count,
    parquetCount: count,
    runState: z.literal("complete"),
    replayIdempotent: z.boolean(),
    rawBodyDigest: hash,
    canonicalDigest: hash,
    parquetDigest: hash,
    radiusResultCount: count,
    knownRoofAges: z.literal(0),
    permitCount: z.literal(0),
    ownerContactFieldsRequested: z.literal(false),
    publicPublication: z.literal(false),
    unknowns: z.array(
      z.enum([
        "Roof age",
        "Permit history",
        "Official contractor/license/rating",
        "Ownership history",
      ]),
    ),
    evidenceLevels: z.array(
      z.enum([
        "protected raw sample",
        "canonical minimized transform",
        "idempotent ledger",
        "DuckDB Parquet round-trip",
        "bounded source-backed radius query",
      ]),
    ),
    rawRowsIncluded: z.literal(false),
  })
  .strict()
  .refine(
    (x) =>
      x.canonicalCount === x.sampleCount &&
      x.parquetCount === x.canonicalCount &&
      x.coordinateCount <= x.canonicalCount &&
      x.radiusResultCount <= x.canonicalCount,
    { message: "Redacted count reconciliation failed" },
  );
export type RedactedSummary = z.infer<typeof RedactedSummarySchema>;
export async function loadRedactedSummary(
  file: string,
): Promise<RedactedSummary> {
  return RedactedSummarySchema.parse(
    JSON.parse(await readFile(file, "utf8")) as unknown,
  );
}
