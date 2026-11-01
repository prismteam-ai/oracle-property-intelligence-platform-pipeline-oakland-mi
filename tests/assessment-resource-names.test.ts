import { expect, it } from "vitest";
import { assessmentResourceNames } from "../infra/cdk/resource-names.ts";
it("keeps full application stack prefixes and service name bounds without relying on automatic truncation", () => {
  const names = assessmentResourceNames(
    "PrismOracleAssessmentReview",
    "234567890123",
    "us-east-2",
  );
  expect(names.protectedBucket).toBe(
    "prismoracleassessmentreview-protected-234567890123-us-east-2",
  );
  for (const key of [
    "siteBucket",
    "acceptedBucket",
    "protectedBucket",
  ] as const) {
    expect(names[key].length).toBeLessThanOrEqual(63);
    expect(names[key]).toMatch(/^prismoracleassessmentreview-/);
  }
  for (const key of ["readApiRole", "alertRole"] as const) {
    expect(names[key].length).toBeLessThanOrEqual(64);
    expect(names[key]).toMatch(/^PrismOracleAssessmentReview-/);
  }
  expect(names.accessSecret).toBe("PrismOracleAssessmentReview-ReviewAccess");
  expect(names.pagerDutySecret).toBe(
    "PrismOracleAssessmentReview-PagerDutyRouting",
  );
  expect(names.retentionParameter).toBe(
    "PrismOracleAssessmentReview-ReviewRetention",
  );
  expect(() =>
    assessmentResourceNames("A".repeat(60), "234567890123", "us-east-2"),
  ).toThrow("bounds");
  expect(() =>
    assessmentResourceNames(
      "PrismOracleAssessmentReview",
      "234567890123",
      "us-east-1",
    ),
  ).toThrow();
});
