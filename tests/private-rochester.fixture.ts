import { sha256 } from "../packages/county/src/model.ts";
import { FULL_SOURCE_DEFINITIONS } from "../packages/county/src/private-full-source.ts";
export const rhSnapshot = "oakland-real-" + "a".repeat(20);
export const rhSchema = sha256("synthetic-report-schema-only");
export function rhRow(ordinal = 1, kind: "issued" | "applied" = "issued") {
  const pdf = sha256("synthetic-report-pdf-only");
  const observed = "2026-10-28T07:28:16.206Z";
  const source = {
    rowOrdinal: ordinal,
    rowSourceRecordId: `${pdf}:row:${ordinal}`,
    sourcePdfSha256: pdf,
    reportKind: kind,
    eventDateIso: "2026-09-01",
    issuedDateIso: kind === "issued" ? "2026-09-01" : null,
    appliedDateIso: kind === "applied" ? "2026-09-01" : null,
    reportedOwnerNameRaw: "SYNTHETIC_OWNER_ONLY <escaped>",
    ownershipEffectiveDate: null,
    propertyAddressRaw: "Synthetic site 1",
    workCategoryRaw: "Residential building",
    workDescriptionLinesRaw: ["Replace roof shingles"],
    sourceObservedAt: observed,
    sourceGroupHeaderRaw: {
      party: "SYNTHETIC_UNKNOWN_PARTY",
      phone: "SYNTHETIC_PHONE",
    },
  };
  const definition = FULL_SOURCE_DEFINITIONS["rochester-source"];
  const json = JSON.stringify(source);
  return {
    version: definition.version,
    source_id: definition.sourceId,
    native_id: source.rowSourceRecordId,
    public_snapshot_id: rhSnapshot,
    source_schema_sha256: rhSchema,
    source_record_json: json,
    record_digest: sha256(json),
    observed_at: observed,
    property_id: "oakland-parcel-1" as string | null,
  };
}
