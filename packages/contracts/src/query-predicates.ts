import { recordedDeedGapMatches } from "./source-observations.ts";
import type { Permit, Property, Query, QueryInput } from "./index.ts";
const EARTH_RADIUS_METERS = 6371008.8;
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const r = Math.PI / 180,
    a = (lat2 - lat1) * r,
    b = (lng2 - lng1) * r;
  const h =
    Math.sin(a / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(b / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function openDays(openedAt: string | null, asOf: string): number | null {
  if (!openedAt || openedAt > asOf) return null;
  const start = Date.parse(openedAt),
    end = Date.parse(asOf);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    new Date(start).toISOString().slice(0, 10) !== openedAt
  )
    return null;
  return Math.floor((end - start) / 86400000);
}
export function observedPermitStatus(permit: Permit): Permit["status"] {
  if (permit.status === "open" && permit.closedAt !== null) return "unknown";
  if (permit.statusBasis === "issued_only" || permit.statusBasis === "unknown")
    return permit.sourceObservations?.some(
      (row) => row.supportedLifecycle === "open",
    )
      ? "open"
      : "unknown";
  if (permit.statusBasis === "explicit_closed" && permit.status !== "closed")
    return "unknown";
  if (
    permit.statusBasis === "explicit_open" &&
    (permit.status !== "open" || permit.closedAt !== null)
  )
    return "unknown";
  if (
    permit.status === "unknown" &&
    permit.sourceObservations?.some((row) => row.supportedLifecycle === "open")
  )
    return "open";
  return permit.status;
}
/** Explicit observations are frozen at statusObservedAt; legacy fixtures retain their supplied asOf. */
export function observedPermitOpenDays(
  permit: Permit,
  asOf: string,
): number | null {
  if (
    observedPermitStatus(permit) !== "open" ||
    permit.kind === "other" ||
    permit.closedAt !== null
  )
    return null;
  const date =
    permit.statusBasis === "explicit_open"
      ? permit.statusObservedAt?.slice(0, 10)
      : asOf;
  const nativeDays = date ? openDays(permit.openedAt, date) : null;
  if (nativeDays !== null) return nativeDays;
  const documented = Math.max(
    -1,
    ...(permit.sourceObservations ?? [])
      .filter((row) => row.activityClaim === "native_reported_open")
      .map((row) => row.continuousOpenDays ?? -1),
  );
  return documented < 0 ? null : documented;
}
/** A reported sale is a partial observation; a transfer/tenure date is never substituted. */
export function latestReportedSale(property: Property): string | null {
  const dates = (property.ownership.events ?? [])
    .filter((e) => e.kind === "reported_sale")
    .map((e) => e.date)
    .sort();
  return dates.at(-1) ?? null;
}
export function reportedSaleOlderThan(
  property: Property,
  years: number,
): boolean {
  const sale = latestReportedSale(property),
    cutoff = new Date(property.roof.asOf);
  if (!sale || !Number.isFinite(cutoff.valueOf()) || sale > property.roof.asOf)
    return false;
  const month = cutoff.getUTCMonth(),
    day = cutoff.getUTCDate(),
    year = cutoff.getUTCFullYear() - years;
  cutoff.setUTCDate(1);
  cutoff.setUTCFullYear(year);
  cutoff.setUTCMonth(month);
  cutoff.setUTCDate(
    Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate()),
  );
  return sale < cutoff.toISOString().slice(0, 10);
}

/** Presence is not active eligibility; reported applicant names never establish a contractor. */
export function permitEvidenceMatches(permit: Permit, query: Query): boolean {
  if (query.requiresContractor && !permit.contractor.verifiedCompanyId?.trim())
    return false;
  if (
    query.requiresVerifiedLicense &&
    (!permit.contractor.licenseEvidence?.identifier.trim() ||
      permit.contractor.licenseEvidence.confidence !== "high")
  )
    return false;
  if (
    query.requiresBbbRating &&
    !permit.contractor.ratingEvidence?.value.trim()
  )
    return false;
  return true;
}

export function needsPermitEvidence(query: Query): boolean {
  return Boolean(
    query.requiresContractor ||
    query.requiresVerifiedLicense ||
    query.requiresBbbRating ||
    query.providerPermitStatus !== undefined ||
    query.permitActivityClaim !== undefined ||
    query.minPermitAgeSinceIssueDays !== undefined,
  );
}

export function hasMinimumVerifiedTenure(
  property: Property,
  years: number,
): boolean {
  const coverage = property.ownership.transferHistoryCoverage;
  const tenure = property.ownership.uninterruptedTenure;
  const asOf = property.roof.asOf;
  if (
    coverage?.state !== "full" ||
    !coverage.from ||
    !coverage.through ||
    coverage.provenance.length === 0 ||
    tenure?.state !== "supported" ||
    !tenure.unchangedSince ||
    tenure.asOf !== asOf ||
    tenure.provenance.length === 0 ||
    coverage.through < asOf ||
    tenure.unchangedSince > asOf ||
    (property.ownership.events ?? []).some(
      (event) =>
        event.kind === "recorded_transfer" &&
        event.date > tenure.unchangedSince! &&
        event.date <= asOf,
    )
  )
    return false;
  // Forward calendar anniversaries preserve the established leap-day month-end rule.
  const anniversary = (date: string) => {
    const value = new Date(date),
      month = value.getUTCMonth(),
      day = value.getUTCDate();
    value.setUTCDate(1);
    value.setUTCFullYear(value.getUTCFullYear() + years);
    value.setUTCMonth(month);
    value.setUTCDate(
      Math.min(
        day,
        new Date(Date.UTC(value.getUTCFullYear(), month + 1, 0)).getUTCDate(),
      ),
    );
    return value.toISOString().slice(0, 10);
  };
  return (
    anniversary(coverage.from) <= asOf &&
    anniversary(tenure.unchangedSince) <= asOf
  );
}

