import { z } from "zod";
import {
  ProviderPermitObservationSchema,
  RecordedTransferIndexObservationSchema,
  ProviderPermitStatusSchema,
  PermitActivityClaimSchema,
} from "./source-observations.ts";
export * from "./source-observations.ts";
import { OfficialParcelObservationSchema } from "./official-parcel-observation.ts";
export * from "./official-parcel-observation.ts";
export const CONTRACT_VERSION = "0.6.0" as const;
export const EvidenceState = z.enum([
  "confirmed_present",
  "confirmed_empty",
  "unavailable",
  "stale",
  "conflicting",
  "invalid_quarantined",
  "unknown",
]);
export const ObservationClass = z.enum([
  "source_reported",
  "derived_deterministically",
  "matched_with_evidence",
  "unknown",
  "not_available",
  "terms_blocked",
  "access_blocked",
  "not_in_source_scope",
]);
export const ProvenanceSchema = z.object({
  sourceId: z.string(),
  recordId: z.string(),
  observedAt: z.iso.datetime(),
  digest: z.string(),
  kind: z.enum(["synthetic", "real-minimized", "real-public"]),
});
export const PermitSchema = z.object({
  sourceObservations: z
    .array(ProviderPermitObservationSchema)
    .max(20)
    .optional(),
  id: z.string(),
  status: z.enum(["open", "closed", "unknown"]),
  kind: z.enum([
    "roof_replacement",
    "roof_repair",
    "roof_unspecified",
    "other",
  ]),
  permitNumber: z.string().max(120).optional(),
  jurisdiction: z.string().max(120).optional(),
  issuedAt: z.iso.date().nullable().optional(),
  statusBasis: z
    .enum(["issued_only", "explicit_open", "explicit_closed", "unknown"])
    .optional(),
  reportedStatus: z.string().max(120).nullable().optional(),
  reportedPermitType: z.string().max(120).optional(),
  proposedWorkScope: z.string().max(300).optional(),
  statusObservedAt: z.iso.datetime().optional(),
  matchEvidence: z
    .object({
      basis: z.enum([
        "exact_normalized_parcel",
        "exact_normalized_site_address",
        "unmatched",
        "ambiguous",
      ]),
      confidence: z.enum(["high", "medium", "low", "unknown"]),
      score: z.number().min(0).max(1),
      candidateCount: z.number().int().nonnegative(),
      addressAgreement: z.enum(["agrees", "differs", "unknown"]),
      caveats: z.array(z.string().max(300)).max(10),
    })
    .optional(),
  openedAt: z.iso.date().nullable(),
  closedAt: z.iso.date().nullable(),
  contractor: z.object({
    reportedName: z.string().nullable(),
    verifiedCompanyId: z.string().nullable(),
    license: z.string().nullable(),
    rating: z.number().min(0).max(100).nullable(),
    licenseEvidence: z
      .object({
        identifier: z.string().max(120),
        type: z.string().max(200),
        status: z.string().max(120),
        sourceUrl: z.string().url(),
        observedAt: z.iso.datetime(),
        matchBasis: z.string().max(300),
        confidence: z.enum(["high", "medium", "low", "unknown"]),
      })
      .nullable()
      .optional(),
    ratingEvidence: z
      .object({
        value: z.string().max(40),
        scale: z.literal("BBB"),
        sourceUrl: z.string().url(),
        observedAt: z.iso.datetime(),
        matchConfidence: z.enum(["high", "medium", "low", "unknown"]),
      })
      .nullable()
      .optional(),
  }),
  provenance: z.array(ProvenanceSchema),
});
export const CoordinateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export const SiteAddressSchema = z.object({
  id: z.string(),
  nativeId: z.string(),
  address: z.string(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
  coordinates: CoordinateSchema.nullable(),
  provenance: z.array(ProvenanceSchema),
});
export const PropertySchema = z
  .object({
    id: z.string(),
    nativeId: z.string(),
    parcelIds: z.array(z.string()),
    address: z.string(),
    parcelIdentifiers: z
      .object({ pin: z.string().nullable(), keypin: z.string().nullable() })
      .optional(),
    jurisdiction: z
      .object({ code: z.string().nullable(), name: z.string().nullable() })
      .optional(),
    sourceRevisionDate: z.string().nullable().optional(),
    siteAddresses: z.array(SiteAddressSchema).optional(),
    siteAddressCount: z.number().int().nonnegative().optional(),
    siteAddressesTruncated: z.boolean().optional(),
    coordinateBasis: z
      .enum([
        "official_site_address",
        "nearest_official_site_address",
        "unknown",
      ])
      .optional(),
    evidenceClass: ObservationClass.optional(),
    usage: z.enum(["residential", "commercial", "condominium", "unknown"]),
    coordinates: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .nullable(),
    roof: z.object({
      ageYears: z.number().int().nonnegative().nullable(),
      basis: z.enum([
        "completed_roof",
        "completed_construction",
        "built_year",
        "unknown",
      ]),
      confidence: z.enum(["high", "medium", "low", "unknown"]),
      asOf: z.iso.date(),
      caveats: z.array(z.string()),
      provenance: z.array(ProvenanceSchema).optional(),
      evidenceClass: ObservationClass.optional(),
    }),
    permits: z.array(PermitSchema),
    ownership: z.object({
      officialParcelObservation: OfficialParcelObservationSchema.optional(),
      recordedTransferIndexObservations: z
        .array(RecordedTransferIndexObservationSchema)
        .max(20)
        .optional(),
      reportedOwnerObservations: z
        .array(
          z
            .object({
              reportedName: z.string().min(1).max(2000),
              sourceLabel: z.enum(["Owner", "Owner Name 1", "Owner Name 2"]),
              relatedPermitEvent: z
                .object({
                  kind: z.enum(["issued", "applied"]),
                  date: z.iso.date(),
                })
                .strict()
                .nullable(),
              mailingAddress: z
                .object({
                  street: z.string().max(2000).nullable(),
                  city: z.string().max(2000).nullable(),
                  state: z.string().max(2000).nullable(),
                  postalCode: z.string().max(2000).nullable(),
                })
                .strict()
                .optional(),
              ownershipEffectiveDate: z.null(),
              roleVerification: z.literal("source_reported_unverified"),
              provenance: z.array(ProvenanceSchema).min(1).max(10),
              limitations: z.array(z.string().max(500)).min(1).max(10),
            })
            .strict(),
        )
        .max(256)
        .optional(),
      locationProvenance: z.array(ProvenanceSchema).min(1).max(10).optional(),
      lastTransferDate: z.iso.date().nullable(),
      events: z
        .array(
          z.object({
            id: z.string(),
            kind: z.enum(["reported_sale", "recorded_transfer"]),
            date: z.iso.date(),
            provenance: z.array(ProvenanceSchema),
          }),
        )
        .optional(),
      historyCoverage: z.enum(["full", "partial", "unknown"]),
      transferHistoryCoverage: z
        .object({
          state: z.enum(["full", "partial", "unknown"]),
          from: z.iso.date().nullable(),
          through: z.iso.date().nullable(),
          provenance: z.array(ProvenanceSchema),
          limitations: z.array(z.string()),
        })
        .optional(),
      uninterruptedTenure: z
        .object({
          state: z.enum(["supported", "insufficient_history", "unknown"]),
          unchangedSince: z.iso.date().nullable(),
          asOf: z.iso.date(),
          provenance: z.array(ProvenanceSchema),
        })
        .optional(),
      ownerRegion: z.enum(["regional", "out_of_area", "unknown"]),
      locationClass: z
        .enum(["local", "in_county", "in_state", "out_of_state", "unknown"])
        .optional(),
      siteAddressMatch: z.boolean().nullable().optional(),
      observedAt: z.iso.datetime().nullable().optional(),
      evidenceClass: ObservationClass.optional(),
    }),
    provenance: z.array(ProvenanceSchema),
  })
  .superRefine((property, ctx) => {
    if (
      (property.ownership.officialParcelObservation !== undefined &&
        property.ownership.officialParcelObservation.canonicalPropertyId !==
          property.id) ||
      property.permits.some((permit) =>
        (permit.sourceObservations ?? []).some(
          (row) => row.canonicalPropertyId !== property.id,
        ),
      ) ||
      (property.ownership.recordedTransferIndexObservations ?? []).some(
        (row) => row.canonicalPropertyId !== property.id,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Source observation canonical property binding rejected",
      });
  });
export type Property = z.infer<typeof PropertySchema>;
export type Permit = z.infer<typeof PermitSchema>;
/** Official Oakland municipal geography; coordinates are deterministic source-derived points. */
export const PlaceReferenceSchema = z.object({
  placeId: z.string().min(1).max(160),
  name: z.string().min(1).max(120),
  type: z.string().min(1).max(120),
  stateFips: z.string().min(1).max(10),
  countyFips: z.string().min(1).max(10),
  localFips: z.string().min(1).max(20).nullable(),
  geometrySha256: z.string().regex(/^[a-f0-9]{64}$/),
  centroid: CoordinateSchema,
  center: CoordinateSchema,
  centerMethod: z.string().min(1).max(300),
  aliases: z.array(z.string().min(1).max(200)).max(30),
  sourceRecordId: z.string().min(1).max(120),
  resolutionEligible: z.boolean(),
  limitations: z.array(z.string().max(500)).max(20),
  sourceUrl: z.url(),
  observedAt: z.iso.datetime(),
  aliasEvidence: z
    .array(
      z.object({
        sourceUrl: z.url(),
        responseSha256: z.string().regex(/^[a-f0-9]{64}$/),
        reportedName: z.string(),
        reportedType: z.string(),
        officialWebsite: z.url(),
        aliases: z.array(z.string()),
        basis: z.string(),
      }),
    )
    .optional(),
  revisionDate: z.string().nullable().optional(),
  indexDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type PlaceReference = z.infer<typeof PlaceReferenceSchema>;
export const QuerySchema = z
  .object({
    snapshotId: z.string().min(1),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radiusMeters: z.number().positive().max(32187),
    roofMinAgeYears: z.number().int().min(0).max(150).optional(),
    permitStatus: z.enum(["any", "open", "closed", "unknown"]).default("any"),
    minOpenDays: z.number().int().min(0).max(50000).default(0),
    minConfidence: z.enum(["any", "high", "medium", "low"]).default("any"),
    includeUnknown: z.boolean().default(false),
    limit: z.number().int().min(1).max(200).default(50),
    cursor: z.string().optional(),
    ownerRegion: z
      .enum(["any", "regional", "out_of_area", "unknown"])
      .optional(),
    minOwnershipYears: z.number().int().min(0).max(200).optional(),
    providerPermitStatus: ProviderPermitStatusSchema.optional(),
    permitActivityClaim: PermitActivityClaimSchema.optional(),
    minPermitAgeSinceIssueDays: z.number().int().min(0).max(50000).optional(),
    minRecordedDeedGapYears: z.number().int().min(0).max(200).optional(),
    minReportedSaleAgeYears: z.number().int().min(0).max(200).optional(),
    placeId: z.string().min(1).max(160).optional(),
    placeIndexDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    requiresContractor: z.boolean().optional(),
    requiresVerifiedLicense: z.boolean().optional(),
    requiresBbbRating: z.boolean().optional(),
    sort: z
      .enum(["distance", "roof_age_desc", "permit_open_days_desc"])
      .optional(),
  })
  .strict();
export type Query = z.infer<typeof QuerySchema>;
export type QueryInput = z.input<typeof QuerySchema>;
export const SearchResponseSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    snapshotId: z.string(),
    queryHash: z.string(),
    rows: z.array(PropertySchema.safeExtend({ distanceMeters: z.number() })),
    total: z.number().int(),
    truncated: z.boolean(),
    nextCursor: z.string().nullable(),
    limitations: z.array(z.string()),
    placeResolution: PlaceReferenceSchema.optional(),
  })
  .superRefine((result, ctx) => {
    if (
      result.rows.some((property) =>
        property.permits.some((permit) =>
          (permit.sourceObservations ?? []).some(
            (row) =>
              result.snapshotId !== row.publicSnapshotId &&
              !result.snapshotId.startsWith(
                row.publicSnapshotId + "-protected-",
              ),
          ),
        ),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Source observation snapshot binding rejected",
      });
  });
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export const LeadCreateSchema = z
  .object({
    sessionId: z.string().min(1).max(100),
    propertyId: z.string(),
    snapshotId: z.string(),
    idempotencyKey: z.string().min(1).max(200),
  })
  .strict();
export const LeadUpdateSchema = z
  .object({
    sessionId: z.string().min(1).max(100),
    id: z.string(),
    expectedVersion: z.number().int().positive(),
    status: z.enum(["new", "qualified", "contacted", "archived"]).optional(),
    note: z.string().max(2000).optional(),
  })
  .strict();
export const LeadSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  propertyId: z.string(),
  snapshotId: z.string(),
  status: z.enum(["new", "qualified", "contacted", "archived"]),
  version: z.number().int(),
  events: z.array(
    z.object({
      kind: z.string(),
      at: z.iso.datetime(),
      note: z.string().optional(),
    }),
  ),
});
export type Lead = z.infer<typeof LeadSchema>;
export const ErrorCode = z.enum([
  "INVALID_INPUT",
  "INVALID_CURSOR",
  "SNAPSHOT_UNAVAILABLE",
  "NOT_AUTHORIZED",
  "RATE_LIMITED",
  "COST_LIMIT_REACHED",
  "QUERY_TIMEOUT",
  "CONFLICT",
  "UNSUPPORTED_TOOL",
]);
export class DomainError extends Error {
  constructor(
    public code: z.infer<typeof ErrorCode>,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
