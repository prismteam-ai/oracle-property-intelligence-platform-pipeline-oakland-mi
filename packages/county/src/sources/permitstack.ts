import { z } from "zod";
import { sha256, stableJson } from "../model.ts";
import { troyBusinessName } from "../troy.ts";
import {
  EvidenceDate,
  EvidenceSha256,
  EvidenceTimestamp,
  calendarAnniversary,
  evidenceDayDifference,
  validateNativePermitStatusEvidence,
} from "./source-evidence.ts";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const ProviderStatus = z.enum([
  "FILED",
  "ISSUED",
  "IN_PROGRESS",
  "FINAL",
  "EXPIRED",
  "CANCELLED",
  "REVOKED",
  "UNKNOWN",
  "INTERCONNECTED",
]);
const NullableDate = EvidenceDate.nullish();
const SavedRecord = z
  .object({
    id: z.string().min(1).max(160),
    permit_number: z.string().min(1).max(120),
    status: ProviderStatus,
    category: z.literal("ROOFING"),
    jurisdiction_name: z.string().min(1).max(200),
    record_kind: z.string().max(80).optional(),
    address_state: z.string().max(2).nullish(),
    date_filed: NullableDate,
    date_issued: NullableDate,
    date_completed: NullableDate,
    date_expired: NullableDate,
    contractor_name: z.string().max(1024).nullish(),
    contractor_license: z.string().max(120).nullish(),
  })
  .passthrough();
const SavedResponse = z
  .object({
    total: z.number().int().nonnegative().nullable(),
    total_capped: z.boolean().optional(),
    total_unknown: z.boolean().optional(),
    page: z.number().int().positive(),
    per_page: z.number().int().min(1).max(1000),
    tier_window_days: z.number().int().nonnegative().nullish(),
    tier_window_from: EvidenceDate.nullish(),
    tier_window_clamped: z.boolean().optional(),
    results: z.array(SavedRecord).max(1000),
  })
  .passthrough();
const Join = z
  .object({
    canonicalPropertyId: z.string().min(1).max(200),
    publicSnapshotId: z.string().min(1).max(200),
    providerRecordDigest: EvidenceSha256,
    candidateCount: z.literal(1),
    basis: z.literal("exact_normalized_parcel_and_jurisdiction"),
    addressAgreement: z.enum(["agrees", "agrees_except_terminal_suffix"]),
    receiptSha256: EvidenceSha256,
  })
  .strict();
const Context = z
  .object({
    sourceId: z.string().min(1).max(160),
    publicSnapshotId: z.string().min(1).max(200),
    responseSha256: EvidenceSha256,
    observedAt: EvidenceTimestamp,
    assessmentAt: EvidenceTimestamp,
    httpStatus: z.literal(200),
    query: z
      .object({
        city: z.literal("Troy"),
        state: z.literal("MI"),
        jurisdiction: z.literal("Troy"),
        category: z.literal("ROOFING"),
        recordKind: z.literal("permit"),
        page: z.number().int().positive(),
        requestedPerPage: z.number().int().min(1).max(1000),
      })
      .strict(),
    rights: z
      .object({
        accountConsent: z.literal("confirmed"),
        termsSha256: EvidenceSha256,
        protectedDisplayAllowed: z.literal(true),
        publicRedistributionAllowed: z.literal(false),
        tier: z.literal("protected"),
      })
      .strict(),
    coverage: z
      .object({
        jurisdiction: z.literal("Troy"),
        state: z.literal("MI"),
        sourceState: z.enum([
          "active",
          "historical_archive",
          "frozen",
          "unknown",
        ]),
        accessBlocked: z.boolean().nullable(),
        dataThrough: EvidenceDate.nullable(),
        lastRefreshed: EvidenceDate.nullable(),
        metadataSha256: EvidenceSha256,
        freshnessPolicyMaxAgeDays: z.number().int().min(1).max(366),
        freshnessPolicyDocumentSha256: EvidenceSha256,
      })
      .strict(),
    statusDefinition: z
      .object({
        sourceStatusKind: z.literal("provider_normalized"),
        activeProviderStatus: z.literal("IN_PROGRESS"),
        documentSha256: EvidenceSha256,
        definitionUrl: z.literal(
          "https://permit-stack.com/glossary/permit-status/",
        ),
        independentlyReviewed: z.literal(true),
      })
      .strict(),
    joinsByProviderId: z.record(z.string().min(1).max(160), Join),
    nativeStatusEvidenceByProviderId: z.record(
      z.string().min(1).max(160),
      z.unknown(),
    ),
  })
  .strict();

export type PermitStackNormalizationContext = z.infer<typeof Context>;

function boundedJson(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error("Saved source nesting bound rejected");
  if (typeof value === "string" && value.length > 16_384)
    throw new Error("Saved source string bound rejected");
  if (Array.isArray(value)) {
    if (value.length > 1000)
      throw new Error("Saved source array bound rejected");
    for (const child of value) boundedJson(child, depth + 1);
  } else if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (
      entries.length > 100 ||
      entries.some(([key]) =>
        ["__proto__", "constructor", "prototype"].includes(key),
      )
    )
      throw new Error("Saved source object bound rejected");
    for (const [, child] of entries) boundedJson(child, depth + 1);
  }
}

