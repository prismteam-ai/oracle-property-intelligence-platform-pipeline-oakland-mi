import publicationEvidence from "../../../packages/hosted-runtime/src/public-run-evidence.json";
import type { Manifest } from "./model.ts";
import {
  CurrentPublicationPanel,
  type CurrentPublicationEvidence,
} from "./current-artifacts.tsx";
export function ArtifactsPanel({
  manifest,
  currentPublication,
}: {
  manifest: Manifest | null;
  currentPublication?: CurrentPublicationEvidence;
}) {
  return (
    <>
      {currentPublication && (
        <CurrentPublicationPanel evidence={currentPublication} />
      )}
      <section className="panel artifact-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">ARTIFACT IDENTITY</span>
            <h2>Snapshot integrity and publication evidence</h2>
            <p>
              The working API view and public downloads have separate snapshot
              identities. Runtime file hashes and the historical public base
              each have their own verification receipts.
            </p>
          </div>
          <span className="badge">Runtime + recorded public proof</span>
        </div>
        <div className="artifact-grid">
          <article>
            <span className="eyebrow">SNAPSHOT IDENTITY</span>
            <h3>{manifest?.snapshotId}</h3>
            {(
              manifest?.items ??
              manifest?.files?.map((f) => ({
                name: f.name,
                size: f.bytes,
                digest: f.sha256,
                cid: null,
              }))
            )?.map((item) => (
              <div key={item.name} className="artifact">
                <strong>{item.name}</strong>
                <p>{item.size.toLocaleString()} bytes · SHA-256</p>
                <code>{item.digest}</code>
                <p className="muted">
                  CID: {item.cid ?? "Not included in this runtime manifest"}
                </p>
              </div>
            ))}
          </article>
          <article className="publication-gate">
            <h3>Earlier immutable public snapshots</h3>
            <p>
              The October 27 receipt records every file in both earlier
              snapshots matching its size and SHA-256 through Filebase and
              Pinata. These roots remain separate from the current public
              projection above.
            </p>
            <p>
              <strong>Previous root · runs 1 and 2</strong>
            </p>
            <code>{publicationEvidence.priorRootCid}</code>
            <p>
              <strong>Earlier public root · run 3</strong>
            </p>
            <code>{publicationEvidence.rootCid}</code>
            <p>
              Run 3 freshly reconciled 1,050,476 source records: zero added,
              changed or deleted facts. The new root records observation
              provenance, contract 0.3.0 and immutable run history. A new CID
              alone does not establish changed county facts.
            </p>
            <p>
              Those two historical roots do not contain the later permit and
              enrichment observations.
            </p>
            <p>
              The working view uses the run 4 base and separately dated later
              source observations. The historical run 4 base-only root was not
              published; the current eligible projection has its own new run and
              CID.
            </p>
            <p>
              <a
                href="/assessment-publication-manifest.json"
                target="_blank"
                rel="noopener noreferrer"
              >
                Public file manifest and CAR identity ↗
              </a>
            </p>
            <p>
              <a
                href="/assessment-gateway-proof.json"
                target="_blank"
                rel="noopener noreferrer"
              >
                Independent public gateway verification ↗
              </a>
            </p>
            <p className="muted">
              The historical IPNS pointer is retired from the current delivery
              path. Its expiry was not independently verified and automatic
              renewal is not configured. The two immutable published CIDs
              identify the public snapshots.
            </p>
            <p className="muted">
              This interface performs no uploads, renewal, or provider changes.
            </p>
          </article>
        </div>
        <details>
          <summary>View machine-readable runtime manifest</summary>
          <pre>{JSON.stringify(manifest, null, 2)}</pre>
        </details>
      </section>
    </>
  );
}
