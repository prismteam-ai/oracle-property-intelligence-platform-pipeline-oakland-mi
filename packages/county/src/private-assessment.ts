import { z } from "zod";
import { PropertySchema } from "../../contracts/src/index.ts";
import { FULL_SOURCE_DEFINITIONS } from "./private-full-source.ts";
import { sha256 } from "./model.ts";
import { normalizeTroyPin } from "./troy.ts";
export const ASSESSMENT_FIELDS = [
  "Acres",
  "Depth of Parcel",
  "Frontage",
  "Last Sale Amount",
  "Last Sale Date",
  "Legal Description",
  "Neighborhood Code",
  "Num CI Buildings",
  "Num Res Buildings",
  "Owner City",
  "Owner Name 1",
  "Owner Name 2",
  "Owner State",
  "Owner Street Address",
  "Owner Zip Code",
  "Parcel Number",
  "Principal Residence Exemption",
  "Principal Residence Exemption Date",
  "Property Address",
  "Property Address Apt",
  "Property Address Zip",
  "Property Class",
  "School District",
  "State Equalized Value (SEV)",
  "Summary CI Floor Area",
  "Summary CI Stories",
  "Summary CI Year Built",
  "Summary Land Value",
  "Summary Res Basement Area",
  "Summary Res Floor Area",
  "Summary Res Garage Area",
  "Summary Res Num Bed",
  "Summary Res Num Full Bath",
  "Summary Res Num Half Bath",
  "Summary Res Style Alph",
  "Summary Res Year Built",
  "Taxable Value",
  "Taxpayer Street Addr",
  "Zoning",
] as const;
const definition = FULL_SOURCE_DEFINITIONS["assessment-source"];
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const Envelope = z
  .object({
    version: z.literal(definition.version),
    source_id: z.literal(definition.sourceId),
    native_id: z.string().regex(/^[0-9-]{10,20}$/),
    public_snapshot_id: z.string(),
    source_schema_sha256: hash,
    source_record_json: z.string(),
    record_digest: hash,
    observed_at: z.iso.datetime(),
    property_id: z.string().min(1).max(200).nullable(),
  })
  .strict();
const Source = z
  .object({
    evidenceBasis: z.literal("manually_observed_official_ui_transcription"),
    reportType: z.literal("Real Property Assessing Report"),
    sourceURL: z.literal(
      "https://apps.troymi.gov/ParcelInformationCenter/AssessingReport",
    ),
    sourceObservedAt: z.iso.datetime({ offset: true }),
    captureSha256: hash,
    fields: z.record(z.string(), z.string().max(16000)),
    normalizedCountyPin: z.string().regex(/^[0-9]{10}$/),
    // This exact source version has no displayed date-format label.
    // Ambiguous slash dates stay raw and cannot be resolved by a producer declaration.
    normalizedLastReportedSaleDate: z.null(),
    lastReportedSaleDateFormat: z.null(),
  })
  .strict();
const Owner =
  PropertySchema.shape.ownership.shape.reportedOwnerObservations.unwrap()
    .element;
const knownStates = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
    " ",
  ),
);
const optionalText = (v: string) => (v.trim() ? v : null);
/** A single normal UI observation is not an HTTP-body capture or a bulk source. */
export function projectAssessmentRow(
  input: unknown,
  snapshotId: string,
  schemaSha256: string,
) {
  try {
    const row = Envelope.parse(input);
    if (
      row.public_snapshot_id !== snapshotId ||
      row.source_schema_sha256 !== schemaSha256 ||
      Buffer.byteLength(row.source_record_json) > 128 * 1024 ||
      sha256(row.source_record_json) !== row.record_digest
    )
      throw Error();
    const source = Source.parse(JSON.parse(row.source_record_json));
    if (
      Object.keys(source.fields).length !== ASSESSMENT_FIELDS.length ||
      ASSESSMENT_FIELDS.some((k) => !Object.hasOwn(source.fields, k)) ||
      row.native_id !== source.fields["Parcel Number"] ||
      normalizeTroyPin(row.native_id) !== source.normalizedCountyPin ||
      new Date(source.sourceObservedAt).toISOString() !==
        new Date(row.observed_at).toISOString()
    )
      throw Error();
    const provenance = [
      {
        sourceId: row.source_id,
        recordId: row.native_id,
        observedAt: row.observed_at,
        digest: row.record_digest,
        kind: "real-minimized" as const,
      },
    ];
    const owners = row.property_id
      ? ["Owner Name 1", "Owner Name 2"].flatMap((label) => {
          const name = source.fields[label]!;
          return name.trim()
            ? [
                Owner.parse({
                  reportedName: name,
                  sourceLabel: label,
                  relatedPermitEvent: null,
                  mailingAddress: {
                    street: optionalText(
                      source.fields["Owner Street Address"]!,
                    ),
                    city: optionalText(source.fields["Owner City"]!),
                    state: optionalText(source.fields["Owner State"]!),
                    postalCode: optionalText(source.fields["Owner Zip Code"]!),
                  },
                  ownershipEffectiveDate: null,
                  roleVerification: "source_reported_unverified",
                  provenance,
                  limitations: [
                    "Source-labeled owner and mailing fields were transcribed from one normal official assessment UI record; no server response body was captured.",
                    "The observation does not verify current legal ownership, residence, a transfer event or uninterrupted tenure. Mailing fields describe the report record, not separate verified addresses for each named party.",
                    "No permit event is supplied by this assessment observation. Taxpayer fields remain separate raw source fields.",
                  ],
                }),
              ]
            : [];
        })
      : [];
    const state = source.fields["Owner State"]!.trim().toUpperCase();
    const region =
      state === "MI"
        ? {
            ownerRegion: "regional" as const,
            locationClass: "in_state" as const,
          }
        : knownStates.has(state)
          ? {
              ownerRegion: "out_of_area" as const,
              locationClass: "out_of_state" as const,
            }
          : {
              ownerRegion: "unknown" as const,
              locationClass: "unknown" as const,
            };
    const years = [
      ...new Set(
        ["Summary CI Year Built", "Summary Res Year Built"]
          .map((k) => source.fields[k]!.trim())
          .filter((v) => /^\d{4}$/.test(v))
          .map(Number)
          .filter((n) => n >= 1600 && n <= Number(row.observed_at.slice(0, 4))),
      ),
    ];
    return {
      row,
      source,
      owners,
      provenance,
      location: {
        ...region,
        siteAddressMatch: null,
        observedAt: row.observed_at,
        evidenceClass:
          region.ownerRegion === "unknown"
            ? ("unknown" as const)
            : ("derived_deterministically" as const),
      },
      builtYear: years.length === 1 ? years[0]! : null,
      conflictingBuiltYears: years.length > 1,
      reportedSaleDate: source.normalizedLastReportedSaleDate,
    };
  } catch {
    throw Error("Protected assessment UI source/projection boundary rejected");
  }
}
