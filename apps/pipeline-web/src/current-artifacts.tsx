export interface CurrentPublicationEvidence {
  state: "CURRENT_ROOT_PUBLISHED_TWO_OPERATOR_READBACK_PASS";
  runId: string;
  publishedAt: string;
  rootCid: string;
  snapshotId: string;
  files: { name: string; bytes: number; sha256: string; cid: string }[];
  payloadBytes: number;
  priorRoots: string[];
  car: { url: string; bytes: number; sha256: string };
  readback: { operators: string[]; verifiedAt: string };
  sourceCategories: { name: string; observed: string; basis: string }[];
  permitReconciliation: {
    sourceViewRows: number;
    uniqueMunicipalRecords: number;
    publishedPermitObservations: number;
    explanation: string;
  };
  consumer: {
    databaseSha256: string;
    databaseBytes: number;
    verifiedAt: string;
    queryResults: { name: string; count: number; basis: string }[];
  };
}

/** Recorded immutable publication evidence, separate from the working API view. */
export function CurrentPublicationPanel({
  evidence,
}: {
  evidence: CurrentPublicationEvidence;
}) {
  const database = evidence.files.find(
    (file) => file.name === "oakland-public.duckdb",
  );
  return (
    <section
      className="panel current-publication"
      aria-label="Current public snapshot"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">CURRENT PUBLIC SNAPSHOT</span>
          <h2>Download the data. Query it on your own machine.</h2>
          <p>
            {evidence.runId} · {evidence.files.length} immutable artifacts ·{" "}
            {(evidence.payloadBytes / 1_000_000).toFixed(1)} MB. The public
            projection contains official property, permit and source
            observations with their original dates and provenance.
          </p>
        </div>
        <span className="badge">Two independent public replicas</span>
      </div>
      <p>
        <strong>Current directory CID</strong>
      </p>
      <code>{evidence.rootCid}</code>
      <p>
        {evidence.readback.operators.join(" and ")} each served every listed
        artifact with its exact size and SHA-256. Verified{" "}
        {new Date(evidence.readback.verifiedAt).toLocaleString("en-US", {
          timeZone: "UTC",
        })}{" "}
        UTC. The receipt records the exact requests and results.
      </p>
      <p>
        <a
          href="/assessment-current-publication-manifest.json"
          target="_blank"
          rel="noopener noreferrer"
        >
          Artifact manifest ↗
        </a>{" "}
        ·{" "}
        <a
          href="/assessment-current-gateway-proof.json"
          target="_blank"
          rel="noopener noreferrer"
        >
          Both public readbacks ↗
        </a>{" "}
        ·{" "}
        <a href={evidence.car.url} target="_blank" rel="noopener noreferrer">
          Exact CAR for import ↗
        </a>
        {database && (
          <>
            {" "}
            ·{" "}
            <a
              href={"https://ipfs.filebase.io/ipfs/" + database.cid}
              target="_blank"
              rel="noopener noreferrer"
            >
              Portable DuckDB ({(database.bytes / 1_000_000).toFixed(1)} MB) ↗
            </a>
          </>
        )}
      </p>
      <div className="two-columns">
        <article>
          <h3>What was reconciled</h3>
          <p>
            {evidence.permitReconciliation.sourceViewRows.toLocaleString(
              "en-US",
            )}{" "}
            rows across three official views represent{" "}
            {evidence.permitReconciliation.uniqueMunicipalRecords.toLocaleString(
              "en-US",
            )}{" "}
            unique municipal source records. The complete public projection has{" "}
            {evidence.permitReconciliation.publishedPermitObservations.toLocaleString(
              "en-US",
            )}{" "}
            normalized permit observations.
          </p>
          <p>{evidence.permitReconciliation.explanation}</p>
          <a
            href="/assessment-reconciliation-report.json"
            target="_blank"
            rel="noopener noreferrer"
          >
            Download source, join, held-row and conflict report ↗
          </a>
        </article>
        <article>
          <h3>Verified without Oracle hosting</h3>
          <p>
            A clean consumer downloaded the published database, checked its
            exact digest and opened it read-only. These queries used that local
            file without Oracle AWS or API access.
          </p>
          <ul>
            {evidence.consumer.queryResults.map((query) => (
              <li key={query.name}>
                <strong>
                  {query.name}: {query.count.toLocaleString("en-US")}.
                </strong>{" "}
                {query.basis}
              </li>
            ))}
          </ul>
          <a
            href="/assessment-portable-consumer-proof.json"
            target="_blank"
            rel="noopener noreferrer"
          >
            Consumer commands, SQL and actual results ↗
          </a>
          <details>
            <summary>Exact binary and reproducibility scope</summary>
            <p>
              {evidence.consumer.databaseBytes.toLocaleString("en-US")} bytes
            </p>
            <code>{evidence.consumer.databaseSha256}</code>
            <p>
              This exact DuckDB binary is frozen. Independent builds verify the
              same schemas, rows and query behavior; an upstream DuckDB physical
              file issue prevents a claim of byte-identical database rebuilds.
              Two wraps of these same frozen artifacts produced the same CID and
              CAR.
            </p>
          </details>
        </article>
      </div>
      <details>
        <summary>Earlier immutable roots remain available</summary>
        {evidence.priorRoots.map((cid) => (
          <p key={cid}>
            <code>{cid}</code>
          </p>
        ))}
        <p>
          The working API view has its own snapshot identity and includes
          separate provider observations. This public release does not relabel
          those rows as official public-source data.
        </p>
      </details>
    </section>
  );
}
