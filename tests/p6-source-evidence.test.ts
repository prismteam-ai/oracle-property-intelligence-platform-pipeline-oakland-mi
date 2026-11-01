import { describe, expect, it } from "vitest";
import {
  calendarAnniversary,
  evidenceUrl,
  projectContractorLicenseObservation,
  projectRecordedTransferObservation,
  validateNativePermitStatusEvidence,
} from "../packages/county/src/sources/source-evidence.ts";

const stamp = "2026-10-28T20:00:00.000Z";
const reference = {
  sourceId: "synthetic-official-index-fixture",
  sourceUrl: "https://www.ocmideeds.com/MIOakland/MVPSearch.WebSite/results",
  recordSha256: "a".repeat(64),
  observedAt: stamp,
  rightsTier: "protected",
};
const transfer = {
  canonicalPropertyId: "synthetic-property",
  queriedPinSha256: "b".repeat(64),
  sourceSystem: "oakland_county_super_index",
  searchCoverageStart: "1964-01-01",
  searchCoverageEnd: "2026-10-20",
  sourceIndexedThrough: "2026-10-20",
  sourceVerifiedThrough: "2026-10-19",
  lastRecordedDeedDate: "2012-06-01",
  deedDocumentCount: 2,
  allResultPagesObserved: true,
  exactCurrentPinMatched: true,
  otherSearchFiltersEmpty: true,
  priorParcelLineageReviewed: false,
  reference,
};
const native = {
  permitNumber: "SYNTHETIC-PERMIT",
  jurisdiction: "Troy",
  nativeStatus: "OPEN",
  lifecycle: "open",
  openedAt: "2010-01-01",
  closedAt: null,
  continuousOpenFrom: null,
  historyContinuity: "not_established",
  independentlyReviewed: true,
  sourceStatusKind: "municipal_native",
  reference: { ...reference, sourceUrl: "https://bsaonline.com/?uid=406" },
};

describe("bounded source evidence semantics", () => {
  it("uses calendar years and clamps a leap-day anniversary", () => {
    expect(calendarAnniversary("2024-02-29", -10)).toBe("2014-02-28");
    expect(calendarAnniversary("2020-02-29", 4)).toBe("2024-02-29");
  });
  it.each([
    "https://example.com/?api_key=synthetic",
    "https://example.com/?X-Amz-Signature=synthetic",
    "https://synthetic:synthetic@example.com/",
    "http://example.com/",
    "https://example.com/#synthetic-token",
  ])("rejects a credential-bearing or unsuitable evidence URL: %s", (url) => {
    expect(evidenceUrl(url)).toBe(false);
  });
  it("supports the narrow ten-year index observation without proving ownership", () => {
    const result = projectRecordedTransferObservation(transfer);
    expect(result.noDeedObservedForMoreThanTenYears).toBe(true);
    expect(result.ownershipContinuity).toBe("not_established");
    expect(result.limitations.join(" ")).toContain("verification-through");
  });
  it("a recent deed defeats the ten-year observation even when an older warranty deed exists", () => {
    const result = projectRecordedTransferObservation({
      ...transfer,
      lastRecordedDeedDate: "2024-01-01",
    });
    expect(result.noDeedObservedForMoreThanTenYears).toBe(false);
  });
  it("exactly ten years is not more than ten years", () => {
    expect(
      projectRecordedTransferObservation({
        ...transfer,
        lastRecordedDeedDate: "2016-10-20",
      }).noDeedObservedForMoreThanTenYears,
    ).toBe(false);
  });
  it.each([
    { allResultPagesObserved: false },
    { otherSearchFiltersEmpty: false },
    { exactCurrentPinMatched: false },
    { searchCoverageEnd: "2026-10-28" },
    { deedDocumentCount: 0 },
    { reference: { ...reference, sourceUrl: "https://example.com/unrelated" } },
  ])("rejects a missing query/coverage/identity fence", (change) => {
    expect(() =>
      projectRecordedTransferObservation({ ...transfer, ...change }),
    ).toThrow("receipt rejected");
  });
  it("does not convert an old issue date into a continuous native interval", () => {
    const proof = validateNativePermitStatusEvidence(native, {
      permitNumber: native.permitNumber,
      jurisdiction: "Troy",
      observedAt: stamp,
    });
    expect(proof.continuousOpenFrom).toBeNull();
  });
  it.each([
    { permitNumber: "SYNTHETIC-OTHER-PERMIT" },
    { jurisdiction: "Unrelated synthetic municipality" },
    { continuousOpenFrom: "2010-01-01" },
    { closedAt: "2020-01-01" },
    {
      reference: {
        ...native.reference,
        observedAt: "2026-10-29T00:00:00.000Z",
      },
    },
  ])("rejects mismatched or unsupported native status proof", (change) => {
    expect(() =>
      validateNativePermitStatusEvidence(
        { ...native, ...change },
        {
          permitNumber: native.permitNumber,
          jurisdiction: "Troy",
          observedAt: stamp,
        },
      ),
    ).toThrow("rejected");
  });
  it("preserves native license status without equating it to contractor role or eligibility", () => {
    const result = projectContractorLicenseObservation({
      candidateBusinessId: "synthetic-business",
      reportedPermitPartyRole: "applicant",
      licenseIdentifier: "SYNTHETIC-LICENSE",
      licenseType: "Synthetic residential builder",
      nativeLicenseStatus: "Issued",
      licenseIssueDate: "2020-01-01",
      licenseExpiryDate: "2027-01-01",
      matchBasis: "unique_normalized_business",
      confidence: "medium",
      reference: {
        ...reference,
        sourceUrl:
          "https://aca-prod.accela.com/LARA/GeneralProperty/PropertyLookUp.aspx",
      },
    });
    expect(result.nativeLicenseStatus).toBe("Issued");
    expect(result.contractorRoleVerified).toBe(false);
    expect(result.eligibilityAtPermitEvent).toBe("not_established");
  });
});
