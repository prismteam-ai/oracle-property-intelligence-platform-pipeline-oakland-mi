import {
  recordedDeedGapMatches,
  sourceCalendarAnniversary,
} from "./source-observations.ts";
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
  if (
    permit.status === "closed" &&
    permit.statusBasis !== "issued_only" &&
    permit.statusBasis !== "unknown"
  )
    return "closed";
  if (permit.status === "open" && permit.closedAt !== null) return "unknown";
  if (permit.statusBasis === "explicit_closed" && permit.status !== "closed")
    return "unknown";
  if (
    permit.statusBasis === "explicit_open" &&
    (permit.status !== "open" || permit.closedAt !== null)
  )
    return "unknown";
  if (
    permit.status === "open" &&
    permit.statusBasis !== "issued_only" &&
    permit.statusBasis !== "unknown"
  )
    return "open";
  if (
    permit.sourceObservations?.some(
      (row) => row.supportedLifecycle === "closed",
    )
  )
    return "closed";
  if (
    permit.sourceObservations?.some((row) => row.supportedLifecycle === "open")
  )
    return "open";
  return permit.statusBasis === "issued_only" ||
    permit.statusBasis === "unknown"
    ? "unknown"
    : permit.status;
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
    query.permitOpportunityMode !== undefined ||
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
  if (input.permitOpportunityMode !== undefined)
    return qualifyingPermitObservationSignals(permit, input, asOf).length > 0;
  const query = {
    ...input,
    permitStatus: input.permitStatus ?? "any",
    minOpenDays: input.minOpenDays ?? 0,
  } as Query;
  return (
    roofingCandidateMatches(permit, input) &&
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
  if (query.permitOpportunityMode)
    return Math.max(
      -1,
      ...qualifyingPermitSignals(property, query).map(
        (signal) => signal.openDays ?? -1,
      ),
    );
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
  if (
    query.sort === "permit_issue_age_desc" ||
    (!query.sort &&
      query.permitOpportunityMode === "status_verification_needed")
  ) {
    const best = (p: Property) => qualifyingPermitSignals(p, query)[0];
    const aa = best(a),
      bb = best(b);
    const age = (bb?.ageDays ?? -1) - (aa?.ageDays ?? -1);
    const confidence =
      (bb ? signalConfidenceRank(bb) : -1) -
      (aa ? signalConfidenceRank(aa) : -1);
    if (age || confidence) return age || confidence;
  }
  const priority =
    query.sort === "roof_age_desc"
      ? (b.roof.ageYears ?? -1) - (a.roof.ageYears ?? -1)
      : query.sort === "permit_open_days_desc" ||
          (!query.sort &&
            (query.permitStatus === "open" ||
              query.permitOpportunityMode === "confirmed_open" ||
              (query.minOpenDays ?? 0) > 0))
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

/** Provider roofing classification is a separate candidate basis; native duration/activity constraints retain native roofing scope. */
export function roofingCandidateMatches(
  permit: Permit,
  input: QueryInput,
): boolean {
  return (
    permit.kind !== "other" ||
    ((input.minOpenDays ?? 0) === 0 &&
      input.permitActivityClaim !== "native_reported_open" &&
      (permit.sourceObservations ?? []).some(
        (row) =>
          row.category === "ROOFING" &&
          row.categoryBasis === "provider_classification",
      ))
  );
}

/** Query-derived facts only. Canonical permit/source records are never rewritten. */
export interface PermitOpportunitySignal {
  permitId: string;
  observationId: string;
  sourceKind: "native_permit" | "provider_observation";
  sourceId: string;
  permitNumber: string | null;
  jurisdiction: string | null;
  roofingRelated: boolean;
  roofingBasis:
    "native_roof_kind" | "provider_classification" | "not_established";
  nativeStatus: string | null;
  reportedStatus: string | null;
  statusKind: "source_native" | "provider_normalized" | "unknown";
  statusBasis: string;
  openDays: number | null;
  lifecycleState: "confirmed_open" | "confirmed_closed" | "unknown";
  leadSignal:
    | "confirmed_open"
    | "status_verification_needed"
    | "other_permit_activity"
    | "confirmed_closed"
    | "unknown";
  terminalEvidence: {
    excludedFromVerification: boolean;
    reportedTerminalStatus: string | null;
    basis: string | null;
    vetoProvenance: PermitTerminalAuthority[];
  };
  observationDate: string | null;
  dateBasis: "issued" | "filed" | "status_date" | "not_available";
  assessmentAt: string | null;
  ageDays: number | null;
  minAgeYears: number;
  olderThanThreshold: boolean;
  joinConfidence: "high" | "medium" | "low" | "unknown";
  party: {
    reportedName: string | null;
    role: string | null;
    verifiedContractorIdentity: boolean;
    licenseIdentifier: string | null;
  };
  provenance: {
    sourceId: string;
    recordId: string;
    recordDigest: string;
    observedAt: string;
    termsSha256: string | null;
    canonicalJoinReceiptSha256: string | null;
  };
  limitations: string[];
}
export interface PermitTerminalAuthority {
  sourceId: string;
  recordId: string;
  recordDigest: string;
  observedAt: string;
  reportedStatus: string | null;
  date: string | null;
  basis: string;
}
const TERMINAL_STATUS =
  /^(?:CLOSED|FINAL|FINALED|COMPLETED|CANCELLED|CANCELED|REVOKED|EXPIRED)$/i;
const validDate = (date: string | null | undefined): date is string =>
  typeof date === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date)) &&
  new Date(date).toISOString().slice(0, 10) === date;
