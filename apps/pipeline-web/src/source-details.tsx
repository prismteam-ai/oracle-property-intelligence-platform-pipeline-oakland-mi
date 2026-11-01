import type {
  Permit,
  Property,
} from "../../../packages/contracts/src/index.ts";
/** Match parent provenance to its validated provider observation, not an ID/name pattern. */
export function isRestrictedProviderPermit(permit: Permit) {
  return (
    !!permit.sourceObservations?.length &&
    permit.provenance.length > 0 &&
    permit.provenance.every((citation) =>
      permit.sourceObservations!.some(
        (row) =>
          row.provenance.sourceId === citation.sourceId &&
          row.providerRecordId === citation.recordId &&
          row.provenance.recordDigest === citation.digest,
      ),
    )
  );
}
export function PermitSourceDetails({ permit }: { permit: Permit }) {
  return (
    <>
      {(permit.sourceObservations ?? []).map((row) => (
        <section
          className="notice compact restricted-source-evidence private-protected-evidence"
          data-source-classification="restricted_source"
          data-private-evidence
          key={row.providerRecordId}
        >
          <h4>Terms-restricted provider source observation</h4>
          {permit.kind === "other" && (
            <p>
              Classification disagreement: provider ROOFING; retained municipal
              category is other. This is a provider-qualified candidate, not
              native verified roofing.
            </p>
          )}
          <p>
            {row.provider} · {row.providerRecordId} · {row.sourceStatusKind}
          </p>
          <p>
            Provider status {row.providerStatus} · independently observed native
            status {row.nativeStatus ?? "Unavailable"} ·{" "}
            {row.statusBasis.replaceAll("_", " ")}
          </p>
          <p>
            Activity: {row.activityClaim.replaceAll("_", " ")} · supported
            lifecycle {row.supportedLifecycle}
          </p>
          <p>
            Issued {row.dateIssued ?? "Unknown"} · age since issue{" "}
            {row.ageSinceIssueDays ?? "Unknown"} days at {row.assessmentAt} ·
            continuous documented open interval{" "}
            {row.continuousOpenDays ?? "Unknown"} days
          </p>
          <p>
            Source observed {row.sourceObservedAt} · data through{" "}
            {row.sourceDataThrough ?? "Unknown"} · refreshed{" "}
            {row.sourceLastRefreshed ?? "Unknown"}
          </p>
          <p>
            Classification {row.category} (
            {row.categoryBasis.replaceAll("_", " ")}) · reported party{" "}
            {row.reportedBusinessName ?? "Unavailable"}; contractor identity and
            role unverified
          </p>
          <p>
            Source {row.provenance.sourceId} · source-specific evaluator use ·
            no public redistribution of restricted provider records
          </p>
          <code>{row.provenance.recordDigest}</code>
          {row.limitations.map((text) => (
            <p key={text}>{text}</p>
          ))}
        </section>
      ))}
    </>
  );
}
export function DeedSourceDetails({ property }: { property: Property }) {
  return (
    <>
      {(property.ownership.recordedTransferIndexObservations ?? []).map(
        (row) => (
          <section
            className="notice compact"
            data-source-classification="official_public"
            key={row.reference.recordSha256}
          >
            <h3>Official recorded-deed index observation</h3>
            <p>
              {row.noDeedObservedForMoreThanTenYears
                ? "No recorded deed transfer was observed for more than ten years in this current-PIN official-index query."
                : "Recent recorded deed dates were observed in this current-PIN official-index query."}
            </p>
            <p>
              Claim window {row.claimWindowStart} through {row.observedThrough}{" "}
              · latest observed deed{" "}
              {row.lastRecordedDeedDate ?? "None in query"} ·{" "}
              {row.deedDocumentCount} deed-like indexed documents
            </p>
            <p>
              Index advertised start {row.sourceIndexAdvertisedStart} (global
              index, not proven parcel lineage) · indexed through{" "}
              {row.sourceIndexedThrough} · verified through{" "}
              {row.sourceVerifiedThrough}
            </p>
            <p>
              All result pages observed; exact current PIN; other search filters
              empty. Prior parcel lineage and legal ownership continuity: not
              established.
            </p>
            <p>
              Witness {row.witnessTiming.replaceAll("_", " ")} · observed{" "}
              {row.reference.observedAt} · official-host receipt{" "}
              <a
                href={row.reference.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                {row.reference.sourceId}
              </a>
            </p>
            <code>{row.reference.recordSha256}</code>
            {row.limitations.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </section>
        ),
      )}
    </>
  );
}
