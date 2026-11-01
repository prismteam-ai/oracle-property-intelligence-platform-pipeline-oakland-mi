import { expect, it } from "vitest";
import {
  ProviderPermitObservationSchema,
  RecordedTransferIndexObservationSchema,
  QuerySchema,
  recordedDeedGapMatches,
} from "../packages/contracts/src/index.ts";
import { permitMatchesQuery } from "../packages/contracts/src/query-predicates.ts";
import {
  observation,
  deed,
  query,
  permit,
  hash,
} from "./p6-observations.fixture.ts";

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
it("independently observed native closure defeats provider activity without rewriting retained municipal facts", () => {
  const value = permit("IN_PROGRESS");
  const closed = ProviderPermitObservationSchema.parse({
    ...observation(),
    nativeStatus: "CLOSED",
    supportedLifecycle: "closed",
    statusBasis: "independent_native_status",
    provenance: {
      ...observation().provenance,
      nativeStatusReceiptSha256: hash,
    },
  });
  value.sourceObservations!.push(closed);
  expect(value.status).toBe("unknown");
  expect(
    permitMatchesQuery(
      value,
      { ...query, permitStatus: "closed" },
      "2026-10-28",
    ),
  ).toBe(true);
  expect(
    permitMatchesQuery(value, { ...query, permitStatus: "open" }, "2026-10-28"),
  ).toBe(false);
});
it("retains municipal other while independently qualifying a provider roofing candidate", () => {
  const value = { ...permit(), kind: "other" as const };
  expect(
    permitMatchesQuery(
      value,
      { ...query, providerPermitStatus: "ISSUED" },
      "2026-10-28",
    ),
  ).toBe(true);
  expect(permitMatchesQuery(value, query, "2026-10-28")).toBe(true);
  expect(value.kind).toBe("other");
  expect(
    permitMatchesQuery(
      value,
      { ...query, permitActivityClaim: "native_reported_open" },
      "2026-10-28",
    ),
  ).toBe(false);
  expect(
    permitMatchesQuery(value, { ...query, minOpenDays: 1 }, "2026-10-28"),
  ).toBe(false);
});
