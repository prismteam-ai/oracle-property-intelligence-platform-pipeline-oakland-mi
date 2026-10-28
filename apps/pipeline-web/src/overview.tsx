import type { Run, Coverage, Health } from "./model.ts";
export function OverviewPanel({
  health,
  runs,
  coverage,
  snapshot,
  loading,
  onExplore,
}: {
  health: Health | null;
  runs: Run[];
  coverage: Coverage[];
  snapshot: string;
  loading: boolean;
  onExplore: () => void;
}) {
  const latest = runs.at(-1);
  return (
    <>
      <section className="metrics" aria-label="Run metrics">
        <div>
          <span>CANONICAL PROPERTIES</span>
          <strong>{health?.count.toLocaleString() ?? "—"}</strong>
          <small>
            {health?.addressCount?.toLocaleString() ?? "—"} official site
            addresses
          </small>
        </div>
        <div>
          <span>RECORDED RUNS</span>
          <strong>{runs.length.toString().padStart(2, "0")}</strong>
          <small>Incremental state preserved</small>
        </div>
        <div>
          <span>LATEST RUN DELTA</span>
          <strong>
            {latest?.added === null ? "Unknown" : `+${latest?.added ?? 0}`}
            <i> / {latest?.changed ?? "Unknown"} changed</i>
          </strong>
          <small>{latest?.deleted ?? "Unknown"} tombstones recorded</small>
        </div>
        <div>
          <span>PUBLIC REPLICAS</span>
          <strong>2</strong>
          <small>Historical public base · verified October 27</small>
        </div>
      </section>
      <section className="two-columns">
        <div className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">INGESTION JOURNAL</span>
              <h2>Runs that tell the whole story</h2>
            </div>
            <span className="subtle-tag">{runs.length} runs</span>
          </div>
          <div className="timeline">
            {runs.map((run, index) => (
              <article key={run.id} className="run">
                <div className="timeline-dot" />
                <div className="run-content">
                  <div className="run-title">
                    <h3>{run.id}</h3>
                    <span className="state">{run.state}</span>
                  </div>
                  <time>
                    {new Date(run.at).toLocaleString("en-US", {
                      timeZone: "UTC",
                    })}{" "}
                    UTC
                  </time>
                  <p>
                    {run.sourceCount ?? "Unknown"} source records ·{" "}
                    {run.processed ?? "Unknown"} processed
                  </p>
                  <div className="delta">
                    <span>
                      {run.added === null
                        ? "Added: unknown"
                        : `+${run.added} added`}
                    </span>
                    <span>{run.changed ?? "Unknown"} changed</span>
                    <span>{run.deleted ?? "Unknown"} removed</span>
                    <span>{run.unchanged ?? "Unknown"} unchanged</span>
                  </div>
                  {run.raw !== undefined && (
                    <details>
                      <summary>Exact source run receipt</summary>
                      <pre>{JSON.stringify(run.raw, null, 2)}</pre>
                    </details>
                  )}
                  {health?.mode === "synthetic" &&
                    index === runs.length - 1 && (
                      <p className="muted">
                        Idempotent replay returns this same completed receipt.
                        Corrected content and tombstones advance the working
                        state.
                      </p>
                    )}
                </div>
              </article>
            ))}
          </div>
          {!runs.length && (
            <p className="muted">
              {loading
                ? "Loading the local run journal…"
                : "The local service has not returned a run."}
            </p>
          )}
        </div>
        <div className="panel coverage">
          <div className="section-heading">
            <div>
              <span className="eyebrow">SOURCE BOUNDARIES</span>
              <h2>Coverage, with caveats</h2>
            </div>
          </div>
          {coverage.map((c) => (
            <article key={c.source}>
              <div className="coverage-title">
                <h3>{c.source}</h3>
                <span
                  className={
                    c.state === "fixture_only" ? "badge teal" : "badge"
                  }
                >
                  {c.state === "fixture_only"
                    ? "Fixture"
                    : c.count === null
                      ? "Not measured"
                      : c.state === "complete_selected_layers"
                        ? "Complete selected layers"
                        : "Partial"}
                </span>
              </div>
              <p>{c.scope}</p>
              <ul>
                {c.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
      <section className="snapshot-strip">
        <div>
          <span className="eyebrow">SERVED SNAPSHOT</span>
          <code>{snapshot}</code>
        </div>
        <p>
          Every query and detail view uses this immutable snapshot identity.
        </p>
        <button className="text-button" onClick={onExplore}>
          Explore the snapshot →
        </button>
      </section>
    </>
  );
}
