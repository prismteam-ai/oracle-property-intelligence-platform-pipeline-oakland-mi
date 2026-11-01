import { expect, test } from "vitest";
import {
  OfficialParcelObservationSchema,
  PropertySchema,
} from "../packages/contracts/src/index.ts";
import {
  projectOfficialParcelObservation,
  parsePinnedOfficialParcelProfile,
  validateOfficialParcelProfile,
  OFFICIAL_PARCEL_URL,
} from "../packages/county/src/official-parcel.ts";
import {
  sourceFieldProfileDigest,
  validateSourceFieldProfile,
  eligiblePublicationFields,
} from "../packages/source-profiles/src/field-authority.ts";
import { sha256 } from "../packages/county/src/model.ts";
import { syntheticProperties } from "../packages/test-support/src/fixtures.ts";

import {
  officialProfileFixture,
  source,
  snapshot,
  observedAt,
} from "./official-parcel.fixture.ts";

test("profile parsing checks the exact held bytes rather than an earlier path read", () => {
  const expected = Buffer.from(JSON.stringify(officialProfileFixture()));
  expect(parsePinnedOfficialParcelProfile(expected, sha256(expected))).toEqual(
    officialProfileFixture(),
  );
  expect(() =>
    parsePinnedOfficialParcelProfile(
      Buffer.from("replacement body"),
      sha256(expected),
    ),
  ).toThrow("body integrity");
  expect(() => parsePinnedOfficialParcelProfile(expected, undefined)).toThrow(
    "body integrity",
  );
});

function record(attributes: Record<string, unknown>) {
  const source_record_json = JSON.stringify({ OBJECTID_12: 1, ...attributes });
  return {
    property_id: "oakland-parcel-1",
    native_id: "1",
    source_record_json,
    record_digest: sha256(source_record_json),
    observed_at: observedAt,
  };
}

test("official owner fields are source/terms classified rather than categorically rejected", () => {
  const envelope = officialProfileFixture();
  validateSourceFieldProfile(envelope.profile, {
    sourceUrl: OFFICIAL_PARCEL_URL,
    termsSha256: envelope.profile.termsSha256,
    fieldClassificationDigest: envelope.fieldClassificationDigest,
    requestedFields: ["NAME1", "NAME2", "POSTALADDRESS"],
  });
  expect(eligiblePublicationFields(envelope.profile)).toEqual(
    expect.arrayContaining(["NAME1", "NAME2", "POSTALADDRESS"]),
  );
  expect(envelope.availability.fields.PHONE?.state).toBe("NOT_IN_SOURCE");
  expect(envelope.availability.currentParcelRows).not.toBe(
    envelope.sourceRecordCount,
  );
  expect(envelope.availability.wholePopulationTrimmedNonEmptyCount).toBeNull();
});

test("missing, stale or wrong-source field/terms contracts cannot authorize reads", () => {
  const envelope = officialProfileFixture();
  for (const changed of [
    { ...envelope, sourceFileSha256: sha256("different source file") },
    { ...envelope, sourceSchemaSha256: sha256("different source schema") },
    { ...envelope, publicSnapshotId: "different" },
    {
      ...envelope,
      fieldClassificationDigest: sha256("different classification"),
    },
  ])
    expect(() =>
      validateOfficialParcelProfile(changed, source, snapshot),
    ).toThrow();
  expect(() =>
    validateSourceFieldProfile(envelope.profile, {
      sourceUrl: OFFICIAL_PARCEL_URL,
      termsSha256: sha256("different terms"),
      fieldClassificationDigest: envelope.fieldClassificationDigest,
      requestedFields: ["NAME1"],
    }),
  ).toThrow();
  expect(() =>
    validateSourceFieldProfile(envelope.profile, {
      sourceUrl: OFFICIAL_PARCEL_URL,
      termsSha256: envelope.profile.termsSha256,
      fieldClassificationDigest: envelope.fieldClassificationDigest,
      requestedFields: ["PHONE"],
    }),
  ).toThrow("absent");
});

test("null and absent source values remain distinguishable without invented names or parsed contacts", () => {
  const profile = officialProfileFixture();
  const row = projectOfficialParcelObservation(
    record({ PIN: "0001", NAME1: null, POSTALADDRESS: null }),
    profile,
  );
  expect(row.name1).toBeNull();
  expect(row.name2).toBeNull();
  expect(row.postalAddressAsObserved).toBeNull();
  expect(row.fieldAvailability.NAME1).toBe("observed_null_or_empty");
  expect(row.fieldAvailability.NAME2).toBe("not_observed_in_retained_record");
  expect(row.ownerLocation.ownerRegion).toBe("unknown");
  expect(Object.keys(row)).not.toContain("phone");
  expect(Object.keys(row)).not.toContain("email");
});

