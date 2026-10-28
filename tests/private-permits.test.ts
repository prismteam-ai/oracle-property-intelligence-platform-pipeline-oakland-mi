import { describe, it, expect } from "vitest";
import {
  normalizeTroyIssued,
  matchTroyIssued,
} from "../packages/county/src/troy.ts";
import {
  validateProtectedPermitRow,
  protectedPermitOpenDays,
  applyProtectedPermitObservations,
} from "../packages/county/src/private-permits.ts";
const stamp = "2026-10-28T01:00:00Z",
  snapshot = "oakland-real-" + "1".repeat(20);
const obs = normalizeTroyIssued(
  {
    permitNumber: "SYN-PERMIT",
    issuedDate: "Jan 1, 2011",
    siteAddress: "100 EXAMPLE RD",
    applicant: "Synthetic Roofing LLC",
    parcel: "88-20-01-001-001",
    reportedPermitType: "Res., Roof",
    description: "Roof work",
    value: "$1000",
  },
  { observedAt: stamp, receiptDigest: "a".repeat(64) },
);
const matched = matchTroyIssued(obs, [
  {
    propertyId: "SYN-P1",
    parcelPin: "2001001001",
    siteAddress: "100 EXAMPLE RD",
    city: "Troy",
  },
]);
const base = {
  property_id: "SYN-P1",
  permit_json: JSON.stringify(matched.permit),
  public_snapshot_id: snapshot,
  source_id: "official-troy-issued-permits",
  native_id: "SYN-PERMIT",
  record_digest: obs.recordDigest,
  observed_at: stamp,
};
describe("protected permit staging boundary", () => {
  it("applies only reviewed observed statuses, preserves original issuance, and rejects missing or duplicate targets", () => {
    const status = {
      state: "closed",
      reportedStatus: "Closed",
      openedAt: null,
      closedAt: "2026-10-27",
      sourceId: "official-troy-permit-status",
      sourceUrl: "https://apps.troymi.gov/PermitsIssued",
      observedAt: "2026-10-28T02:00:00.000Z",
      recordId: "SYN-PERMIT:status",
      digest: "b".repeat(64),
    };
    const input = {
      version: "1",
      observations: [{ permitNumber: "SYN-PERMIT", status }],
    };
    const rows = applyProtectedPermitObservations([base], input, snapshot);
    expect(validateProtectedPermitRow(rows[0], snapshot).permit).toMatchObject({
      issuedAt: "2011-01-01",
      status: "closed",
      statusBasis: "explicit_closed",
      openedAt: null,
      closedAt: "2026-10-27",
    });
    expect(base.observed_at).toBe(stamp);
    for (const observations of [
      [{ permitNumber: "missing", status }],
      [...input.observations, ...input.observations],
      [
        {
          permitNumber: "SYN-PERMIT",
          status: { ...status, sourceUrl: "https://evil.test" },
        },
      ],
      [{ permitNumber: "SYN-PERMIT", ownerName: "unknown" }],
    ])
      expect(() =>
        applyProtectedPermitObservations(
          [base],
          { version: "1", observations },
          snapshot,
        ),
      ).toThrow();
  });
  it("accepts only minimized bound canonical data and never treats issued as open", () => {
    const x = validateProtectedPermitRow(base, snapshot);
    expect(x.permit.status).toBe("unknown");
    expect(x.openDays).toBeNull();
  });
  it("retains non-roof original permit types with conservative typed scope", () => {
    for (const [type, description, kind] of [
      [
        "Commercial, Add/Alter",
        "Re-roof commercial building",
        "roof_replacement",
      ],
      ["Satellite/Antennas", "Install antenna on existing roof", "other"],
    ] as const) {
      const o = normalizeTroyIssued(
        {
          permitNumber: "SYN-PERMIT",
          issuedDate: "Jan 1, 2011",
          siteAddress: "100 EXAMPLE RD",
          applicant: "Synthetic Roofing LLC",
          parcel: "88-20-01-001-001",
          reportedPermitType: type,
          description,
          value: "1000",
        },
        { observedAt: stamp, receiptDigest: "a".repeat(64) },
      );
      const m = matchTroyIssued(o, [
        {
          propertyId: "SYN-P1",
          parcelPin: "2001001001",
          siteAddress: "100 EXAMPLE RD",
          city: "Troy",
        },
      ]);
      expect(
        validateProtectedPermitRow(
          {
            ...base,
            permit_json: JSON.stringify(m.permit),
            record_digest: o.recordDigest,
          },
          snapshot,
        ).permit,
      ).toMatchObject({ reportedPermitType: type, kind });
    }
  });
  it("rejects wrongsnapshot, extraouter/privatekeys, unknown nested keys and absent exact source evidence", () => {
    for (const x of [
      { ...base, public_snapshot_id: "wrong" },
      { ...base, ownerName: "do not retain" },
      {
        ...base,
        permit_json: JSON.stringify({
          ...matched.permit,
          ownerName: "do not retain",
        }),
      },
      {
        ...base,
        permit_json: JSON.stringify({
          ...matched.permit,
          contractor: { ...matched.permit.contractor, phone: "do not retain" },
        }),
      },
      { ...base, record_digest: "b".repeat(64) },
    ])
      expect(() => validateProtectedPermitRow(x, snapshot)).toThrow();
  });
  it("requires explicit status observation/provenance before open duration", () => {
    const open = {
      ...matched.permit,
      status: "open" as const,
      statusBasis: "explicit_open" as const,
      reportedStatus: "Open",
      statusObservedAt: stamp,
      openedAt: "2011-01-01",
      provenance: [
        ...matched.permit.provenance,
        {
          sourceId: "official-troy-permit-status",
          recordId: "SYN-PERMIT",
          observedAt: stamp,
          digest: "b".repeat(64),
          kind: "real-minimized" as const,
        },
      ],
    };
    const x = validateProtectedPermitRow(
      { ...base, permit_json: JSON.stringify(open) },
      snapshot,
    );
    expect(x.openDays).toBeGreaterThan(5 * 365);
    expect(() =>
      validateProtectedPermitRow(
        {
          ...base,
          permit_json: JSON.stringify({
            ...open,
            provenance: matched.permit.provenance,
          }),
        },
        snapshot,
      ),
    ).toThrow();
    expect(
      protectedPermitOpenDays({ ...open, status: "unknown" }, "2026-10-28"),
    ).toBeNull();
    expect(() =>
      validateProtectedPermitRow(
        {
          ...base,
          permit_json: JSON.stringify({
            ...open,
            provenance: [
              ...matched.permit.provenance,
              { ...open.provenance[1], recordId: "DIFFERENT-PERMIT:status" },
            ],
          }),
        },
        snapshot,
      ),
    ).toThrow();
  });
  it("rejects inferred license/rating, credentials in evidenceURL and unclassified names", () => {
    for (const contractor of [
      { ...matched.permit.contractor, license: "12345" },
      { ...matched.permit.contractor, rating: 99 },
      { ...matched.permit.contractor, reportedName: "Jane Example" },
      {
        ...matched.permit.contractor,
        licenseEvidence: {
          identifier: "12345",
          type: "builder",
          status: "active",
          sourceUrl: "https://evil.test/?token=secret",
          observedAt: stamp,
          matchBasis: "notverified",
          confidence: "high",
        },
      },
    ])
      expect(() =>
        validateProtectedPermitRow(
          {
            ...base,
            permit_json: JSON.stringify({ ...matched.permit, contractor }),
          },
          snapshot,
        ),
      ).toThrow();
  });
  it("does not relabel a numeric score as a BBB letter grade", () => {
    expect(() =>
      applyProtectedPermitObservations(
        [base],
        {
          version: "1",
          observations: [
            {
              permitNumber: "SYN-PERMIT",
              rating: {
                value: "100",
                scale: "BBB",
                sourceUrl: "https://www.bbb.org/",
                observedAt: stamp,
                matchConfidence: "medium",
                recordId: "synthetic-business",
                digest: "b".repeat(64),
              },
            },
          ],
        },
        snapshot,
      ),
    ).toThrow();
    expect(() =>
      applyProtectedPermitObservations(
        [base, base],
        { version: "1", observations: [] },
        snapshot,
      ),
    ).toThrow("Duplicate");
  });
  it("rejects oversized and deeply nested JSON before it can become returned evidence", () => {
    expect(() =>
      validateProtectedPermitRow(
        { ...base, permit_json: " ".repeat(17000) },
        snapshot,
      ),
    ).toThrow();
    expect(() =>
      validateProtectedPermitRow(
        {
          ...base,
          permit_json: JSON.stringify({
            ...matched.permit,
            private: {
              a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } },
            },
          }),
        },
        snapshot,
      ),
    ).toThrow();
  });
});
