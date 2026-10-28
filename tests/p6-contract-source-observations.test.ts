import { expect, it } from "vitest";
import {
  ProviderPermitObservationSchema,
  RecordedTransferIndexObservationSchema,
  QuerySchema,
  recordedDeedGapMatches,
  type Permit,
} from "../packages/contracts/src/index.ts";
import { permitMatchesQuery } from "../packages/contracts/src/query-predicates.ts";
const hash = "a".repeat(64);
const stamp = "2026-10-28T20:00:00.000Z";
function observation(status = "ISSUED") {
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
const deed = {
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
const query = {
  snapshotId: "synthetic",
  lat: 42,
  lng: -83,
  radiusMeters: 1000,
};
function permit(status = "ISSUED"): Permit {
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
it("keeps issued age separate from current activity and continuous open", () => {
  const value = permit();
  expect(
    permitMatchesQuery(
      value,
      {
        ...query,
        providerPermitStatus: "ISSUED",
        minPermitAgeSinceIssueDays: 3650,
      },
      "2026-10-28",
    ),
  ).toBe(true);
  expect(
    permitMatchesQuery(value, { ...query, permitStatus: "open" }, "2026-10-28"),
  ).toBe(false);
  expect(
    permitMatchesQuery(value, { ...query, minOpenDays: 1 }, "2026-10-28"),
  ).toBe(false);
});
it("supports explicit provider active plus issue age without inventing continuous history", () => {
  expect(
    permitMatchesQuery(
      permit("IN_PROGRESS"),
      {
        ...query,
        permitStatus: "open",
        permitActivityClaim: "provider_reported_active",
        minPermitAgeSinceIssueDays: 3650,
      },
      "2026-10-28",
    ),
  ).toBe(true);
  expect(
    permitMatchesQuery(
      permit("IN_PROGRESS"),
      { ...query, permitStatus: "open", minOpenDays: 1 },
      "2026-10-28",
    ),
  ).toBe(false);
});
it("cannot satisfy source conditions across different observations", () => {
  const value = permit();
  value.sourceObservations!.push(observation("IN_PROGRESS"));
  expect(
    permitMatchesQuery(
      value,
      {
        ...query,
        providerPermitStatus: "ISSUED",
        permitActivityClaim: "provider_reported_active",
      },
      "2026-10-28",
    ),
  ).toBe(false);
});
it.each([
  { activityClaim: "provider_reported_active" },
  { ageSinceIssueDays: 5000 },
  { continuousOpenDays: 3650 },
  { ownerName: "PRIVATE CANARY" },
])("rejects inconsistent or unallowlisted source evidence", (change) => {
  expect(
    ProviderPermitObservationSchema.safeParse({ ...observation(), ...change })
      .success,
  ).toBe(false);
});
it("uses the qualified current-PIN claim window and source cutoff rather than global advertised coverage", () => {
  const parsed = RecordedTransferIndexObservationSchema.parse(deed);
  expect(recordedDeedGapMatches(parsed, 10)).toBe(true);
  expect(recordedDeedGapMatches(parsed, 11)).toBe(false);
  expect(
    RecordedTransferIndexObservationSchema.safeParse({
      ...deed,
      observedThrough: "2026-10-28",
    }).success,
  ).toBe(false);
  expect(
    RecordedTransferIndexObservationSchema.safeParse({
      ...deed,
      priorParcelLineageReviewed: true,
    }).success,
  ).toBe(false);
});
it("strict calendar > excludes exact ten-year deed anniversary", () => {
  const parsed = RecordedTransferIndexObservationSchema.parse({
    ...deed,
    lastRecordedDeedDate: "2016-10-19",
    noDeedObservedForMoreThanTenYears: false,
  });
  expect(recordedDeedGapMatches(parsed, 10)).toBe(false);
});
it("requires explicit typed source/deed filters and rejects unsupported extras", () => {
  expect(
    QuerySchema.parse({ ...query, minRecordedDeedGapYears: 10 })
      .minRecordedDeedGapYears,
  ).toBe(10);
  expect(
    QuerySchema.safeParse({ ...query, ownershipContinuity: true }).success,
  ).toBe(false);
});
