import { it, expect } from "vitest";
import { syntheticProperties } from "../packages/test-support/src/fixtures.ts";
import {
  PropertySchema,
  type Property,
} from "../packages/contracts/src/index.ts";
import { SnapshotReader } from "../packages/query/src/index.ts";
import { DuckSnapshot } from "../packages/query/src/duckdb.ts";
const snapshotId = "synthetic-reported-sale";
function row(
  id: string,
  sales: string[],
  transfer: string | null = null,
  asOf = "2026-10-27",
  recorded: string[] = [],
): Property {
  const base = syntheticProperties()[0];
  return PropertySchema.parse({
    ...base,
    id,
    nativeId: id,
    coordinates: { lat: 42.66, lng: -83.29 },
    roof: { ...base.roof, asOf },
    ownership: {
      ...base.ownership,
      lastTransferDate: transfer,
      historyCoverage: "partial",
      events: [
        ...sales.map((date, i) => ({
          id: `${id}-sale-${i}`,
          kind: "reported_sale",
          date,
          provenance: base.provenance,
        })),
        ...recorded.map((date, i) => ({
          id: `${id}-recorded-${i}`,
          kind: "recorded_transfer",
          date,
          provenance: base.provenance,
        })),
      ],
    },
  });
}
it("matches memory/DuckDB latest reported-sale predicates without substituting transfer history, unknowns or future dates", async () => {
  const rows = [
      row("old", ["2010-01-01"]),
      row("newest-wins", ["2010-01-01", "2024-01-01"]),
      row("unknown", [], "2010-01-01"),
      row("recorded-is-distinct", [], null, "2026-10-27", ["2010-01-01"]),
      row("future", ["2010-01-01", "2030-01-01"]),
      row("exact-anniversary", ["2016-10-27"]),
      row("older-than-anniversary", ["2016-10-26"]),
    ],
    reader = new SnapshotReader(snapshotId, rows),
    duck = await DuckSnapshot.create(snapshotId, rows),
    query = {
      snapshotId,
      lat: 42.66,
      lng: -83.29,
      radiusMeters: 1000,
      minReportedSaleAgeYears: 10,
      includeUnknown: true,
    };
  try {
    for (const result of [reader.search(query), await duck.search(query)]) {
      expect(result.rows.map((p) => p.id).sort()).toEqual([
        "old",
        "older-than-anniversary",
      ]);
      expect(result.total).toBe(2);
      expect(result.limitations.join(" ")).toContain(
        "do not establish ownership tenure",
      );
    }
    expect(
      reader.search({ ...query, minReportedSaleAgeYears: undefined }).total,
    ).toBe(rows.length);
    expect(
      (await duck.search({ ...query, minReportedSaleAgeYears: undefined }))
        .total,
    ).toBe(rows.length);
  } finally {
    duck.close();
  }
});
it("uses matching strict calendar cutoffs across a leap-year snapshot and never rounds years to fixed days", async () => {
  const rows = [
      row("boundary", ["2023-02-28"], null, "2024-02-29"),
      row("older", ["2023-02-27"], null, "2024-02-29"),
    ],
    reader = new SnapshotReader(snapshotId, rows),
    duck = await DuckSnapshot.create(snapshotId, rows),
    query = {
      snapshotId,
      lat: 42.66,
      lng: -83.29,
      radiusMeters: 1000,
      minReportedSaleAgeYears: 1,
    };
  try {
    expect(reader.search(query).rows.map((p) => p.id)).toEqual(["older"]);
    expect((await duck.search(query)).rows.map((p) => p.id)).toEqual(["older"]);
  } finally {
    duck.close();
  }
});
