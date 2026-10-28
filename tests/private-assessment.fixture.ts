import { ASSESSMENT_FIELDS } from "../packages/county/src/private-assessment.ts";
import { FULL_SOURCE_DEFINITIONS } from "../packages/county/src/private-full-source.ts";
import { sha256 } from "../packages/county/src/model.ts";
export const assessmentSchema = sha256("synthetic-ui-assessment-schema");
export function assessmentRow(snapshotId: string) {
  const fields = Object.fromEntries(ASSESSMENT_FIELDS.map((k) => [k, ""]));
  Object.assign(fields, {
    "Parcel Number": "88-20-00-000-001",
    "Property Address": "Synthetic site 3",
    "Owner Name 1": "SYN_ASSESSMENT_OWNER",
    "Owner Name 2": "SYN_SECOND_OWNER",
    "Owner Street Address": "SYN_PRIVATE_MAIL_STREET",
    "Owner City": "SYN_PRIVATE_MAIL_CITY",
    "Owner State": "MI",
    "Owner Zip Code": "00000",
    "Summary CI Year Built": "2022",
    "Summary Res Year Built": "0",
    "Last Sale Date": "07/10/2012",
    "Taxpayer Street Addr": "SYN_TAXPAYER_NOT_OWNER",
  });
  const source = {
    evidenceBasis: "manually_observed_official_ui_transcription",
    reportType: "Real Property Assessing Report",
    sourceURL:
      "https://apps.troymi.gov/ParcelInformationCenter/AssessingReport",
    sourceObservedAt: "2026-10-28T08:23:19.029853+00:00",
    captureSha256: sha256("synthetic-exact-ui-transcription-not-http-body"),
    fields,
    normalizedCountyPin: "2000000001",
    normalizedLastReportedSaleDate: null,
    lastReportedSaleDateFormat: null,
  };
  const def = FULL_SOURCE_DEFINITIONS["assessment-source"],
    json = JSON.stringify(source);
  return {
    version: def.version,
    source_id: def.sourceId,
    native_id: fields["Parcel Number"]!,
    public_snapshot_id: snapshotId,
    source_schema_sha256: assessmentSchema,
    source_record_json: json,
    record_digest: sha256(json),
    observed_at: new Date(source.sourceObservedAt).toISOString(),
    property_id: "oakland-parcel-3" as string | null,
  };
}
