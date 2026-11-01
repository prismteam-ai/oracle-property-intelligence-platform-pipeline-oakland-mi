import { z } from "zod";
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const DateOnly = z.iso.date();
const Time = z.iso.datetime();
const Id = z.string().min(1).max(200);
export const ProviderPermitStatusSchema = z.enum([
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
export const PermitActivityClaimSchema = z.enum([
  "provider_reported_active",
  "native_reported_open",
  "not_established",
]);
export const ProtectedSourceReferenceSchema = z
  .object({
    sourceId: Id,
    sourceUrl: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        !url.hash &&
        url.href.length <= 2048 &&
        ![...url.searchParams.keys()].some((key) =>
          /token|secret|session|password|credential|signature|authorization|api.?key/i.test(
            key,
          ),
        )
      );
    }),
    recordSha256: Hash,
    observedAt: Time,
    rightsTier: z.literal("protected"),
  })
  .strict();
export function sourceCalendarAnniversary(date: string, years: number): string {
  const [year, month, day] = DateOnly.parse(date).split("-").map(Number);
  const target = year! + years;
  return `${String(target).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(day!, new Date(Date.UTC(target, month!, 0)).getUTCDate())).padStart(2, "0")}`;
}
export const ProviderPermitObservationSchema = z
  .object({
    canonicalPropertyId: Id,
    publicSnapshotId: Id,
    provider: z.literal("permitstack"),
    providerRecordId: Id,
    permitNumber: z.string().min(1).max(120),
    category: z.literal("ROOFING"),
    categoryBasis: z.literal("provider_classification"),
    jurisdiction: z.literal("Troy"),
    sourceStatusKind: z.literal("provider_normalized"),
    providerStatus: ProviderPermitStatusSchema,
    nativeStatus: z.string().min(1).max(120).nullable(),
    supportedLifecycle: z.enum(["open", "closed", "unknown"]),
    statusBasis: z.enum([
      "provider_reported_active",
      "provider_issued_only",
      "provider_status_only",
      "independent_native_status",
      "conflicting_status_evidence",
    ]),
    activityClaim: PermitActivityClaimSchema,
    dateFiled: DateOnly.nullable(),
    dateIssued: DateOnly.nullable(),
    dateCompleted: DateOnly.nullable(),
    dateExpired: DateOnly.nullable(),
    ageSinceIssueDays: z.number().int().min(0).max(100000).nullable(),
    issuedMoreThanFiveYearsAgo: z.boolean(),
    currentlyReportedActiveIssuedMoreThanFiveYearsAgo: z.boolean(),
    ageBasis: z.enum(["age_since_issue", "not_available"]),
    openedAt: DateOnly.nullable(),
    continuousOpenDays: z.number().int().min(0).max(100000).nullable(),
    continuousOpenIntervalBasis: z.enum([
      "independent_documented_native_history",
      "not_established",
    ]),
    reportedBusinessName: z.string().max(1024).nullable(),
    reportedBusinessRole: z.literal("provider_reported_party_unverified"),
    contractorLicenseIdentifier: z.string().max(120).nullable(),
    verifiedContractorIdentity: z.literal(false),
    sourceObservedAt: Time,
    assessmentAt: Time,
    sourceDataThrough: DateOnly.nullable(),
    sourceLastRefreshed: DateOnly.nullable(),
    rightsTier: z.literal("protected"),
    provenance: z
      .object({
        sourceId: Id,
        responseSha256: Hash,
        recordDigest: Hash,
        termsSha256: Hash,
        metadataSha256: Hash,
        statusDefinitionSha256: Hash,
        canonicalJoinReceiptSha256: Hash,
        nativeStatusReceiptSha256: Hash.nullable(),
      })
      .strict(),
    limitations: z.array(z.string().min(1).max(600)).min(1).max(20),
  })
  .strict()
  .superRefine((row, ctx) => {
    const asOf = row.assessmentAt.slice(0, 10);
    const issueAge =
      row.dateIssued === null
        ? null
        : Math.floor(
            (Date.parse(asOf) - Date.parse(row.dateIssued)) / 86400000,
          );
    const overFive =
      row.dateIssued !== null &&
      row.dateIssued < sourceCalendarAnniversary(asOf, -5);
    const active = row.activityClaim !== "not_established";
    const independent = row.provenance.nativeStatusReceiptSha256 !== null;
    if (
      row.sourceObservedAt > row.assessmentAt ||
      [
        row.dateFiled,
        row.dateIssued,
        row.dateCompleted,
        row.openedAt,
        row.sourceDataThrough,
        row.sourceLastRefreshed,
      ].some((date) => date !== null && date > asOf) ||
      row.ageSinceIssueDays !== issueAge ||
      row.issuedMoreThanFiveYearsAgo !== overFive ||
      row.currentlyReportedActiveIssuedMoreThanFiveYearsAgo !==
        (active && overFive) ||
      (row.dateIssued === null) !== (row.ageBasis === "not_available") ||
      (active && row.supportedLifecycle !== "open") ||
      (row.statusBasis === "conflicting_status_evidence" &&
        (active || row.supportedLifecycle !== "unknown")) ||
      (row.activityClaim === "provider_reported_active" &&
        (row.providerStatus !== "IN_PROGRESS" ||
          row.statusBasis !== "provider_reported_active")) ||
      (row.activityClaim === "native_reported_open" &&
        (!independent || row.statusBasis !== "independent_native_status")) ||
      (row.nativeStatus !== null && !independent) ||
      (row.openedAt !== null && !independent) ||
      (row.continuousOpenDays !== null &&
        (!independent ||
          row.activityClaim !== "native_reported_open" ||
          row.openedAt === null)) ||
      (row.continuousOpenDays === null) !==
        (row.continuousOpenIntervalBasis === "not_established") ||
      (row.providerStatus === "ISSUED" &&
        !independent &&
        (active ||
          row.supportedLifecycle !== "unknown" ||
          row.statusBasis !== "provider_issued_only"))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Provider status/date/age/independent-history evidence inconsistent",
      });
  });
