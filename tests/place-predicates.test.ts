import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import rawIndex from "../packages/places/src/official-index.json" with { type: "json" };
import {
  officialPlaceResolver,
  resolveQueryPlace,
} from "../packages/places/src/index.ts";
import {
  QuerySchema,
  type Property,
  type Permit,
} from "../packages/contracts/src/index.ts";
import { stableJson } from "../packages/county/src/model.ts";
import {
  syntheticProperties,
  AS_OF,
} from "../packages/test-support/src/fixtures.ts";
import { SnapshotReader } from "../packages/query/src/index.ts";
import { DuckSnapshot } from "../packages/query/src/duckdb.ts";
import { hasMinimumVerifiedTenure } from "../packages/query/src/predicates.ts";

const troy = officialPlaceResolver.resolve("Troy, Michigan");
if (troy.status !== "resolved")
  throw new Error("Official Troy fixture missing");
const center = troy.place.center;
const base = QuerySchema.parse({
  snapshotId: "synthetic-presence",
  ...center,
  radiusMeters: 8046.72,
  limit: 50,
});
function fixtures(): Property[] {
  const template = syntheticProperties(2)[1]!;
  const permit = (
    id: string,
    status: Permit["status"],
    verified: boolean,
    rating: boolean,
  ): Permit => ({
    ...structuredClone(template.permits[0]!),
    id,
    status,
    kind: "roof_replacement",
    openedAt: "2010-01-01",
    closedAt: status === "closed" ? "2020-01-01" : null,
    contractor: {
      reportedName: "Synthetic source applicant",
      verifiedCompanyId: verified ? "SYN-COMPANY" : null,
      license: "SYN-RAW-NUMBER",
      rating: null,
      licenseEvidence: {
        identifier: "SYN-OFFICIAL-OBS",
        type: "Synthetic license",
        status: "Issued",
        sourceUrl: "https://official.example/license",
        observedAt: "2026-10-26T00:00:00Z",
        matchBasis: "synthetic exact identity",
        confidence: "high",
      },
      ratingEvidence: rating
        ? {
            value: "A+",
            scale: "BBB",
            sourceUrl: "https://official.example/rating",
            observedAt: "2026-10-26T00:00:00Z",
            matchConfidence: "high",
          }
        : null,
    },
  });
  const a: Property = {
    ...structuredClone(template),
    id: "SYN-A",
    coordinates: center,
    roof: { ...template.roof, ageYears: 20 },
    permits: [
      permit("SYN-A-OPEN", "open", false, false),
      permit("SYN-A-CLOSED", "closed", true, true),
    ],
  };
  const b: Property = {
    ...structuredClone(template),
    id: "SYN-B",
    coordinates: { lat: center.lat + 0.01, lng: center.lng },
    roof: { ...template.roof, ageYears: 40 },
    permits: [permit("SYN-B-OPEN", "open", true, true)],
  };
  const unknown = permit("SYN-C-ISSUED", "open", false, false);
  unknown.statusBasis = "issued_only";
  unknown.contractor.licenseEvidence = null;
  const c: Property = {
    ...structuredClone(template),
    id: "SYN-C",
    coordinates: { lat: center.lat + 0.02, lng: center.lng },
    roof: { ...template.roof, ageYears: null },
    permits: [unknown],
  };
  return [a, b, c];
}

describe("source-bound municipal places", () => {
  it("retains all official features, quarantines source anomalies and preserves mathematical centroid", () => {
    expect(officialPlaceResolver.places).toHaveLength(63);
    expect(
      officialPlaceResolver.places.filter((p) => p.resolutionEligible),
    ).toHaveLength(62);
    expect(officialPlaceResolver.resolve("Cass Lake").status).toBe(
      "unavailable",
    );
    for (const name of [
      "Troy, Michigan",
      "City of Novi, Michigan",
      "Pontiac",
      "Rochester Hills",
      "City of Clarkston",
      "Orchard Lake",
    ])
      expect(officialPlaceResolver.resolve(name).status, name).toBe("resolved");
    expect(officialPlaceResolver.resolve("Novi, MI").status).toBe("ambiguous");
    expect(officialPlaceResolver.resolve("Detroit, Michigan").status).not.toBe(
      "resolved",
    );
  });
  it("binds data digest, place identity and the exact source-derived center", () => {
    const { indexDigest, ...body } = rawIndex;
    expect(createHash("sha256").update(stableJson(body)).digest("hex")).toBe(
      indexDigest,
    );
    const query = {
      ...base,
      placeId: troy.place.placeId,
      placeIndexDigest: indexDigest,
    };
    expect(resolveQueryPlace(query)?.placeId).toBe(troy.place.placeId);
    for (const change of [
      { lat: base.lat + 0.01 },
      { placeId: "unknown" },
      { placeIndexDigest: "0".repeat(64) },
      { placeIndexDigest: undefined },
      { placeId: undefined },
    ])
      expect(() => resolveQueryPlace({ ...query, ...change })).toThrow();
  });
});