/** Client, model and native parity checks share the exact business-predicate definition. */
export function propertyMatchesQuery(
  property: Property,
  input: QueryInput,
): boolean {
  if (
    !property.coordinates ||
    distanceMeters(
      input.lat,
      input.lng,
      property.coordinates.lat,
      property.coordinates.lng,
    ) >
      input.radiusMeters + 0.01
  )
    return false;
  if (
    input.ownerRegion &&
    input.ownerRegion !== "any" &&
    property.ownership.ownerRegion !== input.ownerRegion
  )
    return false;
  if (
    input.roofMinAgeYears !== undefined &&
    (property.roof.ageYears === null
      ? !input.includeUnknown
      : property.roof.ageYears <= input.roofMinAgeYears)
  )
    return false;
  const confidence = { high: 3, medium: 2, low: 1, unknown: 0 };
  if (
    input.minConfidence &&
    input.minConfidence !== "any" &&
    confidence[property.roof.confidence] < confidence[input.minConfidence]
  )
    return false;
  if (
    input.minReportedSaleAgeYears !== undefined &&
    !reportedSaleOlderThan(property, input.minReportedSaleAgeYears)
  )
    return false;
  if (
    input.minRecordedDeedGapYears !== undefined &&
    !(property.ownership.recordedTransferIndexObservations ?? []).some((row) =>
      recordedDeedGapMatches(row, input.minRecordedDeedGapYears!),
    )
  )
    return false;
  if (
    input.minOwnershipYears !== undefined &&
    !hasMinimumVerifiedTenure(property, input.minOwnershipYears)
  )
    return false;
  if (
    (input.permitStatus ?? "any") !== "any" ||
    (input.minOpenDays ?? 0) > 0 ||
    needsPermitEvidence(input as Query)
  )
    return property.permits.some((permit) =>
      permitMatchesQuery(permit, input, property.roof.asOf),
    );
  return true;
}

export function permitMatchesQuery(
  permit: Permit,
  input: QueryInput,
  asOf: string,
): boolean {
  const query = {
    ...input,
    permitStatus: input.permitStatus ?? "any",
    minOpenDays: input.minOpenDays ?? 0,
  } as Query;
  return (
    permit.kind !== "other" &&
    permitEvidenceMatches(permit, query) &&
    permitSourceObservationMatches(permit, query) &&
    (query.permitStatus === "any" ||
      observedPermitStatus(permit) === query.permitStatus) &&
    (query.minOpenDays === 0 ||
      (observedPermitOpenDays(permit, asOf) ?? -1) >= query.minOpenDays)
  );
}
export function qualifyingOpenDuration(
  property: Property,
  query: QueryInput,
): number {
  return Math.max(
    -1,
    ...property.permits
      .filter((permit) => permitMatchesQuery(permit, query, property.roof.asOf))
      .map(
        (permit) => observedPermitOpenDays(permit, property.roof.asOf) ?? -1,
      ),
  );
}
/** Rank only qualifying evidence; another permit on the same property cannot supply priority. */
export function compareQueryRows(
  a: Property & { distanceMeters: number },
  b: Property & { distanceMeters: number },
  query: QueryInput,
): number {
  const priority =
    query.sort === "roof_age_desc"
      ? (b.roof.ageYears ?? -1) - (a.roof.ageYears ?? -1)
      : query.sort === "permit_open_days_desc" ||
          (!query.sort &&
            (query.permitStatus === "open" || (query.minOpenDays ?? 0) > 0))
        ? qualifyingOpenDuration(b, query) - qualifyingOpenDuration(a, query)
        : 0;
  return (
    priority ||
    a.distanceMeters - b.distanceMeters ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** One source observation must satisfy all source status/activity/age constraints. */
export function permitSourceObservationMatches(
  permit: Permit,
  input: QueryInput,
): boolean {
  if (
    input.providerPermitStatus === undefined &&
    input.permitActivityClaim === undefined &&
    input.minPermitAgeSinceIssueDays === undefined
  )
    return true;
  return (permit.sourceObservations ?? []).some(
    (row) =>
      (input.providerPermitStatus === undefined ||
        row.providerStatus === input.providerPermitStatus) &&
      (input.permitActivityClaim === undefined ||
        row.activityClaim === input.permitActivityClaim) &&
      (input.minPermitAgeSinceIssueDays === undefined ||
        (row.ageSinceIssueDays !== null &&
          row.ageSinceIssueDays >= input.minPermitAgeSinceIssueDays)) &&
      ((input.permitStatus ?? "any") === "any" ||
        row.supportedLifecycle === input.permitStatus) &&
      ((input.minOpenDays ?? 0) === 0 ||
        (row.activityClaim === "native_reported_open" &&
          (row.continuousOpenDays ?? -1) >= input.minOpenDays!)),
  );
}