export type ProviderPermitObservation = z.infer<
  typeof ProviderPermitObservationSchema
>;
export const RecordedTransferIndexObservationSchema = z
  .object({
    canonicalPropertyId: Id,
    queriedPinSha256: Hash,
    sourceSystem: z.literal("oakland_county_super_index"),
    sourceIndexAdvertisedStart: DateOnly,
    queryDateFilters: z.object({ from: z.null(), through: z.null() }).strict(),
    claimWindowStart: DateOnly,
    observedThrough: DateOnly,
    sourceIndexedThrough: DateOnly,
    sourceVerifiedThrough: DateOnly,
    lastRecordedDeedDate: DateOnly.nullable(),
    deedDocumentCount: z.number().int().min(0).max(10000),
    allResultPagesObserved: z.literal(true),
    exactCurrentPinMatched: z.literal(true),
    otherSearchFiltersEmpty: z.literal(true),
    priorParcelLineageReviewed: z.literal(false),
    claimKind: z.literal("recorded_deed_index_observation"),
    noDeedObservedForMoreThanTenYears: z.boolean(),
    ownershipContinuity: z.literal("not_established"),
    confidence: z.literal("bounded_current_pin_index_observation"),
    witnessTiming: z.enum([
      "current_visible_form",
      "retrospectively_qualified",
    ]),
    reference: ProtectedSourceReferenceSchema,
    rightsTier: z.literal("protected"),
    limitations: z.array(z.string().min(1).max(600)).min(1).max(20),
  })
  .strict()
  .superRefine((row, ctx) => {
    const cutoff = sourceCalendarAnniversary(row.observedThrough, -10);
    const positive =
      row.claimWindowStart < cutoff &&
      (row.lastRecordedDeedDate === null || row.lastRecordedDeedDate < cutoff);
    if (
      !["ocmideeds.com", "www.ocmideeds.com"].includes(
        new URL(row.reference.sourceUrl).hostname,
      ) ||
      row.claimWindowStart > row.observedThrough ||
      row.observedThrough > row.sourceIndexedThrough ||
      row.observedThrough > row.sourceVerifiedThrough ||
      row.sourceVerifiedThrough > row.sourceIndexedThrough ||
      row.sourceIndexedThrough > row.reference.observedAt.slice(0, 10) ||
      row.sourceIndexAdvertisedStart > row.claimWindowStart ||
      (row.lastRecordedDeedDate !== null &&
        row.lastRecordedDeedDate > row.observedThrough) ||
      (row.deedDocumentCount === 0) !== (row.lastRecordedDeedDate === null) ||
      row.noDeedObservedForMoreThanTenYears !== positive
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Current-PIN deed index date/window/source evidence inconsistent",
      });
  });
