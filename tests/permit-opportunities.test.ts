import { describe, it, expect } from "vitest";
import {
  QuerySchema,
  ProviderPermitObservationSchema,
  type Permit,
  type Property,
  type QueryInput,
} from "../packages/contracts/src/index.ts";
import {
  allPermitSignals,
  qualifyingPermitSignals,
  permitMatchesQuery,
} from "../packages/contracts/src/query-predicates.ts";
import {
  syntheticProperties,
  SNAPSHOT_ID,
} from "../packages/test-support/src/fixtures.ts";
import { SnapshotReader } from "../packages/query/src/index.ts";
import { DuckSnapshot } from "../packages/query/src/duckdb.ts";
import { callTool } from "../packages/mcp-adapter/src/index.ts";
import { observation } from "./p6-observations.fixture.ts";
const stamp = "2026-10-28T20:00:00.000Z",
  hash = "a".repeat(64);
const base: QueryInput = {
  snapshotId: SNAPSHOT_ID,
  lat: 42.66,
  lng: -83.29,
  radiusMeters: 8046.72,
};
function native(
  id: string,
  date: string | null = "2010-01-01",
  patch: Partial<Permit> = {},
): Permit {
  return {
    id,
    kind: "roof_unspecified",
    status: "unknown",
    statusBasis: "issued_only",
    issuedAt: date,
    reportedStatus: null,
    statusObservedAt: stamp,
    openedAt: null,
    closedAt: null,
    contractor: {
      reportedName: "Synthetic reported applicant",
      verifiedCompanyId: null,
      license: null,
      rating: null,
    },
    provenance: [
      {
        sourceId: "synthetic-native-issued",
        recordId: id,
        digest: hash,
        observedAt: stamp,
        kind: "synthetic",
      },
    ],
    ...patch,
  };
}
function property(id: string, permits: Permit[]): Property {
  const p = structuredClone(syntheticProperties()[0]!);
  return {
    ...p,
    id,
    coordinates: { lat: 42.66, lng: -83.29 },
    permits,
    roof: { ...p.roof, asOf: "2050-01-01" },
  };
}
function query(
  mode: NonNullable<QueryInput["permitOpportunityMode"]>,
  extra: Partial<QueryInput> = {},
): QueryInput {
  return { ...base, permitOpportunityMode: mode, ...extra };
}
describe("independent permit lifecycle and lead signals", () => {
  it("keeps issued native status unavailable and derives candidate age from its own source anchor", () => {
    const row = property("one", [native("issued")]);
    const signal = qualifyingPermitSignals(
      row,
      query("status_verification_needed"),
    )[0]!;
    expect(signal).toMatchObject({
      nativeStatus: null,
      statusBasis: "issued_only",
      lifecycleState: "unknown",
      leadSignal: "status_verification_needed",
      dateBasis: "issued",
      assessmentAt: stamp,
      party: { verifiedContractorIdentity: false },
    });
    expect(signal.ageDays).toBe(
      Math.floor(
        (Date.parse("2026-10-28") - Date.parse("2010-01-01")) / 86400000,
      ),
    );
    expect(qualifyingPermitSignals(row, query("confirmed_open"))).toEqual([]);
    expect(row.permits[0]!.reportedStatus).toBeNull();
  });
  it.each(["2021-10-28", "2021-10-29", null, "2027-01-01"])(
    "does not qualify boundary/missing/future issue date %s",
    (date) => {
      expect(
        qualifyingPermitSignals(
          property("x", [native("x", date)]),
          query("status_verification_needed"),
        ),
      ).toEqual([]);
    },
  );
  it("uses a clamped source-calendar leap anniversary, never five times365", () => {
    const p = property("leap", [
      native("before", "2019-02-27", {
        statusObservedAt: "2024-02-29T00:00:00Z",
      }),
      native("equal", "2019-02-28", {
        statusObservedAt: "2024-02-29T00:00:00Z",
      }),
    ]);
    expect(
      qualifyingPermitSignals(p, query("status_verification_needed")).map(
        (x) => x.permitId,
      ),
    ).toEqual(["before"]);
  });
  it.each([
    "CLOSED",
    "FINAL",
    "FINALED",
    "COMPLETED",
    "CANCELED",
    "CANCELLED",
    "REVOKED",
    "EXPIRED",
  ])(
    "terminal native label %s vetoes candidates without inventing open status",
    (status) => {
      expect(
        qualifyingPermitSignals(
          property("x", [
            native("x", "2010-01-01", { reportedStatus: status }),
          ]),
          query("status_verification_needed"),
        ),
      ).toEqual([]);
    },
  );
  it("same-permit terminal authority vetoes a stale provider alternative; another closed permit does not", () => {
    const row = observation();
    const closed = native("closed", "2010-01-01", {
      status: "closed",
      statusBasis: "explicit_closed",
      reportedStatus: "FINALED",
      sourceObservations: [row],
    });
    const signals = allPermitSignals(
      property("x", [closed, native("separate")]),
    );
    expect(
      signals
        .filter((s) => s.permitId === "closed")
        .every((s) => s.terminalEvidence.excludedFromVerification),
    ).toBe(true);
    expect(
      qualifyingPermitSignals(
        property("x", [closed, native("separate")]),
        query("status_verification_needed"),
      ).map((s) => s.permitId),
    ).toEqual(["separate"]);
  });
  it("provider roofing does not borrow native age, contractor, license or BBB evidence", () => {
    const template = observation(),
      issued = "2025-01-01";
    const recent = ProviderPermitObservationSchema.parse({
      ...template,
      dateIssued: issued,
      ageSinceIssueDays: Math.floor(
        (Date.parse("2026-10-28") - Date.parse(issued)) / 86400000,
      ),
      issuedMoreThanFiveYearsAgo: false,
    });
    const parent = native("mixed", "2000-01-01", {
      kind: "other",
      sourceObservations: [recent],
      contractor: {
        reportedName: "Synthetic parent business",
        verifiedCompanyId: "SYN-VERIFIED",
        license: "SYN-LIC",
        rating: null,
        licenseEvidence: {
          identifier: "SYN-LIC",
          type: "test",
          status: "current",
          sourceUrl: "https://example.invalid/license",
          observedAt: stamp,
          matchBasis: "synthetic",
          confidence: "high",
        },
        ratingEvidence: {
          value: "A+",
          scale: "BBB",
          sourceUrl: "https://example.invalid/bbb",
          observedAt: stamp,
          matchConfidence: "high",
        },
      },
    });
    expect(
      qualifyingPermitSignals(
        property("x", [parent]),
        query("status_verification_needed"),
      ),
    ).toEqual([]);
    parent.sourceObservations = [template];
    expect(
      qualifyingPermitSignals(
        property("x", [parent]),
        query("status_verification_needed"),
      ),
    ).toHaveLength(1);
    for (const key of [
      "requiresContractor",
      "requiresVerifiedLicense",
      "requiresBbbRating",
    ] as const)
      expect(
        qualifyingPermitSignals(
          property("x", [parent]),
          query("status_verification_needed", { [key]: true }),
        ),
      ).toEqual([]);
  });
  it("LARA, BBB and native-status enrichment citations never inherit the native issued observation", () => {
    const permit = native("native");
    permit.provenance[0]!.sourceId = "official-troy-issued-permits";
    permit.provenance[0]!.kind = "real-minimized";
    const extra = [
      "michigan-lara-license-verification",
      "bbb-business-profile",
      "official-troy-permit-status",
    ].map((sourceId) => ({
      ...permit.provenance[0]!,
      sourceId,
      recordId: "enrichment-" + sourceId,
    }));
    permit.provenance.push(...extra);
    expect(
      qualifyingPermitSignals(
        property("x", [permit]),
        query("status_verification_needed"),
      ).map((s) => s.sourceId),
    ).toEqual(["official-troy-issued-permits"]);
    permit.provenance = extra;
    expect(
      qualifyingPermitSignals(
        property("x", [permit]),
        query("status_verification_needed"),
      ),
    ).toEqual([]);
  });
  it("enrichment-only raw native states cannot classify or veto an independent provider observation", () => {
    for (const sourceId of [
      "michigan-lara-license-verification",
      "bbb-business-profile",
    ]) {
      for (const status of ["open", "closed"] as const) {
        const permit = native("raw-parent", null, {
          kind: "other",
          status,
          statusBasis: status === "open" ? "explicit_open" : "explicit_closed",
          reportedStatus: status.toUpperCase(),
          openedAt: status === "open" ? "2010-01-01" : null,
          closedAt: status === "closed" ? "2020-01-01" : null,
          sourceObservations: [observation()],
          provenance: [
            {
              sourceId,
              recordId: "enrichment-only",
              digest: hash,
              observedAt: stamp,
              kind: "real-minimized",
            },
          ],
        });
        const signals = qualifyingPermitSignals(
          property("x", [permit]),
          query("status_verification_needed"),
        );
        expect(signals).toHaveLength(1);
        expect(signals[0]).toMatchObject({
          sourceKind: "provider_observation",
          lifecycleState: "unknown",
          leadSignal: "status_verification_needed",
          terminalEvidence: { excludedFromVerification: false },
        });
      }
    }
  });
  it("an independently admitted native status authority still vetoes the same provider permit", () => {
    const permit = native("raw-parent", null, {
      kind: "other",
      status: "closed",
      statusBasis: "explicit_closed",
      reportedStatus: "CLOSED",
      closedAt: "2020-01-01",
      sourceObservations: [observation()],
      provenance: [
        {
          sourceId: "official-troy-bsa-permit-status",
          recordId: "actual-status-authority",
          digest: hash,
          observedAt: stamp,
          kind: "real-minimized",
        },
      ],
    });
    expect(
      qualifyingPermitSignals(
        property("x", [permit]),
        query("status_verification_needed"),
      ),
    ).toEqual([]);
    expect(
      allPermitSignals(property("x", [permit]))[0]?.terminalEvidence
        .vetoProvenance[0]?.sourceId,
    ).toBe("official-troy-bsa-permit-status");
  });
  it("a future scheduled provider expiry does not invent a current terminal state", () => {
    const row = ProviderPermitObservationSchema.parse({
      ...observation(),
      dateExpired: "2030-01-01",
    });
    expect(
      qualifyingPermitSignals(
        property("x", [
          native("x", null, { kind: "other", sourceObservations: [row] }),
        ]),
        query("status_verification_needed"),
      ),
    ).toHaveLength(1);
  });
  it("native continuous-open duration cannot be borrowed by a provider-only observation", () => {
    const row = observation("IN_PROGRESS");
    const parent = native("mixed", "2010-01-01", {
      kind: "other",
      status: "open",
      statusBasis: "explicit_open",
      openedAt: "2010-01-01",
      sourceObservations: [row],
    });
    expect(
      qualifyingPermitSignals(property("x", [parent]), query("confirmed_open")),
    ).toHaveLength(1);
    expect(
      qualifyingPermitSignals(
        property("x", [parent]),
        query("confirmed_open", { minOpenDays: 1 }),
      ),
    ).toEqual([]);
  });
  it("strict open selection and priority use the qualifying observation's own documented interval", () => {
    const template = observation("IN_PROGRESS");
    const make = (id: string, days: number) =>
      ProviderPermitObservationSchema.parse({
        ...template,
        providerRecordId: id,
        statusBasis: "independent_native_status",
        activityClaim: "native_reported_open",
        openedAt: new Date(Date.parse("2026-10-28") - days * 86400000)
          .toISOString()
          .slice(0, 10),
        continuousOpenDays: days,
        continuousOpenIntervalBasis: "independent_documented_native_history",
        provenance: { ...template.provenance, nativeStatusReceiptSha256: hash },
      });
    const p = property("x", [
      native("x", null, {
        kind: "other",
        sourceObservations: [make("short", 10), make("long", 30)],
      }),
    ]);
    expect(
      qualifyingPermitSignals(p, query("confirmed_open"))[0]?.openDays,
    ).toBe(30);
    expect(
      qualifyingPermitSignals(
        p,
        query("confirmed_open", { minOpenDays: 15 }),
      ).map((s) => s.provenance.recordId),
    ).toEqual(["long"]);
  });
  it("keeps omitted primary mode semantics and rejects contradictory new controls", () => {
    const noPermits = property("none", []);
    expect(
      new SnapshotReader(SNAPSHOT_ID, [noPermits]).search(base).total,
    ).toBe(1);
    expect(
      new SnapshotReader(SNAPSHOT_ID, [noPermits]).search(
        query("any_roofing_permit"),
      ).total,
    ).toBe(0);
    for (const patch of [
      { minPermitObservationAgeYears: 5 },
      { sort: "permit_issue_age_desc" },
      { permitOpportunityMode: "status_verification_needed", minOpenDays: 1 },
      { permitOpportunityMode: "confirmed_open", permitStatus: "closed" },
    ])
      expect(QuerySchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });
  it("does not combine advanced status and age from different provider observations", () => {
    const old = observation(),
      recent = ProviderPermitObservationSchema.parse({
        ...old,
        providerRecordId: "recent",
        providerStatus: "UNKNOWN",
        statusBasis: "provider_status_only",
        dateIssued: "2025-01-01",
        ageSinceIssueDays: Math.floor(
          (Date.parse("2026-10-28") - Date.parse("2025-01-01")) / 86400000,
        ),
        issuedMoreThanFiveYearsAgo: false,
      });
    const parent = native("x", null, {
      kind: "other",
      sourceObservations: [old, recent],
    });
    expect(
      permitMatchesQuery(
        parent,
        query("status_verification_needed", {
          providerPermitStatus: "UNKNOWN",
        }),
        "2050-01-01",
      ),
    ).toBe(false);
  });
});

it("in-memory, DuckDB and MCP agree before counts, ordering and pagination", async () => {
  const data = [
    property("old", [native("p-old", "2000-01-01")]),
    property("middle", [native("p-middle", "2010-01-01")]),
    property("young", [native("p-young", "2025-01-01")]),
    property("closed", [
      native("p-closed", "2010-01-01", {
        status: "closed",
        statusBasis: "explicit_closed",
        reportedStatus: "FINALED",
      }),
    ]),
    property("other", [native("p-other", "2000-01-01", { kind: "other" })]),
  ];
  const reference = new SnapshotReader(SNAPSHOT_ID, data),
    duck = await DuckSnapshot.create(SNAPSHOT_ID, data);
  try {
    for (const mode of [
      "any_roofing_permit",
      "confirmed_open",
      "status_verification_needed",
      "confirmed_closed",
      "lifecycle_unknown",
    ] as const) {
      const q = query(mode, { limit: 1 }),
        expected = reference.search(q),
        actual = await duck.search(q);
      expect(actual.total).toBe(expected.total);
      expect(actual.rows.map((p) => p.id)).toEqual(
        expected.rows.map((p) => p.id),
      );
      expect(
        callTool(reference, { tool: "searchProperties", args: q }),
      ).toEqual(expected);
      if (expected.nextCursor) {
        const next = { ...q, cursor: expected.nextCursor };
        expect((await duck.search(next)).rows.map((p) => p.id)).toEqual(
          reference.search(next).rows.map((p) => p.id),
        );
      }
    }
    const q = query("status_verification_needed", { limit: 1 }),
      first = await duck.search(q);
    expect(first.total).toBe(2);
    expect(first.rows[0]?.id).toBe("old");
    const beyond = Buffer.from(
      JSON.stringify({
        snapshotId: SNAPSHOT_ID,
        queryHash: first.queryHash,
        offset: 999,
      }),
    ).toString("base64url");
    expect(await duck.search({ ...q, cursor: beyond })).toMatchObject({
      total: 2,
      rows: [],
    });
    await expect(
      duck.search({
        ...q,
        permitOpportunityMode: "confirmed_closed",
        cursor: first.nextCursor!,
      }),
    ).rejects.toThrow("Cursor");
  } finally {
    duck.close();
  }
});

it("SQL primary open mode uses provider-own roofing and intervals, not legacy parent-kind restrictions", async () => {
  const template = observation("IN_PROGRESS");
  const own = ProviderPermitObservationSchema.parse({
    ...template,
    canonicalPropertyId: "provider",
    publicSnapshotId: SNAPSHOT_ID,
    statusBasis: "independent_native_status",
    activityClaim: "native_reported_open",
    openedAt: "2026-09-28",
    continuousOpenDays: 30,
    continuousOpenIntervalBasis: "independent_documented_native_history",
    provenance: { ...template.provenance, nativeStatusReceiptSha256: hash },
  });
  const parent = native("provider-own", null, {
    kind: "other",
    sourceObservations: [own],
  });
  const data = [property("provider", [parent])],
    reference = new SnapshotReader(SNAPSHOT_ID, data),
    duck = await DuckSnapshot.create(SNAPSHOT_ID, data);
  try {
    for (const days of [0, 15, 30, 31]) {
      const q = query("confirmed_open", { minOpenDays: days });
      const expected = reference.search(q),
        actual = await duck.search(q);
      expect(expected.total).toBe(days <= 30 ? 1 : 0);
      expect(actual.total).toBe(expected.total);
      expect(actual.rows.map((p) => p.id)).toEqual(
        expected.rows.map((p) => p.id),
      );
    }
  } finally {
    duck.close();
  }
});

it("SQL opportunity eligibility binds property and permit together even when synthetic permit IDs collide", async () => {
  const data = [
    property("recent-property", [native("DUP", "2025-01-01")]),
    property("old-property", [native("DUP", "2010-01-01")]),
  ];
  const reference = new SnapshotReader(SNAPSHOT_ID, data),
    duck = await DuckSnapshot.create(SNAPSHOT_ID, data);
  try {
    const q = query("status_verification_needed", {
      minPermitObservationAgeYears: 5,
      limit: 1,
    });
    const expected = reference.search(q),
      actual = await duck.search(q);
    expect(expected.total).toBe(1);
    expect(actual.total).toBe(1);
    expect(actual.rows.map((row) => row.id)).toEqual(["old-property"]);
    const beyond = Buffer.from(
      JSON.stringify({
        snapshotId: SNAPSHOT_ID,
        queryHash: actual.queryHash,
        offset: 99,
      }),
    ).toString("base64url");
    expect(await duck.search({ ...q, cursor: beyond })).toMatchObject({
      total: 1,
      rows: [],
    });
  } finally {
    duck.close();
  }
});
