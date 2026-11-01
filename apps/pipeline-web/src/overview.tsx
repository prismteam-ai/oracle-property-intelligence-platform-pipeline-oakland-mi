import type { Run, Coverage, Health } from "./model.ts";
import type { CurrentPublicationEvidence } from "./current-artifacts.tsx";
export function OverviewPanel({
  health,
  runs,
  coverage,
  snapshot,
  loading,
  onExplore,
  currentPublication,
}: {
  health: Health | null;
  runs: Run[];
  coverage: Coverage[];
  snapshot: string;
  loading: boolean;
  onExplore: () => void;
  currentPublication?: CurrentPublicationEvidence;
}) {
  const latest = runs.at(-1);
  const coverageNotes = coverage.map((c) => (
    <article key={c.source}>
      <div className="coverage-title">
        <h3>{c.source}</h3>
        <span className={c.state === "fixture_only" ? "badge teal" : "badge"}>
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
        {c.limitations.map((limitation) => (
          <li key={limitation}>{limitation}</li>
        ))}
      </ul>
    </article>
  ));
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
          <span>WORKING DATA RUNS</span>
          <strong>{runs.length.toString().padStart(2, "0")}</strong>
          <small>Incremental state preserved</small>
        </div>
        <div>
          <span>LATEST RUN DELTA</span>
          <strong>
            {latest?.added === null ? "Unknown" : `+${latest?.added ?? 0}`}
            <i> / {latest?.changed ?? "Unknown"} changed</i>
          </strong>
          <small>
            {latest?.kind === "protected-source-refresh"
              ? "Source observations; property count unchanged"
              : `${latest?.deleted ?? "Unknown"} tombstones recorded`}
          </small>
        </div>
        <div>
          <span>PUBLIC REPLICAS</span>
          <strong>2</strong>
          <small>
            {currentPublication
              ? "Current public projection · exact file readbacks"
              : "Historical public base · verified October 27"}
          </small>
        </div>
      </section>
      {currentPublication && (
        <section
          className="panel source-category-summary"
          aria-label="Uploaded source categories"
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">CURRENT PUBLIC RUN</span>
              <h2>{currentPublication.runId}</h2>
              <time dateTime={currentPublication.publishedAt}>
                Published{" "}
                {new Date(currentPublication.publishedAt).toLocaleString(
                  "en-US",
                  { timeZone: "UTC" },
                )}{" "}
                UTC
              </time>
              <p>
                A later immutable publication of the admitted official sources.
                Collection dates, held rows and source limitations remain
                explicit.
              </p>
            </div>
            <a
              href="/assessment-reconciliation-report.json"
              target="_blank"
              rel="noopener noreferrer"
            >
              Download reconciliation report ↗
            </a>
          </div>
          <div className="artifact-grid">
            {currentPublication.sourceCategories.map((category) => (
              <article key={category.name}>
                <span className="eyebrow">{category.name}</span>
                <h3>{category.observed}</h3>
              </article>
            ))}
          </div>
          <details>
            <summary>Source basis and availability</summary>
            <ul>
              {currentPublication.sourceCategories.map((category) => (
                <li key={category.name}>
                  <strong>{category.name}.</strong> {category.basis}
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
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
                  {run.limitations?.map((text) => (
                    <p className="muted" key={text}>
                      {text}
                    </p>
                  ))}
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
              <span className="eyebrow">SOURCE COVERAGE</span>
              <h2>
                {currentPublication
                  ? "Current eligible public projection"
                  : "Coverage, with caveats"}
              </h2>
            </div>
          </div>
          {currentPublication ? (
            <>
              <p>
                The current public snapshot includes admitted official raw
                fields, reported owner and postal observations, original Troy
                Applicant/source fields, and reviewed derivatives. The 131
                separately licensed provider observations remain in the working
                dataset and are excluded from this public projection.
              </p>
              <ul>
                <li>
                  Building year is a roof-age proxy, not a roof installation
                  date.
                </li>
                <li>
                  No qualified source-confirmed open or continuously long-open
                  permit cohort was found.
                </li>
                <li>
                  Listed parties and license associations do not establish a
                  verified job contractor. BBB ratings remain unavailable.
                </li>
                <li>
                  Source points are not roof surveys. Missing coordinates and
                  conflicting joins remain in the reconciliation report.
                </li>
                <li>
                  Qualified current-PIN deed-index gaps do not establish
                  continuous legal ownership.
                </li>
              </ul>
              <p className="muted">
                The notes below describe earlier V9 working intake and the
                pre-P13 publication boundary. Their exclusions for official
                owner, postal, Applicant and raw source fields are superseded
                for the current public projection. They remain unchanged for
                historical audit.
              </p>
              <details className="historical-coverage">
                <summary>
                  Historical working-intake notes — retained for audit
                </summary>
                {coverageNotes}
              </details>
            </>
          ) : (
            coverageNotes
          )}
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
