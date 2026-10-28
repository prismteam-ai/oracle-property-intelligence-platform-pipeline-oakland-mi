import type {
  Permit,
  Property,
} from "../../../packages/contracts/src/index.ts";
export function PermitSourceDetails({ permit }: { permit: Permit }) {
  return (
    <>
      {(permit.sourceObservations ?? []).map((row) => (
        <section
          className="notice compact private-protected-evidence"
          data-private-evidence
          key={row.providerRecordId}
        >
          <h4>Protected provider source observation</h4>
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
            Source {row.provenance.sourceId} · protected display only · no
            public redistribution
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
            className="notice compact private-protected-evidence"
            data-private-evidence
            key={row.reference.recordSha256}
          >
            <h3>Protected official recorded-deed index observation</h3>
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
              {row.reference.observedAt} · protected official-host receipt{" "}
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
