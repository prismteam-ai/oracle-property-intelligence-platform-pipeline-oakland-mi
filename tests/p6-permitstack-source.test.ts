import { describe, expect, it } from "vitest";
import { sha256, stableJson } from "../packages/county/src/model.ts";
import { normalizeSavedPermitStackResponse } from "../packages/county/src/sources/permitstack.ts";

const stamp = "2026-10-28T20:00:00.000Z";
const row = {
  id: "synthetic-permit-1",
  permit_number: "SYNTHETIC-PERMIT",
  status: "ISSUED",
  category: "ROOFING",
  jurisdiction_name: "Troy",
  address_state: "MI",
  date_issued: "2010-01-01",
  date_filed: null,
  date_completed: null,
  contractor_name: "Synthetic Roofing LLC",
  owner_name: "SYNTHETIC PRIVATE OWNER",
  owner_address: "SYNTHETIC PRIVATE MAILING ADDRESS",
  applicant_name: "SYNTHETIC PRIVATE APPLICANT",
  phone: "SYNTHETIC PRIVATE PHONE",
  email: "synthetic-private@example.invalid",
  address_street: "SYNTHETIC SITE ADDRESS",
};
function fixture(change = {}) {
  const record = { ...row, ...change };
  const raw = JSON.stringify({
    total: 1,
    page: 1,
    per_page: 50,
    results: [record],
    tier_window_days: null,
    tier_window_from: null,
    tier_window_clamped: false,
  });
  const context = {
    sourceId: "synthetic-permitstack-fixture",
    publicSnapshotId: "synthetic-public-snapshot",
    responseSha256: sha256(raw),
    observedAt: stamp,
    assessmentAt: stamp,
    httpStatus: 200,
    query: {
      city: "Troy",
      state: "MI",
      jurisdiction: "Troy",
      category: "ROOFING",
      recordKind: "permit",
      page: 1,
      requestedPerPage: 100,
    },
    rights: {
      accountConsent: "confirmed",
      termsSha256: "a".repeat(64),
      protectedDisplayAllowed: true,
      publicRedistributionAllowed: false,
      tier: "protected",
    },
    coverage: {
      jurisdiction: "Troy",
      state: "MI",
      sourceState: "active",
      accessBlocked: false,
      dataThrough: "2026-10-27",
      lastRefreshed: "2026-10-28",
      metadataSha256: "b".repeat(64),
      freshnessPolicyMaxAgeDays: 45,
      freshnessPolicyDocumentSha256: "c".repeat(64),
    },
    statusDefinition: {
      sourceStatusKind: "provider_normalized",
      activeProviderStatus: "IN_PROGRESS",
      documentSha256: "d".repeat(64),
      definitionUrl: "https://permit-stack.com/glossary/permit-status/",
      independentlyReviewed: true,
    },
    joinsByProviderId: {
      "synthetic-permit-1": {
        canonicalPropertyId: "synthetic-property",
        publicSnapshotId: "synthetic-public-snapshot",
        providerRecordDigest: sha256(stableJson(record)),
        candidateCount: 1,
        basis: "exact_normalized_parcel_and_jurisdiction",
        addressAgreement: "agrees",
        receiptSha256: "e".repeat(64),
      },
    },
    nativeStatusEvidenceByProviderId: {},
  };
  return { record, raw, context };
}

