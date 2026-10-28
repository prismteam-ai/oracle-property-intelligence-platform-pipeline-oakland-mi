/** Source groups with their own reported data-through date; capture time is never substituted. */
export interface SourceFreshnessSummary {
  knownDataThroughDates: readonly string[];
  unknownCohorts: number;
}
/** Date-only cutoffs use UTC midnight, making this a conservative age upper bound. */
export function sourceFreshnessMetrics(
  summary: SourceFreshnessSummary | undefined,
  nowMs = Date.now(),
) {
  let unknownCohorts =
    summary &&
    Number.isSafeInteger(summary.unknownCohorts) &&
    summary.unknownCohorts >= 0
      ? summary.unknownCohorts
      : 1;
  const ages: number[] = [];
  for (const value of summary?.knownDataThroughDates ?? []) {
    const timestamp = Date.parse(value);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== value ||
      timestamp > nowMs
    )
      unknownCohorts++;
    else ages.push(Math.floor((nowMs - timestamp) / 1000));
  }
  return {
    knownCohorts: ages.length,
    unknownCohorts,
    maxDataThroughAgeUpperBoundSeconds: ages.length ? Math.max(...ages) : null,
  };
}