/**
 * Validate one saved response and return an explicit protected allowlist only.
 * The caller retains the unchanged raw response privately before invoking this
 * pure function. This function performs no fetch, file access or publication.
 * Trusted context binds reviewed rights, source definitions and exact joins;
 * model/tool arguments must never be accepted as that producer context.
 */
export function normalizeSavedPermitStackResponse(raw: string, input: unknown) {
  try {
    const context = Context.parse(input);
    if (
      Buffer.byteLength(raw) > MAX_RESPONSE_BYTES ||
      sha256(raw) !== context.responseSha256
    )
      throw new Error();
    const parsed: unknown = JSON.parse(raw);
    boundedJson(parsed);
    const response = SavedResponse.parse(parsed);
    const asOf = context.assessmentAt.slice(0, 10);
    if (
      Date.parse(context.observedAt) > Date.parse(context.assessmentAt) ||
      response.page !== context.query.page ||
      response.per_page > context.query.requestedPerPage ||
      response.results.length > response.per_page ||
      new Set(response.results.map((row) => row.id)).size !==
        response.results.length ||
      (context.coverage.dataThrough !== null &&
        context.coverage.dataThrough > asOf) ||
      (context.coverage.lastRefreshed !== null &&
        context.coverage.lastRefreshed > asOf)
    )
      throw new Error();
    const ids = new Set(response.results.map((row) => row.id));
    if (
      [
        ...Object.keys(context.joinsByProviderId),
        ...Object.keys(context.nativeStatusEvidenceByProviderId),
      ].some((id) => !ids.has(id))
    )
      throw new Error();
    const sourceCurrent =
      context.coverage.sourceState === "active" &&
      context.coverage.accessBlocked === false &&
      context.coverage.dataThrough !== null &&
      context.coverage.lastRefreshed !== null &&
      evidenceDayDifference(context.coverage.dataThrough, asOf) <=
        context.coverage.freshnessPolicyMaxAgeDays &&
      evidenceDayDifference(context.coverage.lastRefreshed, asOf) <=
        context.coverage.freshnessPolicyMaxAgeDays;
    const records = response.results.map((row) => {
      if (
        row.jurisdiction_name.toUpperCase() !==
          context.coverage.jurisdiction.toUpperCase() ||
        (row.address_state != null &&
          row.address_state.toUpperCase() !== "MI") ||
        (row.record_kind !== undefined && row.record_kind !== "permit") ||
        [row.date_filed, row.date_issued, row.date_completed].some(
          (date) => date != null && date > context.observedAt.slice(0, 10),
        ) ||
        (row.date_issued != null &&
          row.date_completed != null &&
          row.date_completed < row.date_issued)
      )
        throw new Error();
      const recordDigest = sha256(stableJson(row));
      const join = context.joinsByProviderId[row.id] ?? null;
      if (
        join !== null &&
        (join.publicSnapshotId !== context.publicSnapshotId ||
          join.providerRecordDigest !== recordDigest)
      )
        throw new Error();
      const nativeInput = context.nativeStatusEvidenceByProviderId[row.id];
      const native =
        nativeInput === undefined
          ? null
          : validateNativePermitStatusEvidence(nativeInput, {
              permitNumber: row.permit_number,
              jurisdiction: row.jurisdiction_name,
              observedAt: context.assessmentAt,
            });
      const nativeFresh =
        native !== null &&
        evidenceDayDifference(native.reference.observedAt.slice(0, 10), asOf) <=
          context.coverage.freshnessPolicyMaxAgeDays;
      const providerActive =
        sourceCurrent &&
        row.status === context.statusDefinition.activeProviderStatus;
      const nativeOpen = nativeFresh && native?.lifecycle === "open";
      const nativeClosed = nativeFresh && native?.lifecycle === "closed";
      const conflictingStatusEvidence = providerActive && nativeClosed;
      const currentActive =
        !conflictingStatusEvidence && (nativeOpen || providerActive);
      const issuedAt = row.date_issued ?? null;
      const issuedMoreThanFiveYearsAgo =
        issuedAt !== null && issuedAt < calendarAnniversary(asOf, -5);
      const continuousOpenDays =
        nativeOpen &&
        native?.historyContinuity === "documented" &&
        native.continuousOpenFrom !== null
          ? evidenceDayDifference(
              native.continuousOpenFrom,
              native.reference.observedAt.slice(0, 10),
            )
          : null;
      const metadataLagsRecordDate =
        context.coverage.dataThrough !== null &&
        [row.date_issued, row.date_filed].some(
          (date) => date != null && date > context.coverage.dataThrough!,
        );
      return {
        canonicalPropertyId: join?.canonicalPropertyId ?? null,
        publicSnapshotId: context.publicSnapshotId,
        provider: "permitstack" as const,
        providerRecordId: row.id,
        permitNumber: row.permit_number,
        category: row.category,
        categoryBasis: "provider_classification" as const,
        jurisdiction: row.jurisdiction_name,
        sourceStatusKind: "provider_normalized" as const,
        providerStatus: row.status,
        nativeStatus: native?.nativeStatus ?? null,
        supportedLifecycle: conflictingStatusEvidence
          ? ("unknown" as const)
          : nativeClosed
            ? ("closed" as const)
            : currentActive
              ? ("open" as const)
              : ("unknown" as const),
        statusBasis: conflictingStatusEvidence
          ? ("conflicting_status_evidence" as const)
          : nativeOpen || nativeClosed
            ? ("independent_native_status" as const)
            : providerActive
              ? ("provider_reported_active" as const)
              : row.status === "ISSUED"
                ? ("provider_issued_only" as const)
                : ("provider_status_only" as const),
        activityClaim: currentActive
          ? nativeOpen
            ? ("native_reported_open" as const)
            : ("provider_reported_active" as const)
          : ("not_established" as const),
        dateFiled: row.date_filed ?? null,
        dateIssued: issuedAt,
        dateCompleted: row.date_completed ?? null,
        dateExpired: row.date_expired ?? null,
        ageSinceIssueDays:
          issuedAt === null ? null : evidenceDayDifference(issuedAt, asOf),
        issuedMoreThanFiveYearsAgo,
        currentlyReportedActiveIssuedMoreThanFiveYearsAgo:
          currentActive && issuedMoreThanFiveYearsAgo,
        ageBasis:
          issuedAt === null
            ? ("not_available" as const)
            : ("age_since_issue" as const),
        openedAt: native?.openedAt ?? null,
        continuousOpenDays,
        continuousOpenIntervalBasis:
          continuousOpenDays === null
            ? ("not_established" as const)
            : ("independent_documented_native_history" as const),
        reportedBusinessName: troyBusinessName(row.contractor_name ?? ""),
        reportedBusinessRole: "provider_reported_party_unverified" as const,
        contractorLicenseIdentifier: row.contractor_license ?? null,
        verifiedContractorIdentity: false as const,
        sourceObservedAt: context.observedAt,
        assessmentAt: context.assessmentAt,
        sourceDataThrough: context.coverage.dataThrough,
        sourceLastRefreshed: context.coverage.lastRefreshed,
        rightsTier: "protected" as const,
        provenance: {
          sourceId: context.sourceId,
          responseSha256: context.responseSha256,
          recordDigest,
          termsSha256: context.rights.termsSha256,
          metadataSha256: context.coverage.metadataSha256,
          statusDefinitionSha256: context.statusDefinition.documentSha256,
          canonicalJoinReceiptSha256: join?.receiptSha256 ?? null,
          nativeStatusReceiptSha256: native?.reference.recordSha256 ?? null,
        },
        limitations: [
          "Provider status is normalized, not the native municipal label; issuance alone is not current OPEN.",
          "Age since issue is not uninterrupted open duration, completion or a roof installation date.",
          "Permit-listed business, contractor role and state license eligibility remain separate claims.",
          ...(!sourceCurrent
            ? [
                "Current source freshness/access was not qualified by the supplied reviewed metadata.",
              ]
            : []),
          ...(row.status === "IN_PROGRESS" && issuedAt === null
            ? [
                "Without an issue date, the provider warns this status may still represent plan review or an unapproved application.",
              ]
            : []),
          ...(metadataLagsRecordDate
            ? [
                "A returned permit date is newer than the cached jurisdiction data-through date.",
              ]
            : []),
          ...(conflictingStatusEvidence
            ? [
                "Provider active status conflicts with separately observed native closed status; no current-open claim is promoted.",
              ]
            : []),
          ...(join === null
            ? [
                "No uniquely accepted canonical property join was supplied; this observation is not a property-serving record.",
              ]
            : []),
        ],
      };
    });
    return {
      version: "permitstack-protected-projection-v1" as const,
      records,
      sourceEnvelope: {
        responseSha256: context.responseSha256,
        page: response.page,
        requestedPerPage: context.query.requestedPerPage,
        actualPerPage: response.per_page,
        total: response.total,
        totalCapped: response.total_capped ?? false,
        totalUnknown: response.total_unknown ?? false,
        tierWindowDays: response.tier_window_days ?? null,
        tierWindowFrom: response.tier_window_from ?? null,
        tierWindowClamped: response.tier_window_clamped ?? false,
      },
      audit: {
        returnedRecords: records.length,
        acceptedCanonicalJoins: records.filter(
          (row) => row.canonicalPropertyId !== null,
        ).length,
        providerReportedActive: records.filter(
          (row) => row.activityClaim === "provider_reported_active",
        ).length,
        nativeReportedOpen: records.filter(
          (row) => row.activityClaim === "native_reported_open",
        ).length,
        documentedContinuousIntervals: records.filter(
          (row) => row.continuousOpenDays !== null,
        ).length,
        rawOwnerContactOrApplicantFieldsProjected: false as const,
        networkCalls: 0 as const,
        publicExportAllowed: false as const,
      },
    };
  } catch {
    throw new Error(
      "Saved PermitStack response/schema/rights/provenance/join evidence rejected",
    );
  }
}
