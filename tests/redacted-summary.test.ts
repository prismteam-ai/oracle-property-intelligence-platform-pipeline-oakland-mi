import { test, expect } from "vitest";
import { RedactedSummarySchema } from "../packages/receipts/src/redacted-summary.ts";
const summary = {
  mode: "real-minimized-private",
  source: "Oakland County Enterprise GIS / Tax Parcel Plus",
  sampleCount: 30,
  canonicalCount: 30,
  coordinateCount: 30,
  parquetCount: 30,
  runState: "complete",
  replayIdempotent: true,
  rawBodyDigest: "a".repeat(64),
  canonicalDigest: "b".repeat(64),
  parquetDigest: "c".repeat(64),
  radiusResultCount: 30,
  knownRoofAges: 0,
  permitCount: 0,
  ownerContactFieldsRequested: false,
  publicPublication: false,
  unknowns: ["Roof age"],
  evidenceLevels: ["DuckDB Parquet round-trip"],
  rawRowsIncluded: false,
};
test("only strictly redacted counts/digests/literal states may reach summary endpoint", () => {
  expect(RedactedSummarySchema.safeParse(summary).success).toBe(true);
  for (const body of [
    [{ SITEADDRESS: "SYNTHETIC-UNSAFE" }],
    { features: [{ attributes: { KEYPIN: "SYNTHETIC-UNSAFE" } }] },
    { ...summary, rawRows: [{ address: "SYNTHETIC-UNSAFE" }] },
    { ...summary, source: "Unexpected raw content" },
    { ...summary, rawRowsIncluded: true },
    { ...summary, canonicalCount: 31 },
    { ...summary, unknowns: ["Unbounded free text must not be echoed"] },
  ])
    expect(RedactedSummarySchema.safeParse(body).success).toBe(false);
});
