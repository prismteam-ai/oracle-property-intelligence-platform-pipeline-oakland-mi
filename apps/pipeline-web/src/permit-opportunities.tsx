import type {
  Property,
  QueryInput,
} from "../../../packages/contracts/src/index.ts";
import {
  allPermitSignals,
  qualifyingPermitSignals,
  type PermitOpportunitySignal,
} from "../../../packages/contracts/src/query-predicates.ts";
const labels: Record<PermitOpportunitySignal["leadSignal"], string> = {
  confirmed_open: "Confirmed open / active",
  status_verification_needed: "Status verification needed",
  other_permit_activity: "Other roofing-permit activity",
  confirmed_closed: "Confirmed closed / final",
  unknown: "Unknown",
};
export function PermitOpportunityBadges({
  property,
  query,
}: {
  property: Property;
  query: QueryInput | null;
}) {
  if (!query?.permitOpportunityMode) return null;
  const signals = qualifyingPermitSignals(property, query),
    first = signals[0];
  return first ? (
    <div
      data-testid="permit-opportunity-badge"
      data-private-evidence={
        first.sourceKind === "provider_observation"
          ? "provider-derived-permit-evidence"
          : undefined
      }
    >
      <strong>{labels[first.leadSignal]}</strong>
      <small>
        {first.dateBasis === "issued"
          ? "Issued"
          : first.dateBasis === "filed"
            ? "Filed"
            : "Date unavailable"}{" "}
        {first.observationDate ?? "Unavailable"} ·{" "}
        {first.ageDays === null
          ? "Age unavailable"
          : `${first.ageDays} days since ${first.dateBasis}`}{" "}
        · {signals.length} qualifying observations
      </small>
    </div>
  ) : null;
}
export function PermitOpportunityDetails({
  property,
  query,
}: {
  property: Property;
  query?: QueryInput;
}) {
  const signals = query?.permitOpportunityMode
    ? qualifyingPermitSignals(property, query)
    : allPermitSignals(property);
  return (
    <section aria-label="Permit opportunity evidence">
      <h3>Permit opportunity evidence</h3>
      {signals.length === 0 ? (
        <p>
          No qualified permit observation is available; this does not prove
          permit absence.
        </p>
      ) : (
        signals.map((signal) => (
          <article
            className="notice compact"
            key={signal.observationId}
            data-private-evidence={
              signal.sourceKind === "provider_observation"
                ? "provider-derived-permit-evidence"
                : undefined
            }
          >
            <h4>{labels[signal.leadSignal]}</h4>
            <p>
              {signal.permitNumber ?? signal.permitId} ·{" "}
              {signal.jurisdiction ?? "Jurisdiction unavailable"}
            </p>
            <p>
              Lifecycle: {signal.lifecycleState.replaceAll("_", " ")} · native
              status: {signal.nativeStatus ?? "Unavailable"} · source status
              basis: {signal.statusBasis}
            </p>
            {signal.reportedStatus !== null && (
              <p>
                Reported {signal.statusKind.replaceAll("_", " ")}:{" "}
                {signal.reportedStatus}
              </p>
            )}
            <p>
              {signal.dateBasis === "not_available"
                ? "Issue/filed/status date unavailable"
                : `${signal.dateBasis}: ${signal.observationDate}`}{" "}
              ·{" "}
              {signal.ageDays === null
                ? "Age unavailable"
                : `${signal.ageDays} days since ${signal.dateBasis}`}{" "}
              · assessed {signal.assessmentAt ?? "Unavailable"}
            </p>
            {signal.openDays !== null && (
              <p>
                Justified open interval: {signal.openDays} days at the source
                observation.
              </p>
            )}
            <p>
              Reported party: {signal.party.reportedName ?? "Unavailable"} ·{" "}
              {signal.party.role ?? "Role unavailable"}.{" "}
              {signal.party.verifiedContractorIdentity
                ? "Explicit verified identity evidence retained."
                : "Verified contractor identity is not established."}{" "}
              License: {signal.party.licenseIdentifier ?? "Unavailable"}.
            </p>
            <p>
              Source {signal.sourceId} · record {signal.provenance.recordId} ·
              join confidence {signal.joinConfidence}
            </p>
            <code>{signal.provenance.recordDigest}</code>
            {signal.limitations.map((text, index) => (
              <p key={index}>{text}</p>
            ))}
          </article>
        ))
      )}
    </section>
  );
}