describe("typed evidence predicates and native parity", () => {
  it("ranks only the permits satisfying the same requested evidence conjunction", async () => {
    const rows = fixtures().slice(0, 2);
    const a = rows[0]!,
      b = rows[1]!;
    a.permits[0]!.openedAt = "1990-01-01";
    a.permits[1]!.status = "open";
    a.permits[1]!.closedAt = null;
    a.permits[1]!.openedAt = "2020-01-01";
    b.permits[0]!.openedAt = "2015-01-01";
    const q = {
      ...base,
      permitStatus: "open" as const,
      requiresContractor: true,
      sort: "permit_open_days_desc" as const,
    };
    const memory = new SnapshotReader(base.snapshotId, rows),
      native = await DuckSnapshot.create(base.snapshotId, rows);
    try {
      expect(memory.search(q).rows.map((p) => p.id)).toEqual([
        "SYN-B",
        "SYN-A",
      ]);
      expect((await native.search(q)).rows.map((p) => p.id)).toEqual([
        "SYN-B",
        "SYN-A",
      ]);
    } finally {
      native.close();
    }
  });
  it("keeps presence, unknown status, same-permit conjunction and source ordering consistent", async () => {
    const rows = fixtures(),
      memory = new SnapshotReader(base.snapshotId, rows),
      native = await DuckSnapshot.create(base.snapshotId, rows);
    try {
      for (const permitStatus of ["any", "open", "closed", "unknown"] as const)
        for (let mask = 0; mask < 8; mask++) {
          const q = {
            ...base,
            permitStatus,
            requiresContractor: Boolean(mask & 1),
            requiresVerifiedLicense: Boolean(mask & 2),
            requiresBbbRating: Boolean(mask & 4),
          };
          const a = memory.search(q),
            b = await native.search(q);
          expect(
            b.rows.map((p) => p.id),
            JSON.stringify(q),
          ).toEqual(a.rows.map((p) => p.id));
          expect(b.total).toBe(a.total);
        }
      expect(
        memory
          .search({
            ...base,
            permitStatus: "open",
            requiresContractor: true,
            requiresBbbRating: true,
          })
          .rows.map((p) => p.id),
      ).toEqual(["SYN-B"]);
      expect(
        memory
          .search({ ...base, permitStatus: "unknown" })
          .rows.map((p) => p.id),
      ).toEqual(["SYN-C"]);
      for (const sort of [
        "distance",
        "roof_age_desc",
        "permit_open_days_desc",
      ] as const) {
        const q = { ...base, sort };
        expect((await native.search(q)).rows.map((p) => p.id)).toEqual(
          memory.search(q).rows.map((p) => p.id),
        );
      }
      expect(
        (await native.search({ ...base, sort: "roof_age_desc" })).rows.map(
          (p) => p.id,
        ),
      ).toEqual(["SYN-B", "SYN-A", "SYN-C"]);
      const named = {
        ...base,
        placeId: troy.place.placeId,
        placeIndexDigest: officialPlaceResolver.indexDigest,
      };
      expect((await native.search(named)).placeResolution?.placeId).toBe(
        troy.place.placeId,
      );
      expect(memory.search(named).placeResolution?.placeId).toBe(
        troy.place.placeId,
      );
    } finally {
      native.close();
    }
  });
  it("requires a proved complete history window and claim, not a sale or a full label", async () => {
    const rows = fixtures();
    const p = rows[1]!;
    const provenance = p.provenance;
    p.ownership.historyCoverage = "full";
    p.ownership.lastTransferDate = "2012-01-01";
    expect(hasMinimumVerifiedTenure(p, 10)).toBe(false);
    p.ownership.transferHistoryCoverage = {
      state: "full",
      from: "2000-01-01",
      through: AS_OF,
      provenance,
      limitations: ["Synthetic full history fixture only"],
    };
    p.ownership.uninterruptedTenure = {
      state: "supported",
      unchangedSince: "2012-01-01",
      asOf: AS_OF,
      provenance,
    };
    expect(hasMinimumVerifiedTenure(p, 10)).toBe(true);
    const memory = new SnapshotReader(base.snapshotId, rows),
      native = await DuckSnapshot.create(base.snapshotId, rows);
    try {
      expect(
        memory.search({ ...base, minOwnershipYears: 10 }).rows.map((p) => p.id),
      ).toEqual(["SYN-B"]);
      expect(
        (await native.search({ ...base, minOwnershipYears: 10 })).rows.map(
          (p) => p.id,
        ),
      ).toEqual(["SYN-B"]);
    } finally {
      native.close();
    }
    p.ownership.events = [
      {
        id: "SYN-LATER-TRANSFER",
        kind: "recorded_transfer",
        date: "2025-01-01",
        provenance,
      },
    ];
    expect(hasMinimumVerifiedTenure(p, 10)).toBe(false);
    p.ownership.events = [];
    p.ownership.transferHistoryCoverage.from = "2020-01-01";
    expect(hasMinimumVerifiedTenure(p, 10)).toBe(false);
  });
});
