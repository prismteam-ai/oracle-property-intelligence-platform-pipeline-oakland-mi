import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  Property,
  QueryInput,
  SearchResponse,
} from "../../../packages/contracts/src/index.ts";
import "./style.css";
interface Run {
  id: string;
  at: string;
  source: string;
  sourceCount: number;
  processed: number;
  added: number;
  changed: number;
  deleted: number;
  unchanged: number;
  state: string;
  limitations: string[];
}
interface Coverage {
  source: string;
  scope: string;
  state: string;
  count: number | null;
  limitations: string[];
}
interface Manifest {
  snapshotId: string;
  mode: string;
  items: { name: string; size: number; digest: string; cid: null }[];
  car: { state: string; reason: string };
  ipfs: { state: string; replicas: number };
  limitations: string[];
}
const snapshot = "demo-oakland-v1";
async function get<T>(path: string): Promise<T> {
  const r = await fetch(`/api/${path}`);
  if (!r.ok)
    throw new Error(
      "The local data service is unavailable. Start the Oracle API and retry.",
    );
  return r.json() as Promise<T>;
}
function App() {
  const [tab, setTab] = useState("overview"),
    [runs, setRuns] = useState<Run[]>([]),
    [coverage, setCoverage] = useState<Coverage[]>([]),
    [manifest, setManifest] = useState<Manifest | null>(null),
    [result, setResult] = useState<SearchResponse | null>(null),
    [selected, setSelected] = useState<Property | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [radius, setRadius] = useState(5),
    [age, setAge] = useState(15),
    [permits, setPermits] = useState<"any" | "open" | "closed">("any"),
    [minDays, setMinDays] = useState(0);
  const latest = runs.at(-1);
  async function search() {
    setLoading(true);
    setError("");
    try {
      const q: QueryInput = {
        snapshotId: snapshot,
        lat: 42.66,
        lng: -83.29,
        radiusMeters: radius * 1609.344,
        roofMinAgeYears: age,
        permitStatus: permits,
        minOpenDays: minDays,
        limit: 50,
      };
      const r = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(q),
      });
      if (!r.ok)
        throw new Error(
          "The query could not be completed. Check the filters and retry.",
        );
      const data = (await r.json()) as SearchResponse;
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Query unavailable");
    } finally {
      setLoading(false);
    }
  }
  async function load() {
    setLoading(true);
    setError("");
    try {
      const [r, c, m] = await Promise.all([
        get<Run[]>("runs"),
        get<Coverage[]>("coverage"),
        get<Manifest>("manifest"),
      ]);
      setRuns(r);
      setCoverage(c);
      setManifest(m);
      await search();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Service unavailable");
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement as HTMLElement | null;
    const timer = setTimeout(
      () =>
        document.querySelector<HTMLButtonElement>(".drawer .close")?.focus(),
      0,
    );
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      if (event.key === "Tab") {
        const elements = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".drawer button,.drawer a,.drawer input,.drawer select,[role=dialog] summary",
          ),
        );
        const first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, [selected]);
  return (
    <div className="studio">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Oracle Studio home">
          <span className="brand-symbol">P</span>
          <div>
            prism<span>ORACLE STUDIO</span>
          </div>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace">
          <span className="status-dot" />
          Oakland County <small>MI</small>
        </div>
        <nav aria-label="Studio sections">
          {[
            ["overview", "Run overview", "01"],
            ["query", "Query lab", "02"],
            ["artifacts", "Artifacts & lineage", "03"],
          ].map(([key, label, num]) => (
            <button
              className={tab === key ? "nav-item active" : "nav-item"}
              key={key}
              onClick={() => setTab(key!)}
              aria-current={tab === key ? "page" : undefined}
            >
              <span>{num}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="tiny-label">EXECUTION MODE</div>
          <strong>Local foundations</strong>
          <p>
            Deterministic fixtures.
            <br />
            No public publication.
          </p>
          <a href="http://127.0.0.1:4174">Open Roofing CRM ↗</a>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <span className="breadcrumb">DATA OPERATIONS / OAKLAND COUNTY</span>
            <h1>
              {tab === "overview"
                ? "A clear view of every run."
                : tab === "query"
                  ? "Ask the data, inspect the evidence."
                  : "Content identity starts here."}
            </h1>
            <p className="subtitle">
              Property intelligence with a visible chain of evidence.
            </p>
          </div>
          <span className="mode-pill">
            <span />
            SYNTHETIC · P1 LOCAL
          </span>
        </header>
        <div className="notice" role="note">
          <strong>Demonstration dataset</strong>
          <span>
            48 synthetic properties prove the workflow. Official minimized
            parcel evidence is kept separately; this is not county coverage.
          </span>
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => void load()}>Retry connection</button>
          </div>
        )}
        {tab === "overview" && (
          <>
            <section className="metrics" aria-label="Run metrics">
              <div>
                <span>FIXTURE PROPERTIES</span>
                <strong>48</strong>
                <small>47 with spatial evidence</small>
              </div>
              <div>
                <span>COMPLETED LOCAL RUNS</span>
                <strong>{runs.length.toString().padStart(2, "0")}</strong>
                <small>Incremental state preserved</small>
              </div>
              <div>
                <span>LATEST RUN DELTA</span>
                <strong>
                  +{latest?.added ?? 0}
                  <i> / {latest?.changed ?? 0} changed</i>
                </strong>
                <small>{latest?.deleted ?? 0} tombstone applied</small>
              </div>
              <div>
                <span>PUBLIC REPLICAS</span>
                <strong>—</strong>
                <small>Not published · approval required</small>
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
                          {run.sourceCount} source records · {run.processed}{" "}
                          processed
                        </p>
                        <div className="delta">
                          <span>+{run.added} added</span>
                          <span>{run.changed} changed</span>
                          <span>{run.deleted} removed</span>
                          <span>{run.unchanged} unchanged</span>
                        </div>
                        {index === runs.length - 1 && (
                          <p className="muted">
                            Idempotent replay returns this same completed
                            receipt. Corrected content and tombstones advance
                            the working state.
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
                Every query and detail view uses this immutable fixture
                contract.
              </p>
              <button className="text-button" onClick={() => setTab("query")}>
                Explore the snapshot →
              </button>
            </section>
          </>
        )}
        {tab === "query" && (
          <section className="panel query-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">PORTABLE ANALYTICS</span>
                <h2>Find opportunities by evidence</h2>
                <p>Local DuckDB query · Oakland-centered fixture cohort</p>
              </div>
              <span className="subtle-tag">{snapshot}</span>
            </div>
            <form
              className="filters"
              onSubmit={(e) => {
                e.preventDefault();
                void search();
              }}
            >
              <label>
                Radius (miles)
                <input
                  type="number"
                  value={radius}
                  min="0.1"
                  max="20"
                  step="0.5"
                  onChange={(e) => setRadius(Number(e.target.value))}
                />
              </label>
              <label>
                Roof older than (years)
                <input
                  type="number"
                  value={age}
                  min="0"
                  max="150"
                  onChange={(e) => setAge(Number(e.target.value))}
                />
              </label>
              <label>
                Permit status
                <select
                  value={permits}
                  onChange={(e) => setPermits(e.target.value as typeof permits)}
                >
                  <option value="any">All permits</option>
                  <option value="open">Open permits</option>
                  <option value="closed">Closed permits</option>
                </select>
              </label>
              <label>
                Minimum open days
                <input
                  type="number"
                  value={minDays}
                  min="0"
                  max="50000"
                  onChange={(e) => setMinDays(Number(e.target.value))}
                />
              </label>
              <button className="primary" disabled={loading}>
                {loading ? "Searching…" : "Run query"}
              </button>
            </form>
            <div className="query-results-heading">
              <strong>{result?.total ?? 0} matching properties</strong>
              <span>Exact radius · source-backed fixture evidence</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Property</th>
                    <th>Roof evidence</th>
                    <th>Permits</th>
                    <th>Distance</th>
                    <th>
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result?.rows.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.address}</strong>
                        <small>
                          {p.nativeId} · {p.usage}
                        </small>
                      </td>
                      <td>
                        <strong>
                          {p.roof.ageYears ?? "Unknown"}
                          {p.roof.ageYears !== null ? " years" : ""}
                        </strong>
                        <small>
                          {p.roof.basis.replaceAll("_", " ")} ·{" "}
                          {p.roof.confidence}
                        </small>
                      </td>
                      <td>
                        {p.permits.filter((x) => x.status === "open").length}{" "}
                        open<small>{p.permits.length} total</small>
                      </td>
                      <td>{(p.distanceMeters / 1609.344).toFixed(1)} mi</td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setSelected(p)}
                          aria-label={`Inspect evidence for ${p.id}`}
                        >
                          Inspect ↗
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result?.rows.length === 0 && (
              <div className="empty">
                <h3>No evidence matches these filters.</h3>
                <p>
                  Try a wider radius or lower age threshold. Missing age
                  evidence is not treated as zero.
                </p>
              </div>
            )}
            <div className="query-foot">
              <code>query {result?.queryHash.slice(0, 16) ?? "pending"}</code>
              <span>
                {result?.truncated
                  ? "Results are paginated; additional matches exist."
                  : "All matches shown for this fixture query."}
              </span>
            </div>
          </section>
        )}
        {tab === "artifacts" && (
          <section className="panel artifact-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">PUBLICATION REHEARSAL</span>
                <h2>A manifest, not a publication claim</h2>
                <p>
                  Local digests are measured. Public CIDs and durability are not
                  yet established.
                </p>
              </div>
              <span className="badge">Dry run only</span>
            </div>
            <div className="artifact-grid">
              <article>
                <span className="eyebrow">SNAPSHOT IDENTITY</span>
                <h3>{manifest?.snapshotId}</h3>
                {manifest?.items.map((item) => (
                  <div key={item.name} className="artifact">
                    <strong>{item.name}</strong>
                    <p>{item.size.toLocaleString()} bytes · SHA-256</p>
                    <code>{item.digest}</code>
                    <p className="muted">
                      CID: not produced · eligibility: pending
                    </p>
                  </div>
                ))}
              </article>
              <article className="publication-gate">
                <h3>The publication gate stays closed</h3>
                <p>{manifest?.car.reason}</p>
                <ol>
                  <li>Validate eligible Lexicon groups.</li>
                  <li>Pack and validate deterministic CARs.</li>
                  <li>Approve exact bytes, fields and retention.</li>
                  <li>
                    Verify independent stored replicas and public retrieval.
                  </li>
                </ol>
                <p className="muted">
                  No network upload, IPNS update or Atlas contribution runs in
                  this product.
                </p>
              </article>
            </div>
            <details>
              <summary>View machine-readable dry manifest</summary>
              <pre>{JSON.stringify(manifest, null, 2)}</pre>
            </details>
          </section>
        )}
        <footer>
          <span>PRISM / PROPERTY INTELLIGENCE</span>
          <span>Local P1 · No accounts, cloud or public writes</span>
        </footer>
      </main>
      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
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
              onClick={() => setSelected(null)}
            >
              ×
            </button>
            <span className="eyebrow">RECORD EVIDENCE</span>
            <h2 id="evidence-title">{selected.address}</h2>
            <span className="badge teal">Synthetic fixture</span>
            <dl>
              <dt>Canonical ID</dt>
              <dd>{selected.id}</dd>
              <dt>Source-native ID</dt>
              <dd>{selected.nativeId}</dd>
              <dt>Roof evidence</dt>
              <dd>
                {selected.roof.ageYears ?? "Unknown"} years ·{" "}
                {selected.roof.basis.replaceAll("_", " ")} ·{" "}
                {selected.roof.confidence} confidence
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
            <h3>Permits and contractor evidence</h3>
            {selected.permits.map((p) => (
              <article className="detail-permit" key={p.id}>
                <strong>{p.id}</strong>
                <p>
                  {p.status} · opened {p.openedAt ?? "date unavailable"}
                </p>
                <p>
                  Reported contractor:{" "}
                  {p.contractor.reportedName ?? "Unavailable"}
                </p>
                <p>
                  Verified company:{" "}
                  {p.contractor.verifiedCompanyId ?? "Unresolved"}
                </p>
                <p>
                  License: {p.contractor.license ?? "Unavailable"} · Rating:{" "}
                  {p.contractor.rating ?? "Unavailable"}
                </p>
              </article>
            ))}
            {!selected.permits.length && (
              <p>
                No permits in this synthetic record; this is not evidence of
                county permit absence.
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
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
