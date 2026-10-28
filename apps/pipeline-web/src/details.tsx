import type {
  Property,
  SearchResponse,
} from "../../../packages/contracts/src/index.ts";
import type { Health } from "./model.ts";
import { roofBasis } from "./model.ts";
import { PermitSourceDetails, DeedSourceDetails } from "./source-details.tsx";
import { MunicipalSource } from "./municipal-source.tsx";
export function EvidenceDetails({
  selected,
  health,
  result,
  binding,
  closeEvidence,
}: {
  selected: Property;
  health: Health | null;
  result: SearchResponse | null;
  binding: { generation: number } | null;
  closeEvidence: () => void;
}) {
  return (
    <div className="drawer-backdrop" onClick={closeEvidence}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
        className="drawer"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="close"
          aria-label="Close evidence"
          onClick={closeEvidence}
        >
          ×
        </button>
        <span className="eyebrow">RECORD EVIDENCE</span>
        <h2 id="evidence-title">{selected.address}</h2>
        <span className="badge teal">
          {health?.mode === "real"
            ? "Real source evidence"
            : "Synthetic fixture"}
        </span>
        <p className="muted">
          Snapshot {result?.snapshotId} · query {result?.queryHash.slice(0, 16)}{" "}
          · generation {binding?.generation}
        </p>
        <dl>
          <dt>Canonical ID</dt>
          <dd>{selected.id}</dd>
          <dt>Jurisdiction</dt>
          <dd>{selected.jurisdiction?.name ?? "Unknown"}</dd>
          <dt>Parcel PIN / KEYPIN</dt>
          <dd>
            {selected.parcelIdentifiers?.pin ?? "Unknown"} /{" "}
            {selected.parcelIdentifiers?.keypin ?? "Unknown"}
          </dd>
          <dt>Official site addresses</dt>
          <dd>
            {selected.siteAddressCount ?? "Unknown"} · coordinate basis:{" "}
            {selected.coordinateBasis ?? "unknown"}
          </dd>
          <dt>Source-native ID</dt>
          <dd>{selected.nativeId}</dd>
          <dt>Roof evidence</dt>
          <dd>
            {selected.roof.ageYears ?? "Unknown"} years ·{" "}
            {roofBasis(selected.roof.basis)} · {selected.roof.confidence}{" "}
            confidence
          </dd>
          <dt>As of</dt>
          <dd>{selected.roof.asOf}</dd>
          <dt>Ownership</dt>
          <dd>
            {selected.ownership.lastTransferDate ??
              "Transfer history unavailable"}{" "}
            · {selected.ownership.historyCoverage} coverage
          </dd>
        </dl>
        {selected.roof.caveats.map((c) => (
          <p className="notice compact" key={c}>
            {c}
          </p>
        ))}
        {!!selected.roof.provenance?.length && (
          <>
            <h3>Roof proxy source evidence</h3>
            {selected.roof.provenance.map((p) => (
              <article className="lineage" key={p.recordId}>
                <strong>{p.sourceId}</strong>
                <p>
                  {p.recordId} · {p.observedAt}
                </p>
                <code>{p.digest}</code>
                {health?.dataMode === "protected-real" && (
                  <MunicipalSource
                    sourceId={p.sourceId}
                    recordId={p.recordId}
                  />
                )}
              </article>
            ))}
          </>
        )}
        {!!selected.ownership.events?.length && (
          <>
            <h3>Reported ownership events</h3>
            <p className="muted">
              A reported sale date is not a verified transfer event or proof of
              continuous ownership.
            </p>
            {selected.ownership.events.map((event) => (
              <article className="detail-permit" key={event.id}>
                <strong>
                  {event.kind === "reported_sale"
                    ? "Reported sale"
                    : "Recorded transfer"}{" "}
                  · {event.date}
                </strong>
                {event.provenance.map((p) => (
                  <p key={p.recordId}>
                    {p.sourceId} · {p.recordId} · observed {p.observedAt}
                  </p>
                ))}
              </article>
            ))}
          </>
        )}
        <DeedSourceDetails property={selected} />
        <h3>Permits and contractor evidence</h3>
        {selected.permits.map((p) => (
          <article
            className={
              "detail-permit" +
              (health?.dataMode === "protected-real"
                ? " private-protected-evidence"
                : "")
            }
            data-private-evidence={
              health?.dataMode === "protected-real" ? "true" : undefined
            }
            key={p.id}
          >
            <strong>{p.permitNumber ?? p.id}</strong>
            <PermitSourceDetails permit={p} />
            <p>
              {p.jurisdiction ?? "Jurisdiction unavailable"} ·{" "}
              {p.reportedPermitType?.trim() || "Permit type unavailable"}
            </p>
            <p>
              Issued {p.issuedAt ?? "date unavailable"} · Status {p.status}
              {p.statusBasis ? ` (${p.statusBasis.replaceAll("_", " ")})` : ""}
            </p>
            {p.statusBasis === "issued_only" && (
              <p className="notice compact">
                Issuance does not establish that this permit remains open or
                that work was completed.
              </p>
            )}
            {p.proposedWorkScope && <p>{p.proposedWorkScope}</p>}
            <p>
              Opened {p.openedAt ?? "unknown"} · Closed{" "}
              {p.closedAt ?? "unknown"}
              {p.statusObservedAt
                ? ` · status observed ${p.statusObservedAt}`
                : ""}
            </p>
            <p>
              {(p.sourceObservations?.length ?? 0) > 0 &&
              !p.contractor.verifiedCompanyId
                ? "Provider-listed party (contractor role unverified): "
                : p.provenance.some(
                      (source) =>
                        source.sourceId === "official-troy-issued-permits",
                    )
                  ? "Business applicant (contractor role unverified): "
                  : "Reported contractor: "}
              {p.contractor.reportedName ?? "Unavailable"}
            </p>
            <p>
              Verified company: {p.contractor.verifiedCompanyId ?? "Unresolved"}
            </p>
            <p>
              License: {p.contractor.license ?? "Unavailable"} · Rating:{" "}
              {p.contractor.ratingEvidence
                ? `${p.contractor.ratingEvidence.value} on the BBB letter-grade scale`
                : (p.contractor.rating ?? "Unavailable")}
            </p>
            {p.contractor.licenseEvidence && (
              <p>
                {p.contractor.licenseEvidence.type} ·{" "}
                {p.contractor.licenseEvidence.status} ·{" "}
                {p.contractor.licenseEvidence.confidence} match confidence ·{" "}
                <a
                  href={p.contractor.licenseEvidence.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Official license source
                </a>{" "}
                · observed {p.contractor.licenseEvidence.observedAt}.{" "}
                {p.contractor.licenseEvidence.matchBasis}
              </p>
            )}
            {p.contractor.ratingEvidence && (
              <p>
                <a
                  href={p.contractor.ratingEvidence.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  BBB profile
                </a>{" "}
                · {p.contractor.ratingEvidence.matchConfidence} match confidence
                · observed {p.contractor.ratingEvidence.observedAt}. A BBB grade
                is not a numeric score or a license.
              </p>
            )}
            {p.matchEvidence && (
              <p>
                Property match: {p.matchEvidence.basis.replaceAll("_", " ")} ·{" "}
                {p.matchEvidence.confidence} confidence.{" "}
                {p.matchEvidence.caveats.join(" ")}
              </p>
            )}
            {p.provenance.map((source) => (
              <p key={`${source.sourceId}:${source.recordId}`}>
                {source.sourceId} · {source.recordId} · observed{" "}
                {source.observedAt}
                <br />
                <code>{source.digest}</code>
              </p>
            ))}
          </article>
        ))}
        {!selected.permits.length && (
          <p>
            Permit evidence is unavailable for this record. This is not proof of
            permit absence.
          </p>
        )}
        <h3>Source lineage</h3>
        {selected.provenance.map((p) => (
          <article key={p.recordId} className="lineage">
            <strong>{p.sourceId}</strong>
            <p>
              {p.recordId} · {p.observedAt}
            </p>
            <code>{p.digest}</code>
          </article>
        ))}
      </section>
    </div>
  );
}
