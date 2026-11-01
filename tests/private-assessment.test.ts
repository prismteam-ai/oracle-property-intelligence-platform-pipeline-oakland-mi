import { it, expect } from "vitest";
import { projectAssessmentRow } from "../packages/county/src/private-assessment.ts";
import {
  assessmentRow,
  assessmentSchema,
} from "./private-assessment.fixture.ts";
import { sha256, stableJson } from "../packages/county/src/model.ts";
import { FULL_SOURCE_DEFINITIONS } from "../packages/county/src/private-full-source.ts";
import { validatePrivateManifest } from "../packages/hosted-runtime/src/private-cache.ts";
const snapshot = "oakland-real-" + "a".repeat(20);
it("projects source-exact owner/mail labels and MI postal-state provenance without permit, tenure or ambiguous sale-date claims", () => {
  const p = projectAssessmentRow(
    assessmentRow(snapshot),
    snapshot,
    assessmentSchema,
  );
  expect(p.owners.map((x) => x.sourceLabel)).toEqual([
    "Owner Name 1",
    "Owner Name 2",
  ]);
  expect(
    p.owners.every(
      (x) =>
        x.relatedPermitEvent === null &&
        x.ownershipEffectiveDate === null &&
        x.roleVerification === "source_reported_unverified",
    ),
  ).toBe(true);
  expect(p.owners[0]!.mailingAddress).toEqual({
    street: "SYN_PRIVATE_MAIL_STREET",
    city: "SYN_PRIVATE_MAIL_CITY",
    state: "MI",
    postalCode: "00000",
  });
  expect(JSON.stringify(p.owners)).not.toContain("SYN_TAXPAYER_NOT_OWNER");
  expect(p.location).toMatchObject({
    ownerRegion: "regional",
    locationClass: "in_state",
    siteAddressMatch: null,
    evidenceClass: "derived_deterministically",
  });
  expect(p.builtYear).toBe(2022);
  expect(p.reportedSaleDate).toBeNull();
  expect(p.source.fields["Last Sale Date"]).toBe("07/10/2012");
  expect(p.source.evidenceBasis).toBe(
    "manually_observed_official_ui_transcription",
  );
});
it.each([
  { normalizedCountyPin: "2000000002" },
  { reportType: "Personal Property" },
  { sourceObservedAt: "2026-10-28T09:23:19.029853+00:00" },
  { normalizedLastReportedSaleDate: "2012-07-10" },
  {
    normalizedLastReportedSaleDate: "2012-07-10",
    lastReportedSaleDateFormat: "MM/DD/YYYY",
  },
  { lastReportedSaleDateFormat: "MM/DD/YYYY" },
  { sourceURL: "https://example.invalid" },
  { extra: "field" },
])("rejects source identity/type/date/evidence drift %#", (patch) => {
  const row = assessmentRow(snapshot);
  row.source_record_json = JSON.stringify({
    ...JSON.parse(row.source_record_json),
    ...patch,
  });
  row.record_digest = sha256(row.source_record_json);
  expect(() => projectAssessmentRow(row, snapshot, assessmentSchema)).toThrow(
    "boundary rejected",
  );
});
it.each(["missing", "extra", "wrong-native", "nonstring"])(
  "rejects exact39 field schema defect %s",
  (defect) => {
    const row = assessmentRow(snapshot),
      s = JSON.parse(row.source_record_json);
    if (defect === "missing") delete s.fields.Zoning;
    if (defect === "extra") s.fields.unobserved = "x";
    if (defect === "wrong-native")
      s.fields["Parcel Number"] = "88-20-00-000-002";
    if (defect === "nonstring") s.fields.Acres = 1;
    row.source_record_json = JSON.stringify(s);
    row.record_digest = sha256(row.source_record_json);
    expect(() => projectAssessmentRow(row, snapshot, assessmentSchema)).toThrow(
      "boundary rejected",
    );
  },
);
it("keeps unassigned observations raw, conflicting/zero years unknown and unsupported postal states unknown", () => {
  const row = assessmentRow(snapshot);
  row.property_id = null;
  const s = JSON.parse(row.source_record_json);
  s.fields["Owner State"] = "ON";
  s.fields["Summary Res Year Built"] = "2020";
  row.source_record_json = JSON.stringify(s);
  row.record_digest = sha256(row.source_record_json);
  const p = projectAssessmentRow(row, snapshot, assessmentSchema);
  expect(p.owners).toHaveLength(0);
  expect(p.location.ownerRegion).toBe("unknown");
  expect(p.builtYear).toBeNull();
  expect(p.conflictingBuiltYears).toBe(true);
});
it("requires all nine v7 roles and forbids assessment-role substitution into v6", () => {
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
      sourceRecordCount: 1,
      sourceSchemaSha256: assessmentSchema,
      sourceValidationSha256: "c".repeat(64),
      sourceValidatedOffline: true,
    })),
  ];
  const make = (version: string, f: typeof files) => ({
    version,
    publicSnapshotId: snapshot,
    snapshotId: snapshot,
    files: f,
    digest: sha256(
      stableJson(
        [...f].sort((a, b) =>
          a.name! < b.name! ? -1 : a.name! > b.name! ? 1 : 0,
        ),
      ),
    ),
  });
  validatePrivateManifest(make("7", files), snapshot);
  expect(() => validatePrivateManifest(make("6", files), snapshot)).toThrow();
  expect(() =>
    validatePrivateManifest(make("7", files.slice(0, 8)), snapshot),
  ).toThrow();
  expect(() =>
    validatePrivateManifest(
      make(
        "7",
        files.map((f) =>
          f.role === "assessment-source" ? { ...f, sourceRecordCount: 17 } : f,
        ),
      ),
      snapshot,
    ),
  ).toThrow();
});
