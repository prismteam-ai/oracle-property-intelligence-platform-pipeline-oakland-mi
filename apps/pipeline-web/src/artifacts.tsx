import publicationEvidence from "../../../packages/hosted-runtime/src/public-run-evidence.json";
import type { Manifest } from "./model.ts";
export function ArtifactsPanel({ manifest }: { manifest: Manifest | null }) {
  return (
    <section className="panel artifact-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">ARTIFACT IDENTITY</span>
          <h2>Snapshot integrity and publication evidence</h2>
          <p>
            Runtime file hashes are verified. The historical public base has a
            separate publication receipt. The current working view is verified
            independently; protected staging includes private enrichment.
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
          <h3>Two immutable public snapshots</h3>
          <p>
            Filebase and Pinata retain both roots on Free plans. Every file in
            both snapshots matched its size and SHA-256 through each operator's
            public gateway. This is recorded verification, not an availability
            monitor.
          </p>
          <p>
            <strong>Previous root · runs 1 and 2</strong>
          </p>
          <code>{publicationEvidence.priorRootCid}</code>
          <p>
            <strong>Latest published public root · run 3</strong>
          </p>
          <code>{publicationEvidence.rootCid}</code>
          <p>
            Run 3 freshly reconciled 1,050,476 source records: zero added,
            changed or deleted facts. The new root records observation
            provenance, contract 0.3.0 and immutable run history. A new CID
            alone does not establish changed county facts.
          </p>
          <p>
            The protected working view includes separate permit and enrichment
            observations. These are outside both public roots.
          </p>
          <p>
            The current working view uses run 4, which refreshed the selected
            public fields with no changed source facts. Its prepared IPFS root
            remains unpublished. Protected county attributes retain their own
            earlier observation times.
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
            renewal is not configured. The two immutable published CIDs identify
            the public snapshots.
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
  );
}
