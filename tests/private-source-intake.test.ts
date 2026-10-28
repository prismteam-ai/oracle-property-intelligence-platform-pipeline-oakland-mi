import { it, expect } from "vitest";
import {
  createPrivateSourceIntakeRow,
  validatePrivateSourceIntakeRow,
  TROY_SOURCE_FIELDS,
} from "../packages/county/src/private-source-intake.ts";
import { sha256 } from "../packages/county/src/model.ts";
const snapshot = "oakland-real-" + "1".repeat(20);
const fields = {
  "Permit Type": "Res., Roof",
  "Permit Number": "SYN-INTAKE",
  "Date Issued": "Jan 1, 2011",
  Address: "100 Synthetic Road",
  Applicant: "Synthetic Person",
  "Applicant Address": "PRIVATE_SYNTHETIC_MAILING_SENTINEL",
  "Applicant City State Zip": "Synthetic town MI 00000",
  "Parcel #": "88-20-01-001-001",
  Lot: "Synthetic lot",
  Subdivision: "Synthetic subdivision",
  "Work Description": "PRIVATE_SYNTHETIC_RAW_DESCRIPTION_SENTINEL",
  Value: "$1000",
};
const options = {
  publicSnapshotId: snapshot,
  observedAt: "2026-10-28T01:00:00.000Z",
  receiptDigest: sha256("synthetic-source"),
  matchedPropertyId: null,
  joinStatus: "unmatched" as const,
};
it("retains all twelve exact source field values, including people/address/lot/subdivision/raw scope, only in private intake", () => {
  const row = createPrivateSourceIntakeRow(fields, options),
    accepted = validatePrivateSourceIntakeRow(row, snapshot);
  expect(Object.keys(accepted.fields)).toHaveLength(12);
  expect(Object.keys(accepted.fields).sort()).toEqual(
    [...TROY_SOURCE_FIELDS].sort(),
  );
  expect(accepted.fields).toEqual(fields);
  expect(row.matched_property_id).toBeNull();
});
it("rejects missing/extra source fields, changed values/digests, wrong base, and fabricated matched status", () => {
  const row = createPrivateSourceIntakeRow(fields, options);
  for (const candidate of [
    { ...row, public_snapshot_id: "wrong" },
    {
      ...row,
      source_fields_json: JSON.stringify({ ...fields, Applicant: "changed" }),
    },
    {
      ...row,
      source_fields_json: JSON.stringify({
        ...fields,
        privateExtra: "notallowed",
      }),
    },
    {
      ...row,
      source_fields_json: JSON.stringify(
        Object.fromEntries(Object.entries(fields).filter(([k]) => k !== "Lot")),
      ),
    },
    { ...row, matched_property_id: "SYN-P1" },
    { ...row, native_id: "OTHER" },
    { ...row, source_record_digest: "b".repeat(64) },
    { ...row, extra: "notallowed" },
  ])
    expect(() => validatePrivateSourceIntakeRow(candidate, snapshot)).toThrow(
      "rejected",
    );
});