describe("offline PermitStack protected projection", () => {
  it("retains ISSUED as non-open despite an old issue date", () => {
    const { raw, context } = fixture();
    const result = normalizeSavedPermitStackResponse(raw, context);
    expect(result.records[0]).toMatchObject({
      providerStatus: "ISSUED",
      nativeStatus: null,
      sourceStatusKind: "provider_normalized",
      supportedLifecycle: "unknown",
      statusBasis: "provider_issued_only",
      issuedMoreThanFiveYearsAgo: true,
      currentlyReportedActiveIssuedMoreThanFiveYearsAgo: false,
      continuousOpenDays: null,
    });
    expect(result.sourceEnvelope).toMatchObject({
      requestedPerPage: 100,
      actualPerPage: 50,
    });
  });
  it("supports transparent fresh provider-active plus age-since-issue without inventing continuity", () => {
    const { raw, context } = fixture({ status: "IN_PROGRESS" });
    const record = normalizeSavedPermitStackResponse(raw, context).records[0]!;
    expect(record).toMatchObject({
      providerStatus: "IN_PROGRESS",
      nativeStatus: null,
      activityClaim: "provider_reported_active",
      supportedLifecycle: "open",
      statusBasis: "provider_reported_active",
      currentlyReportedActiveIssuedMoreThanFiveYearsAgo: true,
      ageBasis: "age_since_issue",
      continuousOpenDays: null,
    });
  });
  it("keeps no-issue-date plan-review ambiguity explicit", () => {
    const { raw, context } = fixture({
      status: "IN_PROGRESS",
      date_issued: null,
    });
    const record = normalizeSavedPermitStackResponse(raw, context).records[0]!;
    expect(record.activityClaim).toBe("provider_reported_active");
    expect(record.ageSinceIssueDays).toBeNull();
    expect(record.limitations.join(" ")).toContain("plan review");
  });
  it("does not qualify stale or access-blocked provider evidence as current", () => {
    const { raw, context } = fixture({ status: "IN_PROGRESS" });
    for (const coverage of [
      { ...context.coverage, dataThrough: "2020-01-01" },
      { ...context.coverage, accessBlocked: true },
    ]) {
      expect(
        normalizeSavedPermitStackResponse(raw, { ...context, coverage })
          .records[0]!.activityClaim,
      ).toBe("not_established");
    }
  });
  it("strips owner/applicant/contact/site-address fields from the protected allowlist", () => {
    const { raw, context } = fixture();
    const projected = JSON.stringify(
      normalizeSavedPermitStackResponse(raw, context),
    );
    for (const privateValue of [
      row.owner_name,
      row.owner_address,
      row.applicant_name,
      row.phone,
      row.email,
      row.address_street,
    ])
      expect(projected).not.toContain(privateValue);
    expect(projected).toContain("Synthetic Roofing LLC");
  });
  it.each([
    { status: "NEW_UNDOCUMENTED_STATUS" },
    { date_issued: "2027-01-01" },
    { date_issued: "not-a-date" },
    { record_kind: "contractor" },
    { jurisdiction_name: "Troy elsewhere" },
    { address_state: "CA" },
  ])(
    "rejects unsupported source facts or query mismatch without silent coercion",
    (change) => {
      const { raw, context } = fixture(change);
      expect(() => normalizeSavedPermitStackResponse(raw, context)).toThrow(
        "evidence rejected",
      );
    },
  );
  it("rejects unreviewed rights and a mismatched source body hash", () => {
    const { raw, context } = fixture();
    expect(() =>
      normalizeSavedPermitStackResponse(raw, {
        ...context,
        responseSha256: "f".repeat(64),
      }),
    ).toThrow();
    expect(() =>
      normalizeSavedPermitStackResponse(raw, {
        ...context,
        rights: { ...context.rights, protectedDisplayAllowed: false },
      }),
    ).toThrow();
  });
  it("keeps a withheld join explicit rather than inventing property identity", () => {
    const { raw, context } = fixture();
    expect(
      normalizeSavedPermitStackResponse(raw, {
        ...context,
        joinsByProviderId: {},
      }).records[0]!.canonicalPropertyId,
    ).toBeNull();
    const mismatch = {
      ...context.joinsByProviderId["synthetic-permit-1"],
      providerRecordDigest: "f".repeat(64),
    };
    expect(() =>
      normalizeSavedPermitStackResponse(raw, {
        ...context,
        joinsByProviderId: { "synthetic-permit-1": mismatch },
      }),
    ).toThrow();
  });
  it("requires independent same-identity history for a continuous interval", () => {
    const { raw, context } = fixture({ status: "IN_PROGRESS" });
    const native = {
      permitNumber: "SYNTHETIC-PERMIT",
      jurisdiction: "Troy",
      nativeStatus: "OPEN",
      lifecycle: "open",
      openedAt: "2010-01-01",
      closedAt: null,
      continuousOpenFrom: "2011-01-01",
      historyContinuity: "documented",
      independentlyReviewed: true,
      sourceStatusKind: "municipal_native",
      reference: {
        sourceId: "synthetic-native-fixture",
        sourceUrl: "https://bsaonline.com/?uid=406",
        recordSha256: "f".repeat(64),
        observedAt: stamp,
        rightsTier: "protected",
      },
    };
    const record = normalizeSavedPermitStackResponse(raw, {
      ...context,
      nativeStatusEvidenceByProviderId: { "synthetic-permit-1": native },
    }).records[0]!;
    expect(record.continuousOpenDays).toBeGreaterThan(5000);
    expect(record.statusBasis).toBe("independent_native_status");
    expect(() =>
      normalizeSavedPermitStackResponse(raw, {
        ...context,
        nativeStatusEvidenceByProviderId: {
          "synthetic-permit-1": { ...native, permitNumber: "OTHER-SYNTHETIC" },
        },
      }),
    ).toThrow();
  });
});