test("raw official mailing/name strings retain provenance and the regional derivation basis", () => {
  const profile = officialProfileFixture();
  const raw = "  1 SYNTHETIC ROAD, SYNTHETIC CITY CA 00000  ";
  const observed = record({
    PIN: "0001",
    NAME1: "SYNTHETIC PUBLIC REPORTED PARTY",
    NAME2: null,
    POSTALADDRESS: raw,
    SITEADDRESS: "1 SYNTHETIC ROAD",
    SITECITY: "SYNTHETIC CITY",
  });
  const row = projectOfficialParcelObservation(observed, profile);
  expect(row.postalAddressAsObserved).toBe(raw);
  expect(row.name1).toBe("SYNTHETIC PUBLIC REPORTED PARTY");
  expect(row.ownerLocation.ownerRegion).toBe("out_of_area");
  expect(row.ownerLocation.sourceRecordSha256).toBe(row.recordSha256);
  expect(row.observedAt).toBe(observedAt);
  expect(row.termsSha256).toBe(profile.profile.termsSha256);
  expect(row).not.toHaveProperty("mailingAddress");
  const base = syntheticProperties()[0]!;
  expect(
    PropertySchema.parse({
      ...base,
      id: observed.property_id,
      ownership: { ...base.ownership, officialParcelObservation: row },
    }).ownership.officialParcelObservation,
  ).toEqual(row);
  expect(() =>
    PropertySchema.parse({
      ...base,
      ownership: { ...base.ownership, officialParcelObservation: row },
    }),
  ).toThrow("binding");
});

test("restricted provider fields and credentials do not become eligible public fields", () => {
  const envelope = officialProfileFixture();
  envelope.profile.fields.RESTRICTED_VALUE = {
    classification: "restricted_source",
    exposed: true,
    acquisitionAllowed: true,
    runtimeAllowed: true,
    publication: "source_terms_restricted",
  };
  envelope.profile.fields.API_KEY = {
    classification: "credential",
    exposed: true,
    acquisitionAllowed: false,
    runtimeAllowed: false,
    publication: "excluded",
  };
  envelope.fieldClassificationDigest = sourceFieldProfileDigest(
    envelope.profile,
  );
  validateOfficialParcelProfile(envelope, source, snapshot);
  expect(eligiblePublicationFields(envelope.profile)).not.toContain(
    "RESTRICTED_VALUE",
  );
  expect(eligiblePublicationFields(envelope.profile)).not.toContain("API_KEY");
  expect(() =>
    validateSourceFieldProfile(envelope.profile, {
      sourceUrl: OFFICIAL_PARCEL_URL,
      termsSha256: envelope.profile.termsSha256,
      fieldClassificationDigest: envelope.fieldClassificationDigest,
      requestedFields: ["API_KEY"],
    }),
  ).toThrow();
  envelope.profile.fields.NAME1 = {
    classification: "restricted_source",
    exposed: true,
    acquisitionAllowed: true,
    runtimeAllowed: false,
    publication: "source_terms_restricted",
  };
  envelope.fieldClassificationDigest = sourceFieldProfileDigest(
    envelope.profile,
  );
  expect(() =>
    projectOfficialParcelObservation(
      record({ NAME1: "SYNTHETIC RESTRICTED", POSTALADDRESS: null }),
      envelope,
    ),
  ).toThrow("runtime permission");
});

test("record hash, scalar type and observation-state drift cannot fabricate owner facts", () => {
  const profile = officialProfileFixture();
  expect(() =>
    projectOfficialParcelObservation(
      {
        ...record({ POSTALADDRESS: "SYNTHETIC" }),
        record_digest: sha256("wrong"),
      },
      profile,
    ),
  ).toThrow("digest");
  expect(() =>
    projectOfficialParcelObservation(
      record({ NAME1: { invented: true } }),
      profile,
    ),
  ).toThrow("source string");
  expect(() =>
    projectOfficialParcelObservation(record({ OBJECTID_12: 2 }), profile),
  ).toThrow("association");
  const good = projectOfficialParcelObservation(
    record({ NAME1: null }),
    profile,
  );
  expect(() =>
    OfficialParcelObservationSchema.parse({ ...good, name1: "INVENTED" }),
  ).toThrow();
  expect(() =>
    OfficialParcelObservationSchema.parse({ ...good, phone: "INVENTED" }),
  ).toThrow();
});
