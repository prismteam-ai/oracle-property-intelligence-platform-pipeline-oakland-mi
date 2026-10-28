import {
  ProviderPermitObservationSchema,
  type Permit,
} from "../packages/contracts/src/index.ts";
export const hash = "a".repeat(64);
export const stamp = "2026-10-28T20:00:00.000Z";
export function observation(status = "ISSUED") {
  return ProviderPermitObservationSchema.parse({
    canonicalPropertyId: "synthetic-property",
    publicSnapshotId: "synthetic-snapshot",
    provider: "permitstack",
    providerRecordId: "synthetic-record",
    permitNumber: "SYNTHETIC",
    category: "ROOFING",
    categoryBasis: "provider_classification",
    jurisdiction: "Troy",
    sourceStatusKind: "provider_normalized",
    providerStatus: status,
    nativeStatus: null,
    supportedLifecycle: status === "IN_PROGRESS" ? "open" : "unknown",
    statusBasis:
      status === "IN_PROGRESS"
        ? "provider_reported_active"
        : "provider_issued_only",
    activityClaim:
      status === "IN_PROGRESS" ? "provider_reported_active" : "not_established",
    dateFiled: null,
    dateIssued: "2016-10-28",
    dateCompleted: null,
    dateExpired: null,
    ageSinceIssueDays: 3652,
    issuedMoreThanFiveYearsAgo: true,
    currentlyReportedActiveIssuedMoreThanFiveYearsAgo: status === "IN_PROGRESS",
    ageBasis: "age_since_issue",
    openedAt: null,
    continuousOpenDays: null,
    continuousOpenIntervalBasis: "not_established",
    reportedBusinessName: null,
    reportedBusinessRole: "provider_reported_party_unverified",
    contractorLicenseIdentifier: null,
    verifiedContractorIdentity: false,
    sourceObservedAt: stamp,
    assessmentAt: stamp,
    sourceDataThrough: "2026-10-27",
    sourceLastRefreshed: "2026-10-28",
    rightsTier: "protected",
    provenance: {
      sourceId: "synthetic",
      responseSha256: hash,
      recordDigest: hash,
      termsSha256: hash,
      metadataSha256: hash,
      statusDefinitionSha256: hash,
      canonicalJoinReceiptSha256: hash,
      nativeStatusReceiptSha256: null,
    },
    limitations: [
      "Synthetic provider normalized observation; no uninterrupted history.",
    ],
  });
}
export const deed = {
  canonicalPropertyId: "synthetic-property",
  queriedPinSha256: hash,
  sourceSystem: "oakland_county_super_index",
  sourceIndexAdvertisedStart: "1964-01-01",
  queryDateFilters: { from: null, through: null },
  claimWindowStart: "2016-10-18",
  observedThrough: "2026-10-19",
  sourceIndexedThrough: "2026-10-20",
  sourceVerifiedThrough: "2026-10-19",
  lastRecordedDeedDate: "2012-01-01",
  deedDocumentCount: 3,
  allResultPagesObserved: true,
  exactCurrentPinMatched: true,
  otherSearchFiltersEmpty: true,
  priorParcelLineageReviewed: false,
  claimKind: "recorded_deed_index_observation",
  noDeedObservedForMoreThanTenYears: true,
  ownershipContinuity: "not_established",
  confidence: "bounded_current_pin_index_observation",
  witnessTiming: "current_visible_form",
  reference: {
    sourceId: "synthetic-index",
    sourceUrl: "https://www.ocmideeds.com/MIOakland/MVPSearch.WebSite/",
    recordSha256: hash,
    observedAt: stamp,
    rightsTier: "protected",
  },
  rightsTier: "protected",
  limitations: [
    "Current-PIN search only; predecessor lineage and ownership continuity unestablished.",
  ],
};
export const query = {
  snapshotId: "synthetic",
  lat: 42,
  lng: -83,
  radiusMeters: 1000,
};
export function permit(status = "ISSUED"): Permit {
  return {
    id: "synthetic-permit",
    status: "unknown",
    statusBasis: "issued_only",
    kind: "roof_unspecified",
    openedAt: null,
    closedAt: null,
    contractor: {
      reportedName: null,
      verifiedCompanyId: null,
      license: null,
      rating: null,
    },
    provenance: [],
    sourceObservations: [observation(status)],
  };
}
