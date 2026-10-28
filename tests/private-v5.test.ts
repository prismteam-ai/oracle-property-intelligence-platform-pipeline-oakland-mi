import { it, expect } from "vitest";
import { validatePrivateManifest } from "../packages/hosted-runtime/src/private-cache.ts";
import { privateEmulationEnvironment } from "../packages/hosted-runtime/src/private-emulation-env.ts";
import {
  FULL_SOURCE_DEFINITIONS,
  parseFullSourceConfigs,
  type FullSourceConfig,
} from "../packages/county/src/private-full-source.ts";
import { validateProtectedPermitRow } from "../packages/county/src/private-permits.ts";
import { sha256, stableJson } from "../packages/county/src/model.ts";
import { TROY_SCOPE_CLASSIFICATIONS } from "../packages/county/src/troy.ts";
const snapshot = "oakland-real-" + "a".repeat(20),
  stamp = "2026-10-28T06:00:00.000Z";
it("requires all seven v5 roles and pins municipal proof metadata and bounded intake", () => {
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
      sha256: "c".repeat(64),
      sourceSchemaSha256: "d".repeat(64),
      sourceRecordCount: role === "municipal-source" ? 33014 : 2,
      sourceValidationSha256: "e".repeat(64),
      sourceValidatedOffline: true,
    })),
  ];
  const make = (f: { name: string }[]) => ({
    version: "5",
    publicSnapshotId: snapshot,
    snapshotId: snapshot,
    files: f,
    digest: sha256(
      stableJson(
        [...f].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
      ),
    ),
  });
  const valid = make(files);
  validatePrivateManifest(valid, snapshot);
  const env = privateEmulationEnvironment(valid);
  expect(JSON.parse(env.PRISM_PRIVATE_FULL_SOURCES!)).toHaveLength(3);
  expect(
    (JSON.parse(env.PRISM_PRIVATE_FULL_SOURCES!) as FullSourceConfig[]).find(
      (f) => f.role === "municipal-source",
    )!.file,
  ).toBe("/protected/municipal-permit-source.parquet");
  for (const changed of [
    files.slice(0, 6),
    files.map((f) =>
      f.role === "municipal-source"
        ? { ...f, sourceValidatedOffline: false }
        : f,
    ),
    files.map((f) =>
      f.role === "municipal-source" ? { ...f, sourceRecordCount: 50001 } : f,
    ),
    files.map((f) =>
      f.role === "municipal-source"
        ? { ...f, name: "county-parcels.parquet" }
        : f,
    ),
  ])
    expect(() => validatePrivateManifest(make(changed), snapshot)).toThrow();
  const config = (
    JSON.parse(env.PRISM_PRIVATE_FULL_SOURCES!) as FullSourceConfig[]
  ).find((f) => f.role === "municipal-source");
  expect(() =>
    parseFullSourceConfigs([{ ...config, sourceRecordCount: 50001 }]),
  ).toThrow();
});
it("preserves exact municipal literals and rejects invented lifecycle, parties and provenance", () => {
  const source = "official-independence-public-permits",
    native = "987654";
  const make = (status: string) => {
    const closed = status === "CLOSED";
    const permit = {
      id: "independence-public-" + sha256(native).slice(0, 24),
      permitNumber: "SYN-ONLY",
      jurisdiction:
        "Charter Township of Independence, Oakland County, Michigan",
      issuedAt: "2020-01-01",
      status: closed ? "closed" : "unknown",
      statusBasis: closed ? "explicit_closed" : "unknown",
      reportedStatus: status,
      statusObservedAt: stamp,
      reportedPermitType: "Building",
      ...TROY_SCOPE_CLASSIFICATIONS.explicit_roof_type_replacement,
      openedAt: null,
      closedAt: null,
      contractor: {
        reportedName: null,
        verifiedCompanyId: null,
        license: null,
        rating: null,
      },
      matchEvidence: {
        basis: "exact_normalized_parcel",
        confidence: "medium",
        score: 0.9,
        candidateCount: 1,
        addressAgreement: "unknown",
        caveats: ["Synthetic boundary fixture only"],
      },
      provenance: [
        {
          sourceId: source,
          recordId: native,
          observedAt: stamp,
          digest: "f".repeat(64),
          kind: "real-minimized",
        },
      ],
    };
    return {
      property_id: "SYN-P1",
      permit_json: JSON.stringify(permit),
      public_snapshot_id: snapshot,
      source_id: source,
      native_id: native,
      record_digest: "f".repeat(64),
      observed_at: stamp,
    };
  };
  for (const s of [
    "CLOSED",
    "FINALED",
    "ISSUED",
    "EXPIRED",
    "CANCELED",
    "HOLD (PREREQ)",
    "SUSPENDED (FEE)",
  ]) {
    const result = validateProtectedPermitRow(make(s), snapshot);
    expect(result.permit.status).toBe(s === "CLOSED" ? "closed" : "unknown");
    expect(result.openDays).toBeNull();
  }
  for (const s of ["OPEN", "HOLD", "SUSPENDED", "Finaled"])
    expect(() => validateProtectedPermitRow(make(s), snapshot)).toThrow();
  for (const patch of [
    { status: "open", statusBasis: "explicit_open", openedAt: "2020-01-01" },
    { closedAt: "2021-01-01" },
    {
      contractor: {
        reportedName: "Applicant",
        verifiedCompanyId: "invented",
        license: null,
        rating: null,
      },
    },
    { provenance: [] },
  ]) {
    const row = make("FINALED");
    row.permit_json = JSON.stringify({
      ...JSON.parse(row.permit_json),
      ...patch,
    });
    expect(() => validateProtectedPermitRow(row, snapshot)).toThrow();
  }
});