export type RecordedTransferIndexObservation = z.infer<
  typeof RecordedTransferIndexObservationSchema
>;
export function recordedDeedGapMatches(
  observation: RecordedTransferIndexObservation,
  years: number,
): boolean {
  const cutoff = sourceCalendarAnniversary(observation.observedThrough, -years);
  return (
    observation.claimWindowStart < cutoff &&
    (observation.lastRecordedDeedDate === null ||
      observation.lastRecordedDeedDate < cutoff)
  );
}
/** Manifest-bound safe refresh receipt; never carries source rows or person fields. */
export const PrivateSourceRunSchema = z
  .object({
    id: z.string().regex(/^run-[a-zA-Z0-9-]{1,120}$/),
    at: Time,
    source: z.literal("PermitStack and official current-PIN deed index"),
    kind: z.literal("protected-source-refresh"),
    state: z.literal("COMPLETE_BOUNDED_SOURCE_REFRESH"),
    sourceCount: z.number().int().nonnegative(),
    processed: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    changed: z.literal(0),
    deleted: z.literal(0),
    unchanged: z.literal(0),
    provider: z
      .object({
        captured: z.number().int().nonnegative(),
        admitted: z.number().int().nonnegative(),
        held: z.number().int().nonnegative(),
        existingPermitAssociations: z.number().int().nonnegative(),
        newSourceCandidates: z.number().int().nonnegative(),
        currentlyReportedActive: z.number().int().nonnegative(),
      })
      .strict(),
    deedIndex: z
      .object({
        queries: z.number().int().nonnegative(),
        admitted: z.number().int().nonnegative(),
        held: z.number().int().nonnegative(),
        positiveTenYearObservations: z.number().int().nonnegative(),
        indexedEvidenceRows: z.number().int().nonnegative(),
        observedThrough: DateOnly,
      })
      .strict(),
    publicSnapshotId: Id,
    publicSnapshotUnchanged: z.literal(true),
    canonicalPropertyCountUnchanged: z.literal(true),
    acquisition: z
      .object({
        providerApiRequests: z.number().int().nonnegative(),
        deedUiSubmissions: z.number().int().nonnegative(),
      })
      .strict(),
    limitations: z.array(z.string().min(1).max(600)).min(1).max(20),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (
      r.sourceCount !== r.provider.captured + r.deedIndex.queries ||
      r.processed !== r.sourceCount ||
      r.added !== r.provider.admitted + r.deedIndex.admitted ||
      r.provider.captured !== r.provider.admitted + r.provider.held ||
      r.deedIndex.queries !== r.deedIndex.admitted + r.deedIndex.held ||
      r.provider.admitted !==
        r.provider.existingPermitAssociations +
          r.provider.newSourceCandidates ||
      r.provider.currentlyReportedActive > r.provider.admitted ||
      r.deedIndex.positiveTenYearObservations > r.deedIndex.admitted
    )
      ctx.addIssue({
        code: "custom",
        message: "Private source refresh count reconciliation rejected",
      });
  });
export const PrivateSourceRunsSchema = z
  .array(PrivateSourceRunSchema)
  .min(1)
  .max(20);
