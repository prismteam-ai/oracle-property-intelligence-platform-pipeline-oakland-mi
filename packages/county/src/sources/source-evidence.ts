import { z } from "zod";

export const EvidenceSha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const EvidenceDate = z.iso.date();
export const EvidenceTimestamp = z.iso.datetime();

/** Public proof locators may never contain a credential, session or signed URL. */
export function evidenceUrl(value: string): boolean {
  try {
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
  } catch {
    return false;
  }
}

export const SourceEvidenceReference = z
  .object({
    sourceId: z.string().min(1).max(160),
    sourceUrl: z.string().refine(evidenceUrl),
    recordSha256: EvidenceSha256,
    observedAt: EvidenceTimestamp,
    rightsTier: z.literal("protected"),
  })
  .strict();

/** Calendar-year comparison: leap-day anniversaries clamp to February 28. */
export function calendarAnniversary(date: string, years: number): string {
  const parsed = EvidenceDate.parse(date);
  if (!Number.isInteger(years) || Math.abs(years) > 500)
    throw new Error("Evidence calendar interval rejected");
  const [year, month, day] = parsed.split("-").map(Number);
  const targetYear = year! + years;
  const lastDay = new Date(Date.UTC(targetYear, month!, 0)).getUTCDate();
  return `${String(targetYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(day!, lastDay)).padStart(2, "0")}`;
}

export function evidenceDayDifference(start: string, end: string): number {
  EvidenceDate.parse(start);
  EvidenceDate.parse(end);
  return Math.floor((Date.parse(end) - Date.parse(start)) / 86_400_000);
}

const NativePermitStatus = z
  .object({
    permitNumber: z.string().min(1).max(120),
    jurisdiction: z.string().min(1).max(200),
    nativeStatus: z.string().min(1).max(120),
    lifecycle: z.enum(["open", "closed", "unknown"]),
    openedAt: EvidenceDate.nullable(),
    closedAt: EvidenceDate.nullable(),
    continuousOpenFrom: EvidenceDate.nullable(),
    historyContinuity: z.enum(["documented", "not_established"]),
    independentlyReviewed: z.literal(true),
    sourceStatusKind: z.literal("municipal_native"),
    reference: SourceEvidenceReference,
  })
  .strict();

export type NativePermitStatusEvidence = z.infer<typeof NativePermitStatus>;

/** Accept an independent native receipt only when identity and time agree. */
export function validateNativePermitStatusEvidence(
  input: unknown,
  expected: { permitNumber: string; jurisdiction: string; observedAt: string },
): NativePermitStatusEvidence {
  try {
    const proof = NativePermitStatus.parse(input);
    const asOf = EvidenceTimestamp.parse(expected.observedAt).slice(0, 10);
    if (
      proof.permitNumber !== expected.permitNumber ||
      proof.jurisdiction !== expected.jurisdiction ||
      Date.parse(proof.reference.observedAt) >
        Date.parse(expected.observedAt) ||
      (proof.openedAt !== null && proof.openedAt > asOf) ||
      (proof.closedAt !== null && proof.closedAt > asOf) ||
      (proof.openedAt !== null &&
        proof.closedAt !== null &&
        proof.closedAt < proof.openedAt) ||
      (proof.lifecycle === "open" && proof.closedAt !== null) ||
      (proof.continuousOpenFrom !== null &&
        (proof.historyContinuity !== "documented" ||
          proof.lifecycle !== "open" ||
          proof.openedAt === null ||
          proof.continuousOpenFrom < proof.openedAt ||
          proof.continuousOpenFrom > proof.reference.observedAt.slice(0, 10)))
    )
      throw new Error();
    return proof;
  } catch {
    throw new Error("Native status evidence identity/time/history rejected");
  }
}

export const RecordedTransferIndexObservation = z
  .object({
    canonicalPropertyId: z.string().min(1).max(200),
    queriedPinSha256: EvidenceSha256,
    sourceSystem: z.literal("oakland_county_super_index"),
    searchCoverageStart: EvidenceDate,
    searchCoverageEnd: EvidenceDate,
    sourceIndexedThrough: EvidenceDate,
    sourceVerifiedThrough: EvidenceDate.nullable(),
    lastRecordedDeedDate: EvidenceDate.nullable(),
    deedDocumentCount: z.number().int().min(0).max(10_000),
    allResultPagesObserved: z.literal(true),
    exactCurrentPinMatched: z.literal(true),
    otherSearchFiltersEmpty: z.literal(true),
    priorParcelLineageReviewed: z.boolean(),
    reference: SourceEvidenceReference,
  })
  .strict();

