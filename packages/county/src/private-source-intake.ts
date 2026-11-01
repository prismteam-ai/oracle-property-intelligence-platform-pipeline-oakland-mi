import { z } from "zod";
import { sha256, stableJson } from "./model.ts";
import { TROY_SOURCE } from "./troy.ts";
export const PRIVATE_SOURCE_INTAKE_LIMIT = 50_000;
export const TROY_SOURCE_FIELDS = [
  "Permit Type",
  "Permit Number",
  "Date Issued",
  "Address",
  "Applicant",
  "Applicant Address",
  "Applicant City State Zip",
  "Parcel #",
  "Lot",
  "Subdivision",
  "Work Description",
  "Value",
] as const;
export const SOURCE_INTAKE_COLUMNS = [
  "source_id",
  "native_id",
  "source_record_digest",
  "observed_at",
  "public_snapshot_id",
  "source_fields_json",
  "matched_property_id",
  "join_status",
  "source_receipt_digest",
] as const;
const SourceFields = z
  .object({
    "Permit Type": z.string().max(120),
    "Permit Number": z.string().min(1).max(120),
    "Date Issued": z.string().max(40),
    Address: z.string().max(512),
    Applicant: z.string().max(1024),
    "Applicant Address": z.string().max(2048),
    "Applicant City State Zip": z.string().max(1024),
    "Parcel #": z.string().max(120),
    Lot: z.string().max(1024),
    Subdivision: z.string().max(1024),
    "Work Description": z.string().max(16_384),
    Value: z.string().max(256),
  })
  .strict();
const Row = z
  .object({
    source_id: z.literal(TROY_SOURCE),
    native_id: z.string().min(1).max(120),
    source_record_digest: z.string().regex(/^[a-f0-9]{64}$/),
    observed_at: z.iso.datetime(),
    public_snapshot_id: z.string().max(200),
    source_fields_json: z.string().max(32_768),
    matched_property_id: z.string().min(1).max(200).nullable(),
    join_status: z.enum([
      "matched",
      "address_conflict",
      "unmatched",
      "ambiguous",
    ]),
    source_receipt_digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
/** Full source values are private working data, never a Property DTO or model/tool payload. */
export function validatePrivateSourceIntakeRow(
  input: unknown,
  publicSnapshotId: string,
) {
  try {
    const row = Row.parse(input),
      fields = SourceFields.parse(JSON.parse(row.source_fields_json));
    if (
      Buffer.byteLength(row.source_fields_json) > 32_768 ||
      row.public_snapshot_id !== publicSnapshotId ||
      row.native_id !== fields["Permit Number"] ||
      row.source_record_digest !== sha256(stableJson(fields)) ||
      (row.matched_property_id !== null) !== (row.join_status === "matched")
    )
      throw new Error();
    return { row, fields };
  } catch {
    throw new Error("Protected source intake row/schema/binding rejected");
  }
}
export function createPrivateSourceIntakeRow(
  fields: unknown,
  options: {
    publicSnapshotId: string;
    observedAt: string;
    receiptDigest: string;
    matchedPropertyId: string | null;
    joinStatus: "matched" | "address_conflict" | "unmatched" | "ambiguous";
  },
) {
  try {
    const parsed = SourceFields.parse(fields);
    return validatePrivateSourceIntakeRow(
      {
        source_id: TROY_SOURCE,
        native_id: parsed["Permit Number"],
        source_record_digest: sha256(stableJson(parsed)),
        observed_at: options.observedAt,
        public_snapshot_id: options.publicSnapshotId,
        source_fields_json: stableJson(parsed),
        matched_property_id: options.matchedPropertyId,
        join_status: options.joinStatus,
        source_receipt_digest: options.receiptDigest,
      },
      options.publicSnapshotId,
    ).row;
  } catch {
    throw new Error("Protected source intake producer boundary rejected");
  }
}
