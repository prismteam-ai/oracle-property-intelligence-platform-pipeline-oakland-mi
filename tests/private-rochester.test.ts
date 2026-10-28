import { it, expect } from "vitest";
import { projectRochesterReportRow } from "../packages/county/src/private-rochester.ts";
import { rhRow, rhSnapshot, rhSchema } from "./private-rochester.fixture.ts";
import { sha256, stableJson } from "../packages/county/src/model.ts";
import { FULL_SOURCE_DEFINITIONS } from "../packages/county/src/private-full-source.ts";
import { validatePrivateManifest } from "../packages/hosted-runtime/src/private-cache.ts";
it.each(["issued", "applied"] as const)(
  "keeps labeled Owner separate from %s events and unlabeled parties",
  (kind) => {
    const p = projectRochesterReportRow(rhRow(1, kind), rhSnapshot, rhSchema);
    expect(p.owner).toMatchObject({
      reportedName: "SYNTHETIC_OWNER_ONLY <escaped>",
      sourceLabel: "Owner",
      ownershipEffectiveDate: null,
      relatedPermitEvent: { kind, date: "2026-09-01" },
      roleVerification: "source_reported_unverified",
    });
    expect(JSON.stringify(p.owner)).not.toContain("SYNTHETIC_UNKNOWN_PARTY");
    expect(JSON.stringify(p.owner)).not.toContain("SYNTHETIC_PHONE");
    if (kind === "applied") expect(p.permit).toBeNull();
    else {
      expect(p.permit).toMatchObject({
        status: "unknown",
        statusBasis: "issued_only",
        openedAt: null,
        closedAt: null,
        contractor: {
          reportedName: null,
          verifiedCompanyId: null,
          license: null,
          rating: null,
        },
        kind: "roof_replacement",
      });
      expect(p.permit).not.toHaveProperty("permitNumber");
      expect(p.openDays).toBeNull();
    }
  },
);
it("retains unassigned raw rows and excludes unlabeled party text from scope classification", () => {
  const row = rhRow();
  row.property_id = null;
  expect(projectRochesterReportRow(row, rhSnapshot, rhSchema)).toMatchObject({
    owner: null,
    permit: null,
  });
  const raw = JSON.parse(row.source_record_json);
  raw.reportedOwnerNameRaw = null;
  raw.workCategoryRaw = null;
  raw.workDescriptionLinesRaw = [];
  raw.sourceGroupHeaderRaw = {
    party: "ROOF REPLACEMENT LLC",
    phone: "SYNTHETIC_PHONE",
  };
  row.property_id = "oakland-parcel-1";
  row.source_record_json = JSON.stringify(raw);
  row.record_digest = sha256(row.source_record_json);
  expect(projectRochesterReportRow(row, rhSnapshot, rhSchema)).toMatchObject({
    owner: null,
    permit: { kind: "other", contractor: { reportedName: null } },
  });
});
it.each([
  { rowSourceRecordId: "fake" },
  { rowOrdinal: 2 },
  { sourcePdfSha256: "b".repeat(64) },
  { sourceObservedAt: "2026-10-28T07:29:16.206Z" },
  { eventDateIso: "2026-10-29" },
  { ownershipEffectiveDate: "2020-01-01" },
  { reportKind: "open" },
  { appliedDateIso: "2026-09-01" },
  { issuedDateIso: null },
  { propertyAddressRaw: null },
])(
  "rejects independently rehashed source identity/date/role defects %#",
  (patch) => {
    const row = rhRow();
    row.source_record_json = JSON.stringify({
      ...JSON.parse(row.source_record_json),
      ...patch,
    });
    row.record_digest = sha256(row.source_record_json);
    expect(() => projectRochesterReportRow(row, rhSnapshot, rhSchema)).toThrow(
      "boundary rejected",
    );
  },
);
it.each([
  { native_id: "1" },
  { record_digest: "b".repeat(64) },
  { public_snapshot_id: "other" },
  { source_schema_sha256: "b".repeat(64) },
  { unexpected: "field" },
])("rejects outer/digest/schema drift %#", (patch) => {
  expect(() =>
    projectRochesterReportRow({ ...rhRow(), ...patch }, rhSnapshot, rhSchema),
  ).toThrow("boundary rejected");
});
it("requires eight version6 roles and prevents silently substituting Rochester into a historical manifest", () => {
  const files = [
    ...[
      ["owner", "owner-derivatives.parquet"],
      ["enrichment", "protected-enrichment.parquet"],
      ["permits", "protected-permits.parquet"],
      ["source-intake", "private-source-intake.parquet"],
    ].map(([role, name]) => ({ role, name, bytes: 1, sha256: "b".repeat(64) })),
    ...Object.entries(FULL_SOURCE_DEFINITIONS).map(([role, d]) => ({
      role,
      name: d.name,
      bytes: 1,
      sha256: "b".repeat(64),
      sourceRecordCount: 2,
      sourceSchemaSha256: rhSchema,
      sourceValidationSha256: "c".repeat(64),
      sourceValidatedOffline: true,
    })),
  ];
  const make = (version: string, f: typeof files) => ({
    version,
    publicSnapshotId: rhSnapshot,
    snapshotId: rhSnapshot,
    files: f,
    digest: sha256(
      stableJson(
        [...f].sort((a, b) =>
          a.name! < b.name! ? -1 : a.name! > b.name! ? 1 : 0,
        ),
      ),
    ),
  });
  validatePrivateManifest(make("6", files), rhSnapshot);
  for (const v of ["4", "5"])
    expect(() => validatePrivateManifest(make(v, files), rhSnapshot)).toThrow();
  for (const f of [
    files.slice(0, 7),
    files.map((x) =>
      x.role === "rochester-source" ? { ...x, sourceRecordCount: 5001 } : x,
    ),
    files.map((x) =>
      x.role === "rochester-source"
        ? { ...x, sourceValidatedOffline: false }
        : x,
    ),
  ])
    expect(() =>
      validatePrivateManifest(make("6", f as typeof files), rhSnapshot),
    ).toThrow();
});

it("preserves raw submillisecond GET time while binding canonical provenance to the same UTC millisecond", () => {
  const row = rhRow();
  const source = JSON.parse(row.source_record_json);
  source.sourceObservedAt = "2026-10-28T07:28:16.206842+00:00";
  row.source_record_json = JSON.stringify(source);
  row.record_digest = sha256(row.source_record_json);
  const p = projectRochesterReportRow(row, rhSnapshot, rhSchema);
  expect(p.source.sourceObservedAt).toBe(source.sourceObservedAt);
  expect(p.owner!.provenance[0]!.observedAt).toBe(row.observed_at);
});