const sourceStamp = (value: string | null | undefined): string | null =>
  typeof value === "string" &&
  Number.isFinite(Date.parse(value)) &&
  validDate(value.slice(0, 10))
    ? value
    : null;
function nonProviderCitations(permit: Permit) {
  return permit.provenance.filter(
    (citation) =>
      !(permit.sourceObservations ?? []).some(
        (row) =>
          citation.sourceId === row.provenance.sourceId &&
          citation.recordId === row.providerRecordId &&
          citation.digest === row.provenance.recordDigest,
      ),
  );
}
/** Current admitted source-profile boundary. Future native-source onboarding requires an explicit profile update. */
export const ADMITTED_NATIVE_PERMIT_SOURCES = [
  "official-troy-issued-permits",
  "official-independence-public-permits",
  "official-rochester-hills-building-permit-reports",
] as const;
function nativePermitCitations(permit: Permit) {
  return nonProviderCitations(permit).filter(
    (citation) =>
      citation.kind === "synthetic" ||
      ADMITTED_NATIVE_PERMIT_SOURCES.some(
        (source) => source === citation.sourceId,
      ),
  );
}
/** Separate native-status observations carry lifecycle authority only with the admitted explicit basis and exact observation stamp. */
function nativeLifecycleCitations(permit: Permit) {
  const primary = nativePermitCitations(permit);
  const explicit =
    (permit.statusBasis === "explicit_open" && permit.status === "open") ||
    (permit.statusBasis === "explicit_closed" && permit.status === "closed");
  return [
    ...primary,
    ...nonProviderCitations(permit).filter(
      (citation) =>
        !primary.includes(citation) &&
        explicit &&
        sourceStamp(permit.statusObservedAt) !== null &&
        Date.parse(citation.observedAt) ===
          Date.parse(permit.statusObservedAt!) &&
        [
          "official-troy-permit-status",
          "official-troy-bsa-permit-status",
        ].includes(citation.sourceId),
    ),
  ];
}
/** Terminal evidence is a same-permit exclusion, never borrowed positive issue-age evidence. */
function terminalAuthorities(permit: Permit): PermitTerminalAuthority[] {
  const result: PermitTerminalAuthority[] = [];
  for (const p of nativeLifecycleCitations(permit)) {
    const assessment =
      sourceStamp(permit.statusObservedAt) ?? sourceStamp(p.observedAt);
    const terminalDate =
      validDate(permit.closedAt) &&
      assessment &&
      permit.closedAt <= assessment.slice(0, 10)
        ? permit.closedAt
        : null;
    const status = permit.reportedStatus?.trim() ?? null;
    if (
      (status && TERMINAL_STATUS.test(status)) ||
      terminalDate ||
      (permit.status === "closed" &&
        permit.statusBasis !== "issued_only" &&
        permit.statusBasis !== "unknown")
    )
      result.push({
        sourceId: p.sourceId,
        recordId: p.recordId,
        recordDigest: p.digest,
        observedAt: p.observedAt,
        reportedStatus: status,
        date: terminalDate,
        basis: terminalDate
          ? "observed_closed_date"
          : status && TERMINAL_STATUS.test(status)
            ? "source_native_terminal_status"
            : "source_confirmed_closed",
      });
  }
  for (const row of permit.sourceObservations ?? []) {
    const terminalDate =
      [row.dateCompleted, row.dateExpired].find(
        (date) => validDate(date) && date <= row.assessmentAt.slice(0, 10),
      ) ?? null;
    const terminalStatus =
      [row.nativeStatus, row.providerStatus].find(
        (status) => status !== null && TERMINAL_STATUS.test(status.trim()),
      ) ?? null;
    if (terminalDate || terminalStatus || row.supportedLifecycle === "closed")
      result.push({
        sourceId: row.provenance.sourceId,
        recordId: row.providerRecordId,
        recordDigest: row.provenance.recordDigest,
        observedAt: row.sourceObservedAt,
        reportedStatus: terminalStatus,
        date: terminalDate,
        basis: terminalDate
          ? "observed_terminal_date"
          : terminalStatus
            ? "source_reported_terminal_status"
            : "source_confirmed_closed",
      });
  }
  return result;
}
/** Independent per-observation projection; native and provider positives never borrow fields. */
function permitSignals(
  permit: Permit,
  minAgeYears: number,
): PermitOpportunitySignal[] {
  if (!Number.isInteger(minAgeYears) || minAgeYears < 0 || minAgeYears > 200)
    throw new Error("Invalid source-calendar age threshold");
  const terminal = terminalAuthorities(permit);
  const native =
    nativeLifecycleCitations(permit).length > 0
      ? observedPermitStatus({ ...permit, sourceObservations: [] })
      : "unknown";
  const anyOpen =
    native === "open" ||
    (permit.sourceObservations ?? []).some(
      (row) => row.supportedLifecycle === "open",
    );
  const confirmedClosed =
    native === "closed" ||
    (permit.sourceObservations ?? []).some(
      (row) => row.supportedLifecycle === "closed",
    );
  const confidence = permit.matchEvidence?.confidence ?? "unknown";
  const finalize = (
    signal: Omit<
      PermitOpportunitySignal,
      | "observationId"
      | "terminalEvidence"
      | "ageDays"
      | "minAgeYears"
      | "olderThanThreshold"
      | "leadSignal"
      | "joinConfidence"
    >,
  ): PermitOpportunitySignal => {
    const asOf = signal.assessmentAt?.slice(0, 10);
    const dated =
      signal.observationDate !== null &&
      validDate(signal.observationDate) &&
      asOf !== undefined &&
      validDate(asOf) &&
      signal.observationDate <= asOf;
    const ageDays = dated
      ? Math.floor(
          (Date.parse(asOf) - Date.parse(signal.observationDate!)) / 86400000,
        )
      : null;
    const olderThanThreshold =
      dated &&
      signal.observationDate! < sourceCalendarAnniversary(asOf, -minAgeYears);
    const lifecycleState = confirmedClosed
      ? ("confirmed_closed" as const)
      : terminal.length > 0 && signal.lifecycleState === "confirmed_open"
        ? ("unknown" as const)
        : signal.lifecycleState;
    const candidate =
      signal.roofingRelated &&
      lifecycleState === "unknown" &&
      !anyOpen &&
      terminal.length === 0 &&
      olderThanThreshold;
    return {
      ...signal,
      lifecycleState,
      observationId: JSON.stringify([
        signal.sourceKind,
        permit.id,
        signal.sourceId,
        signal.provenance.recordId,
        signal.provenance.recordDigest,
      ]),
      terminalEvidence: {
        excludedFromVerification: terminal.length > 0,
        reportedTerminalStatus: terminal[0]?.reportedStatus ?? null,
        basis: terminal[0]?.basis ?? null,
        vetoProvenance: terminal,
      },
      ageDays,
      minAgeYears,
      olderThanThreshold,
      joinConfidence: confidence,
      leadSignal:
        lifecycleState === "confirmed_closed"
          ? "confirmed_closed"
          : lifecycleState === "confirmed_open"
            ? "confirmed_open"
            : candidate
              ? "status_verification_needed"
              : signal.roofingRelated
                ? "other_permit_activity"
                : "unknown",
      limitations: [
        ...signal.limitations,
        ...(candidate
          ? [
              "Status verification needed: this older roofing-permit observation does not establish current open lifecycle; verify with the municipality.",
            ]
          : []),
      ],
    };
  };
  const signals: PermitOpportunitySignal[] = nativePermitCitations(permit).map(
    (p) =>
      finalize({
        permitId: permit.id,
        sourceKind: "native_permit",
        sourceId: p.sourceId,
        permitNumber: permit.permitNumber ?? null,
        jurisdiction: permit.jurisdiction ?? null,
        roofingRelated: permit.kind !== "other",
        roofingBasis:
          permit.kind !== "other" ? "native_roof_kind" : "not_established",
        nativeStatus: permit.reportedStatus ?? null,
        reportedStatus: permit.reportedStatus ?? null,
        statusKind: permit.reportedStatus == null ? "unknown" : "source_native",
        statusBasis: permit.statusBasis ?? "unknown",
        openDays: observedPermitOpenDays(
          { ...permit, sourceObservations: [] },
          (
            sourceStamp(permit.statusObservedAt) ?? sourceStamp(p.observedAt)
          )?.slice(0, 10) ?? "",
        ),
        lifecycleState:
          native === "open"
            ? "confirmed_open"
            : native === "closed"
              ? "confirmed_closed"
              : "unknown",
        observationDate: validDate(permit.issuedAt) ? permit.issuedAt : null,
        dateBasis: validDate(permit.issuedAt) ? "issued" : "not_available",
        assessmentAt:
          sourceStamp(permit.statusObservedAt) ?? sourceStamp(p.observedAt),
        party: {
          reportedName: permit.contractor.reportedName,
          role: permit.contractor.verifiedCompanyId
            ? "verified_contractor"
            : "source_reported_party_unverified",
          verifiedContractorIdentity: !!permit.contractor.verifiedCompanyId,
          licenseIdentifier:
            permit.contractor.licenseEvidence?.identifier ??
            permit.contractor.license,
        },
        provenance: {
          sourceId: p.sourceId,
          recordId: p.recordId,
          recordDigest: p.digest,
          observedAt: p.observedAt,
          termsSha256: null,
          canonicalJoinReceiptSha256: null,
        },
        limitations: [
          ...(permit.matchEvidence?.caveats ?? []),
          ...(permit.statusBasis === "issued_only"
            ? [
                "The admitted source reports issuance; native status is unavailable unless separately reported. Issuance is not open status.",
              ]
            : []),
        ],
      }),
  );
  for (const row of permit.sourceObservations ?? []) {
    const date = validDate(row.dateIssued)
      ? row.dateIssued
      : validDate(row.dateFiled)
        ? row.dateFiled
        : null;
    signals.push(
      finalize({
        permitId: permit.id,
        sourceKind: "provider_observation",
        sourceId: row.provenance.sourceId,
        permitNumber: row.permitNumber,
        jurisdiction: row.jurisdiction,
        roofingRelated: row.category === "ROOFING",
        roofingBasis: "provider_classification",
        nativeStatus: row.nativeStatus,
        reportedStatus: row.providerStatus,
        statusKind: "provider_normalized",
        statusBasis: row.statusBasis,
        openDays:
          row.activityClaim === "native_reported_open"
            ? row.continuousOpenDays
            : null,
        lifecycleState:
          row.supportedLifecycle === "open"
            ? "confirmed_open"
            : row.supportedLifecycle === "closed"
              ? "confirmed_closed"
              : "unknown",
        observationDate: date,
        dateBasis:
          date === null
            ? "not_available"
            : row.dateIssued === date
              ? "issued"
              : "filed",
        assessmentAt: sourceStamp(row.assessmentAt),
        party: {
          reportedName: row.reportedBusinessName,
          role: row.reportedBusinessRole,
          verifiedContractorIdentity: row.verifiedContractorIdentity,
          licenseIdentifier: row.contractorLicenseIdentifier,
        },
        provenance: {
          sourceId: row.provenance.sourceId,
          recordId: row.providerRecordId,
          recordDigest: row.provenance.recordDigest,
          observedAt: row.sourceObservedAt,
          termsSha256: row.provenance.termsSha256,
          canonicalJoinReceiptSha256: row.provenance.canonicalJoinReceiptSha256,
        },
        limitations: row.limitations,
      }),
    );
  }
  return signals.sort(
    (a, b) =>
      a.permitId.localeCompare(b.permitId) ||
      a.observationId.localeCompare(b.observationId),
  );
}
export function allPermitSignals(
  property: Property,
  minAgeYears = 5,
): PermitOpportunitySignal[] {
  return property.permits
    .flatMap((permit) => permitSignals(permit, minAgeYears))
    .sort(
      (a, b) =>
        a.permitId.localeCompare(b.permitId) ||
        a.observationId.localeCompare(b.observationId),
    );
}
export function signalConfidenceRank(signal: PermitOpportunitySignal): number {
  return { unknown: 0, low: 1, medium: 2, high: 3 }[signal.joinConfidence];
}
/** This extra pure adapter lets SQL readers use the identical classifier before pagination. */
export function qualifyingPermitObservationSignals(
  permit: Permit,
  query: QueryInput,
  asOf: string,
): PermitOpportunitySignal[] {
  const mode = query.permitOpportunityMode;
  if (!mode)
    return permitMatchesQuery(permit, query, asOf)
      ? permitSignals(permit, 5).filter((signal) => signal.roofingRelated)
      : [];
  const years =
    query.minPermitObservationAgeYears ??
    (mode === "status_verification_needed" ? 5 : 0);
  const observations = permit.sourceObservations ?? [];
  return permitSignals(permit, years)
    .filter((signal) => {
      if (!signal.roofingRelated) return false;
      if (
        query.minPermitObservationAgeYears !== undefined &&
        !signal.olderThanThreshold
      )
        return false;
      if (
        mode === "confirmed_open" &&
        signal.lifecycleState !== "confirmed_open"
      )
        return false;
      if (
        mode === "confirmed_closed" &&
        signal.lifecycleState !== "confirmed_closed"
      )
        return false;
      if (mode === "lifecycle_unknown" && signal.lifecycleState !== "unknown")
        return false;
      if (
        mode === "status_verification_needed" &&
        signal.leadSignal !== "status_verification_needed"
      )
        return false;
      const row =
        signal.sourceKind === "provider_observation"
          ? observations.find(
              (r) =>
                r.providerRecordId === signal.provenance.recordId &&
                r.provenance.recordDigest === signal.provenance.recordDigest &&
                r.provenance.sourceId === signal.sourceId,
            )
          : undefined;
      if (
        signal.sourceKind === "provider_observation" &&
        (query.requiresContractor ||
          query.requiresVerifiedLicense ||
          query.requiresBbbRating)
      )
        return false;
      if (
        signal.sourceKind === "native_permit" &&
        !permitEvidenceMatches(
          { ...permit, sourceObservations: [] },
          query as Query,
        )
      )
        return false;
      if (
        query.providerPermitStatus !== undefined &&
        row?.providerStatus !== query.providerPermitStatus
      )
        return false;
      if (
        query.permitActivityClaim !== undefined &&
        row?.activityClaim !== query.permitActivityClaim
      )
        return false;
      if (
        query.minPermitAgeSinceIssueDays !== undefined &&
        (row?.ageSinceIssueDays ?? -1) < query.minPermitAgeSinceIssueDays
      )
        return false;
      if (
        query.permitStatus &&
        query.permitStatus !== "any" &&
        signal.lifecycleState !==
          (
            {
              open: "confirmed_open",
              closed: "confirmed_closed",
              unknown: "unknown",
            } as const
          )[query.permitStatus]
      )
        return false;
      if ((query.minOpenDays ?? 0) > 0) {
        if ((signal.openDays ?? -1) < query.minOpenDays!) return false;
      }
      return true;
    })
    .sort((a, b) => comparePermitSignals(a, b, query));
}
export function qualifyingPermitSignals(
  property: Property,
  query: QueryInput,
): PermitOpportunitySignal[] {
  return property.permits
    .flatMap((permit) =>
      qualifyingPermitObservationSignals(permit, query, property.roof.asOf),
    )
    .sort((a, b) => comparePermitSignals(a, b, query));
}
export function permitOpportunityMatchesQuery(
  permit: Permit,
  query: QueryInput,
  asOf: string,
): boolean {
  return query.permitOpportunityMode === undefined
    ? permitMatchesQuery(permit, query, asOf)
    : qualifyingPermitObservationSignals(permit, query, asOf).length > 0;
}

function comparePermitSignals(
  a: PermitOpportunitySignal,
  b: PermitOpportunitySignal,
  query: QueryInput,
): number {
  const issue =
    query.sort === "permit_issue_age_desc" ||
    (!query.sort &&
      query.permitOpportunityMode === "status_verification_needed");
  const open =
    query.sort === "permit_open_days_desc" ||
    (!query.sort && query.permitOpportunityMode === "confirmed_open");
  const priority = issue
    ? (b.ageDays ?? -1) - (a.ageDays ?? -1) ||
      signalConfidenceRank(b) - signalConfidenceRank(a)
    : open
      ? (b.openDays ?? -1) - (a.openDays ?? -1)
      : 0;
  return (
    priority ||
    a.permitId.localeCompare(b.permitId) ||
    a.observationId.localeCompare(b.observationId)
  );
}