/** A bounded current-PIN index observation is never a legal ownership chain. */
export function projectRecordedTransferObservation(input: unknown) {
  try {
    const row = RecordedTransferIndexObservation.parse(input);
    if (
      !["ocmideeds.com", "www.ocmideeds.com"].includes(
        new URL(row.reference.sourceUrl).hostname,
      ) ||
      row.searchCoverageStart > row.searchCoverageEnd ||
      row.searchCoverageEnd > row.sourceIndexedThrough ||
      row.sourceIndexedThrough > row.reference.observedAt.slice(0, 10) ||
      (row.sourceVerifiedThrough !== null &&
        row.sourceVerifiedThrough > row.sourceIndexedThrough) ||
      (row.deedDocumentCount === 0) !== (row.lastRecordedDeedDate === null) ||
      (row.lastRecordedDeedDate !== null &&
        (row.lastRecordedDeedDate < row.searchCoverageStart ||
          row.lastRecordedDeedDate > row.searchCoverageEnd))
    )
      throw new Error();
    const cutoff = calendarAnniversary(row.searchCoverageEnd, -10);
    const noDeedObservedForMoreThanTenYears =
      row.searchCoverageStart < cutoff &&
      (row.lastRecordedDeedDate === null || row.lastRecordedDeedDate < cutoff);
    return {
      ...row,
      rightsTier: "protected" as const,
      claimKind: "recorded_deed_index_observation" as const,
      noDeedObservedForMoreThanTenYears,
      ownershipContinuity: "not_established" as const,
      claimText: noDeedObservedForMoreThanTenYears
        ? "No recorded deed transfer was observed in this official-index query for more than ten years through its coverage end."
        : "Recorded deed dates were observed only within this official-index query coverage window.",
      limitations: [
        "Current-PIN search coverage does not by itself establish predecessor-parcel coverage or legal ownership continuity.",
        "The observed-through date is bounded by index coverage, not the date the browser was opened.",
        ...(row.sourceVerifiedThrough !== null &&
        row.sourceVerifiedThrough < row.searchCoverageEnd
          ? [
              "The selected index window extends beyond the source verification-through date.",
            ]
          : []),
      ],
    };
  } catch {
    throw new Error(
      "Recorded-transfer index identity/coverage/date receipt rejected",
    );
  }
}

export const ContractorLicenseObservation = z
  .object({
    candidateBusinessId: z.string().min(1).max(200),
    reportedPermitPartyRole: z.enum(["contractor", "applicant", "unverified"]),
    licenseIdentifier: z.string().min(1).max(120),
    licenseType: z.string().min(1).max(200),
    nativeLicenseStatus: z.string().min(1).max(120),
    licenseIssueDate: EvidenceDate.nullable(),
    licenseExpiryDate: EvidenceDate.nullable(),
    matchBasis: z.enum([
      "exact_license_and_business",
      "unique_normalized_business",
      "ambiguous",
    ]),
    confidence: z.enum(["low", "medium", "high"]),
    reference: SourceEvidenceReference,
  })
  .strict();

/** Preserve native license facts; an attachment does not certify a contractor role. */
export function projectContractorLicenseObservation(input: unknown) {
  try {
    const row = ContractorLicenseObservation.parse(input);
    if (
      ![
        "michigan.gov",
        "www.michigan.gov",
        "aca-prod.accela.com",
        "aca3.accela.com",
      ].includes(new URL(row.reference.sourceUrl).hostname) ||
      (row.licenseIssueDate !== null &&
        row.licenseIssueDate > row.reference.observedAt.slice(0, 10)) ||
      (row.licenseIssueDate !== null &&
        row.licenseExpiryDate !== null &&
        row.licenseExpiryDate < row.licenseIssueDate) ||
      (row.matchBasis === "ambiguous" && row.confidence !== "low")
    )
      throw new Error();
    return {
      ...row,
      rightsTier: "protected" as const,
      contractorRoleVerified: false as const,
      eligibilityAtPermitEvent: "not_established" as const,
      licenseActivityClaim: "native_status_only" as const,
    };
  } catch {
    throw new Error("Contractor license identity/date receipt rejected");
  }
}
