import { z } from "zod";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const OfficialParcelFieldStateSchema = z.enum([
  "observed_value",
  "observed_null_or_empty",
  "not_observed_in_retained_record",
]);
/** Official source observations are not verified title or inferred contact records. */
export const OfficialParcelObservationSchema = z
  .object({
    canonicalPropertyId: z.string().min(1).max(200),
    sourceId: z.literal("official-oakland-tax-parcel-full-attributes"),
    sourceUrl: z.literal(
      "https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/1",
    ),
    nativeId: z.string().regex(/^\d{1,20}$/),
    pin: z.string().max(200).nullable(),
    name1: z.string().max(2000).nullable(),
    name2: z.string().max(2000).nullable(),
    postalAddressAsObserved: z.string().max(4000).nullable(),
    fieldAvailability: z
      .object({
        NAME1: OfficialParcelFieldStateSchema,
        NAME2: OfficialParcelFieldStateSchema,
        POSTALADDRESS: OfficialParcelFieldStateSchema,
      })
      .strict(),
    observedAt: z.iso.datetime(),
    recordSha256: Hash,
    sourceMetadataSha256: Hash,
    termsSha256: Hash,
    sourceProfileSha256: Hash,
    classification: z.literal("official_public"),
    ownerLocation: z
      .object({
        ownerRegion: z.enum(["regional", "out_of_area", "unknown"]),
        locationClass: z.enum([
          "local",
          "in_county",
          "in_state",
          "out_of_state",
          "unknown",
        ]),
        siteAddressMatch: z.boolean().nullable(),
        evidenceClass: z.enum(["derived_deterministically", "unknown"]),
        basis: z.literal("observed_postal_state_and_exact_site_tokens"),
        derivationVersion: z.literal("postal-state-v2-exact-tokens"),
        sourceRecordSha256: Hash,
      })
      .strict(),
    limitations: z.array(z.string().min(1).max(600)).min(1).max(10),
  })
  .strict()
  .superRefine((row, ctx) => {
    for (const [field, value] of [
      ["NAME1", row.name1],
      ["NAME2", row.name2],
      ["POSTALADDRESS", row.postalAddressAsObserved],
    ] as const) {
      const state = row.fieldAvailability[field];
      if (
        (state === "not_observed_in_retained_record" && value !== null) ||
        (state === "observed_value" && !value?.trim()) ||
        (state === "observed_null_or_empty" && !!value?.trim())
      )
        ctx.addIssue({
          code: "custom",
          message: "Official field value/availability evidence inconsistent",
        });
    }
    if (row.ownerLocation.sourceRecordSha256 !== row.recordSha256)
      ctx.addIssue({
        code: "custom",
        message: "Owner-location derivation must identify its source record",
      });
  });
export type OfficialParcelObservation = z.infer<
  typeof OfficialParcelObservationSchema
>;
