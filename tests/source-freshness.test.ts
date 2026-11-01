import { expect, it } from "vitest";
import { sourceFreshnessMetrics } from "../packages/hosted-runtime/src/source-freshness.ts";
it("emits age only from valid reported data-through dates and counts unknown source groups", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  expect(
    sourceFreshnessMetrics(
      {
        knownDataThroughDates: ["2026-10-20", "2026-10-19"],
        unknownCohorts: 2,
      },
      now,
    ),
  ).toEqual({
    knownCohorts: 2,
    unknownCohorts: 2,
    maxDataThroughAgeUpperBoundSeconds: 9.5 * 86400,
  });
});
it("never fabricates a zero freshness age for absent, invalid or future data-through dates", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  expect(sourceFreshnessMetrics(undefined, now)).toEqual({
    knownCohorts: 0,
    unknownCohorts: 1,
    maxDataThroughAgeUpperBoundSeconds: null,
  });
  expect(
    sourceFreshnessMetrics(
      {
        knownDataThroughDates: [
          "2026-02-30",
          "2026-10-29",
          "SYNTHETIC_PRIVATE_CANARY",
        ],
        unknownCohorts: 1,
      },
      now,
    ),
  ).toEqual({
    knownCohorts: 0,
    unknownCohorts: 4,
    maxDataThroughAgeUpperBoundSeconds: null,
  });
});
