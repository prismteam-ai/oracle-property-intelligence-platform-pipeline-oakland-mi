import { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import type {
  Property,
  QueryInput,
  SearchResponse,
} from "../../../packages/contracts/src/index.ts";
import type { RuntimeIdentity } from "../../../packages/hosted-runtime/src/release.ts";
import "./style.css";
declare const __PRISM_UI_IDENTITY__: RuntimeIdentity;
const uiIdentity = __PRISM_UI_IDENTITY__;
import {
  get,
  normalizeRun,
  normalizeCoverage,
  roofBasis,
  type Run,
  type Coverage,
  type Manifest,
  type Health,
} from "./model.ts";
import { SourceFilters, initialSourceFilters } from "./source-filters.tsx";
import { OverviewPanel } from "./overview.tsx";
import { ArtifactsPanel } from "./artifacts.tsx";
import type { CurrentPublicationEvidence } from "./current-artifacts.tsx";
import currentPublicationData from "../../../packages/hosted-runtime/src/current-public-evidence.json";
const currentPublication = currentPublicationData as CurrentPublicationEvidence;
import { EvidenceDetails } from "./details.tsx";
import { PermitOpportunityBadges } from "./permit-opportunities.tsx";
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
    [age, setAge] = useState(0),
    [permits, setPermits] = useState<"any" | "open" | "closed" | "unknown">(
      "any",
    ),
    [minDays, setMinDays] = useState(0);
  const [sourceFilters, setSourceFilters] = useState(initialSourceFilters);
  const [permitOpportunityMode, setPermitOpportunityMode] = useState<
    QueryInput["permitOpportunityMode"] | ""
  >("");
  const [minPermitObservationAgeYears, setMinPermitObservationAgeYears] =
    useState(5);
  const [health, setHealth] = useState<Health | null>(null),
    [accessRequired, setAccessRequired] = useState(false),
    [accessCode, setAccessCode] = useState(""),
    [dirty, setDirty] = useState(false),
    [ownerRegion, setOwnerRegion] = useState<
      "any" | "regional" | "out_of_area" | "unknown"
    >("any"),
    [ownershipYears, setOwnershipYears] = useState(0),
    [reportedSaleYears, setReportedSaleYears] = useState(0),
    [lat, setLat] = useState(42.66),
    [lng, setLng] = useState(-83.29),
    [binding, setBinding] = useState<{
      generation: number;
      query: QueryInput;
    } | null>(null);
  const loadSequence = useRef(0),
    loadController = useRef<AbortController | null>(null);
  const detailSequence = useRef(0),
    detailController = useRef<AbortController | null>(null);
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null),
    healthRef = useRef<Health | null>(null);
  const snapshot = health?.snapshotId ?? "Loading verified snapshot…";
  const crmUrl =
    import.meta.env.VITE_CRM_URL ??
    (["127.0.0.1", "localhost"].includes(window.location.hostname)
      ? "http://127.0.0.1:4174"
      : "");
  function closeEvidence() {
    detailSequence.current++;
    detailController.current?.abort();
    setSelected(null);
  }
  function invalidate() {
    generation.current++;
    controller.current?.abort();
    setResult(null);
    closeEvidence();
    setBinding(null);
    setDirty(true);
    setLoading(false);
  }
  async function search(active = healthRef.current, cursor?: string) {
    if (!active) return;
    const current = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setResult(null);
    closeEvidence();
    setBinding(null);
    setLoading(true);
    setDirty(false);
    setError("");
    const q: QueryInput = {
      snapshotId: active.snapshotId,
      lat,
      lng,
      radiusMeters: radius * 1609.344,
      roofMinAgeYears: age,
      permitStatus: permits,
      minOpenDays: minDays,
      ...(permitOpportunityMode
        ? {
            permitOpportunityMode,
            ...(permitOpportunityMode === "status_verification_needed"
              ? { minPermitObservationAgeYears }
              : {}),
          }
        : {}),
      ...(sourceFilters.providerStatus !== "any"
        ? { providerPermitStatus: sourceFilters.providerStatus }
        : {}),
      ...(sourceFilters.activity !== "any"
        ? { permitActivityClaim: sourceFilters.activity }
        : {}),
      ...(sourceFilters.issueAge > 0
        ? { minPermitAgeSinceIssueDays: sourceFilters.issueAge }
        : {}),
      ...(sourceFilters.deedGap > 0
        ? { minRecordedDeedGapYears: sourceFilters.deedGap }
        : {}),
      includeUnknown: age === 0,
      ownerRegion,
      ...(active.mode === "real"
        ? reportedSaleYears > 0
          ? { minReportedSaleAgeYears: reportedSaleYears }
          : {}
        : ownershipYears > 0
          ? { minOwnershipYears: ownershipYears }
          : {}),
      limit: 50,
      ...(cursor ? { cursor } : {}),
    };
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(q),
        signal: abort.signal,
      });
      if (response.status === 401) {
        setAccessRequired(true);
        return;
      }
      if (!response.ok)
        throw new Error(
          "The query could not be completed. Check the filters and retry.",
        );
      const data = (await response.json()) as SearchResponse;
      if (current !== generation.current) return;
      if (
        data.snapshotId !== active.snapshotId ||
        !/^[a-f0-9]{64}$/.test(data.queryHash)
      )
        throw new Error("The response identity does not match this snapshot.");
      setResult(data);
      setBinding({ generation: current, query: q });
    } catch (e) {
      if (
        current === generation.current &&
        !(e instanceof DOMException && e.name === "AbortError")
      )
        setError(e instanceof Error ? e.message : "Query unavailable");
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  async function inspect(id: string) {
    if (!result || !binding || dirty || loading) return;
    const current = binding.generation,
      detail = ++detailSequence.current;
    detailController.current?.abort();
    const abort = new AbortController();
    detailController.current = abort;
    setSelected(null);
    try {
      const p = await get<Property>(
        `properties/${encodeURIComponent(id)}?snapshotId=${encodeURIComponent(result.snapshotId)}`,
        abort.signal,
      );
      if (
        current === generation.current &&
        detail === detailSequence.current &&
        p.id === id &&
        result.rows.some((row) => row.id === p.id)
      )
        setSelected(p);
    } catch (e) {
      if (
        current === generation.current &&
        detail === detailSequence.current &&
        !(e instanceof DOMException && e.name === "AbortError")
      )
        setError(e instanceof Error ? e.message : "Detail unavailable");
    }
  }
  async function load() {
    const current = ++loadSequence.current;
    loadController.current?.abort();
    const abort = new AbortController();
    loadController.current = abort;
    invalidate();
    healthRef.current = null;
    setHealth(null);
    setRuns([]);
    setCoverage([]);
    setManifest(null);
    setLoading(true);
    setDirty(false);
    setError("");
    try {
      const h = await get<Health>("health", abort.signal);
      // Pace immutable bootstrap reads within the bounded review capacity.
      const r = await get<unknown[]>("runs", abort.signal);
      const c = await get<unknown[]>("coverage", abort.signal);
      const m = await get<Manifest>("manifest", abort.signal);
      if (current !== loadSequence.current) return;
      setHealth(h);
      healthRef.current = h;
      setRuns(r.map(normalizeRun));
      setCoverage(c.map(normalizeCoverage));
      setManifest(m);
      setAccessRequired(false);
      await search(h);
    } catch (e) {
      if (current !== loadSequence.current) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (e instanceof Error && e.message === "REVIEW_ACCESS_REQUIRED")
        setAccessRequired(true);
      else setError(e instanceof Error ? e.message : "Service unavailable");
      setLoading(false);
    }
  }
  async function signIn() {
    setError("");
    try {
      const r = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode }),
      });
      setAccessCode("");
      if (!r.ok)
        throw new Error(
          "The review code was not accepted. Please retry later.",
        );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Access unavailable");
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
      controller.current?.abort();
      detailSequence.current++;
      detailController.current?.abort();
      loadSequence.current++;
      loadController.current?.abort();
    };
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
      if (event.key === "Escape") closeEvidence();
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
          <strong>
            {!health
              ? "Connecting to snapshot"
              : health.mode === "real"
                ? "Official public records"
                : "Synthetic demonstration"}
          </strong>
          <p>
            Verified immutable snapshot.
            <br />
            Current public snapshot replicated by two independent operators.
          </p>
          {crmUrl && <a href={crmUrl}>Open Roofing CRM ↗</a>}
        </div>
        <a href="/api/evidence" target="_blank" rel="noopener noreferrer">
          Assessment evidence ↗
        </a>
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
            {!health
              ? "CONNECTING · MODE PENDING"
              : health.mode === "real"
                ? "REAL · OFFICIAL SOURCE"
                : "SYNTHETIC · DEMONSTRATION"}
          </span>
        </header>
        <div className="notice" role="note">
          <strong>
            {!health
              ? "Loading verified snapshot"
              : health.mode === "real"
                ? "Official parcel and site-address evidence"
                : "Demonstration dataset"}
          </strong>
          <span>
            {!health
              ? "Data mode and counts appear after the snapshot is verified."
              : health.mode === "real"
                ? `${health.count.toLocaleString()} canonical properties and ${(health.addressCount ?? 0).toLocaleString()} official site addresses. Roof, permit and ownership fields remain unknown where sources do not support them.`
                : `${health?.count ?? 0} synthetic properties prove the workflow. These records are separate from official county evidence.`}
          </span>
        </div>
        {accessRequired && (
          <section className="panel access-panel">
            <h2>Open the review workspace</h2>
            <p>
              Enter the evaluator access code. Access expires automatically.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void signIn();
              }}
            >
              <label>
                Review access code
                <input
                  type="password"
                  autoComplete="off"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                />
              </label>
              <button className="primary">Open workspace</button>
            </form>
          </section>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => void load()}>Retry connection</button>
          </div>
        )}
        {tab === "overview" && (
          <OverviewPanel
            health={health}
            runs={runs}
            coverage={coverage}
            snapshot={snapshot}
            loading={loading}
            onExplore={() => setTab("query")}
            currentPublication={currentPublication}
          />
        )}
        {tab === "query" && (
          <section
            className="panel query-panel"
            data-query-generation={binding?.generation ?? generation.current}
            data-query-hash={result?.queryHash ?? ""}
            data-snapshot-id={result?.snapshotId ?? snapshot}
            data-snapshot-digest={health?.snapshotDigest ?? ""}
            data-build-id={health?.buildId ?? ""}
            data-head={health?.head ?? ""}
            data-tree={health?.tree ?? ""}
            data-stage={health?.stage ?? ""}
            data-region={health?.region ?? ""}
            data-ui-head={uiIdentity.head}
            data-ui-tree={uiIdentity.tree}
            data-ui-build-id={uiIdentity.buildId}
            aria-busy={loading}
          >
            <div className="section-heading">
              <div>
                <span className="eyebrow">PORTABLE ANALYTICS</span>
                <h2>Find opportunities by evidence</h2>
                <p>
                  {health?.mode === "real"
                    ? "Source-qualified evidence · exact radius from site-address coordinates"
                    : "Synthetic DuckDB cohort · explicit demonstration mode"}
                </p>
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
                  step="0.1"
                  onChange={(e) => {
                    invalidate();
                    setRadius(Number(e.target.value));
                  }}
                />
              </label>
              <label>
                Roof older than (years)
                <input
                  type="number"
                  value={age}
                  min="0"
                  max="150"
                  onChange={(e) => {
                    invalidate();
                    setAge(Number(e.target.value));
                  }}
                />
              </label>
              <label>
                Permit opportunity
                <select
                  aria-label="Permit opportunity"
                  value={permitOpportunityMode}
                  onChange={(e) => {
                    invalidate();
                    setPermitOpportunityMode(
                      e.target.value as
                        QueryInput["permitOpportunityMode"] | "",
                    );
                    setPermits("any");
                    setMinDays(0);
                    setSourceFilters((current) => ({
                      ...current,
                      providerStatus: "any",
                      activity: "any",
                      issueAge: 0,
                    }));
                  }}
                >
                  <option value="">No permit filter</option>
                  <option value="any_roofing_permit">Any roofing permit</option>
                  <option value="confirmed_open">
                    Confirmed open / active
                  </option>
                  <option value="status_verification_needed">
                    Status verification needed
                  </option>
                  <option value="confirmed_closed">
                    Confirmed closed / final
                  </option>
                  <option value="lifecycle_unknown">Lifecycle unknown</option>
                </select>
              </label>
              {permitOpportunityMode === "status_verification_needed" && (
                <label>
                  Minimum age since issue/status (years)
                  <input
                    aria-label="Minimum age since issue/status (years)"
                    type="number"
                    min="0"
                    max="200"
                    value={minPermitObservationAgeYears}
                    onChange={(e) => {
                      invalidate();
                      setMinPermitObservationAgeYears(Number(e.target.value));
                    }}
                  />
                  <small>
                    Strict source-calendar age; these candidates are not
                    confirmed open permits.
                  </small>
                </label>
              )}
              <label>
                Permit status
                <select
                  aria-label="Permit status"
                  value={permits}
                  onChange={(e) => {
                    invalidate();
                    setPermits(e.target.value as typeof permits);
                  }}
                >
                  <option value="any">All permits</option>
                  <option value="open">Open permits</option>
                  <option value="closed">Closed permits</option>
                  <option value="unknown">Unknown permit status</option>
                </select>
              </label>
              <label>
                Minimum open days
                <input
                  type="number"
                  value={minDays}
                  min="0"
                  max="50000"
                  onChange={(e) => {
                    invalidate();
                    setMinDays(Number(e.target.value));
                  }}
                />
              </label>
              <label>
                Center latitude
                <input
                  aria-label="Center latitude"
                  type="number"
                  min="-90"
                  max="90"
                  step="any"
                  value={lat}
                  onChange={(e) => {
                    invalidate();
                    setLat(Number(e.target.value));
                  }}
                />
              </label>
              <label>
                Center longitude
                <input
                  aria-label="Center longitude"
                  type="number"
                  min="-180"
                  max="180"
                  step="any"
                  value={lng}
                  onChange={(e) => {
                    invalidate();
                    setLng(Number(e.target.value));
                  }}
                />
              </label>
              <label>
                Owner location
                <select
                  aria-label="Owner location"
                  value={ownerRegion}
                  onChange={(e) => {
                    invalidate();
                    setOwnerRegion(e.target.value as typeof ownerRegion);
                  }}
                >
                  <option value="any">Any / unknown allowed</option>
                  <option value="regional">Regional</option>
                  <option value="out_of_area">Out of area</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label>
                {health?.mode === "real"
                  ? "Latest reported sale older than (years)"
                  : "Ownership years minimum"}
                <input
                  type="number"
                  min="0"
                  max="200"
                  value={
                    health?.mode === "real" ? reportedSaleYears : ownershipYears
                  }
                  onChange={(e) => {
                    invalidate();
                    if (health?.mode === "real")
                      setReportedSaleYears(Number(e.target.value));
                    else setOwnershipYears(Number(e.target.value));
                  }}
                />
                {health?.mode === "real" && (
                  <small>
                    Partial sale history; unknown dates excluded when filtered.
                    This does not establish ownership tenure.
                  </small>
                )}
              </label>
              {health?.mode === "real" && (
                <SourceFilters
                  value={sourceFilters}
                  onChange={(next) => {
                    invalidate();
                    setSourceFilters(next);
                  }}
                />
              )}
              <button
                className="primary"
                disabled={loading || !health || accessRequired}
              >
                {loading ? "Searching…" : "Run query"}
              </button>
            </form>
            <div className="query-results-heading">
              <strong>{result?.total ?? 0} matching properties</strong>
              <span>
                {loading
                  ? "Query in progress; previous results cleared"
                  : dirty
                    ? "Filters changed. Run query to view matching evidence."
                    : "Exact radius · snapshot-bound evidence"}
              </span>
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
                          {roofBasis(p.roof.basis)} · {p.roof.confidence}
                        </small>
                      </td>
                      <td>
                        <PermitOpportunityBadges
                          property={p}
                          query={binding?.query ?? null}
                        />
                        {health?.mode === "real" && p.permits.length === 0 ? (
                          <>
                            Unknown<small>No sourced permit rows</small>
                          </>
                        ) : p.permits.every((x) => x.status === "unknown") ? (
                          <>
                            Status unknown
                            <small>
                              {p.permits.length} issued or unclassified
                              observations
                            </small>
                          </>
                        ) : (
                          <>
                            {
                              p.permits.filter((x) => x.status === "open")
                                .length
                            }{" "}
                            open
                            <small>
                              {p.permits.length} total ·{" "}
                              {
                                p.permits.filter((x) => x.status === "unknown")
                                  .length
                              }{" "}
                              unknown
                            </small>
                          </>
                        )}
                      </td>
                      <td>{(p.distanceMeters / 1609.344).toFixed(1)} mi</td>
                      <td>
                        <button
                          disabled={loading || dirty}
                          className="text-button"
                          onClick={() => void inspect(p.id)}
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
            {(loading || dirty) && (
              <div className="empty" role="status">
                <h3>
                  {loading ? "Searching this snapshot…" : "Filters changed"}
                </h3>
                <p>
                  {loading
                    ? "Results and detail actions will appear when this query completes."
                    : "Run the query to load evidence for these filters."}
                </p>
              </div>
            )}
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
              {result?.nextCursor && (
                <button
                  className="text-button"
                  disabled={loading || dirty}
                  onClick={() =>
                    void search(healthRef.current, result.nextCursor!)
                  }
                >
                  Next 50 matches →
                </button>
              )}
              <span>
                {result?.truncated
                  ? "Results are paginated; additional matches exist."
                  : "All matches shown for this bounded query."}
              </span>
              <details className="query-proof">
                <summary>Applied query and identity</summary>
                <pre>
                  {JSON.stringify(
                    {
                      query: binding?.query ?? null,
                      queryHash: result?.queryHash ?? null,
                      generation: binding?.generation ?? generation.current,
                      snapshotId: health?.snapshotId,
                      snapshotDigest: health?.snapshotDigest,
                      buildId: health?.buildId,
                      limitations: result?.limitations,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </div>
          </section>
        )}
        {tab === "artifacts" && (
          <ArtifactsPanel
            manifest={manifest}
            currentPublication={currentPublication}
          />
        )}
        <footer>
          <span>PRISM / PROPERTY INTELLIGENCE</span>
          <span>
            Assessment · {health?.stage ?? "local"} ·{" "}
            {health?.region ?? "us-east-2"} ·{" "}
            {health?.dataMode ?? health?.mode ?? "loading"}
          </span>
        </footer>
      </main>
      {selected && (
        <EvidenceDetails
          selected={selected}
          health={health}
          result={result}
          binding={binding}
          closeEvidence={closeEvidence}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
