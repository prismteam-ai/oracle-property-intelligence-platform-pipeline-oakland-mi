import { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import type {
  Property,
  QueryInput,
  SearchResponse,
} from "../../../packages/contracts/src/index.ts";
import type { SourceContext } from "../../../packages/hosted-runtime/src/source-context.ts";
import type { RuntimeIdentity } from "../../../packages/hosted-runtime/src/release.ts";
import "./style.css";
declare const __PRISM_UI_IDENTITY__: RuntimeIdentity;
const uiIdentity = __PRISM_UI_IDENTITY__;
const roofBasis = (basis: string) =>
  basis === "built_year" ? "building year proxy" : basis.replaceAll("_", " ");
function MunicipalSource({
  sourceId,
  recordId,
}: {
  sourceId: string;
  recordId: string;
}) {
  const [source, setSource] = useState<SourceContext | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    setSource(null);
    setFailed(false);
    const abort = new AbortController(),
      page = recordId.match(/:page:(\d+)/)?.[1];
    let active = true;
    void get<{ source: SourceContext }>(
      `source-context?sourceId=${encodeURIComponent(sourceId)}${page ? `&page=${page}` : ""}`,
      abort.signal,
    )
      .then((v) => {
        if (active) setSource(v.source);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [sourceId, recordId]);
  if (!source)
    return (
      <p className="muted">
        {failed
          ? "Report context unavailable. No additional source facts inferred."
          : "Loading report context…"}
      </p>
    );
  return (
    <div className="source-context">
      <p>
        <a
          href={source.pageUrl ?? source.officialReportUrl}
          target="_blank"
          rel="noreferrer"
        >
          {source.visibleTitle}
          {source.page ? ` · page ${source.page}` : ""}
        </a>{" "}
        ·{" "}
        <a
          href={source.officialLandingPageUrl}
          target="_blank"
          rel="noreferrer"
        >
          Official report page
        </a>
      </p>
      <p>
        Retrieved {source.sourceObservedAt}. Declared report period: not stated
        in reviewed headers.
      </p>
      <p>
        Observed sale dates: {source.observedSaleDateRange.from}–
        {source.observedSaleDateRange.to}. This range is not the declared report
        period.
      </p>
      <p>{source.exactPinMatchMethod}.</p>
      <p>
        Low-confidence building year proxy. Roof replacement and condition are
        unverified. Reported sales are partial history and do not establish
        ten-year ownership.
      </p>
    </div>
  );
}
interface Run {
  id: string;
  at: string;
  source: string;
  sourceCount: number | null;
  processed: number | null;
  added: number | null;
  changed: number | null;
  deleted: number | null;
  unchanged: number | null;
  state: string;
  limitations: string[];
  raw?: unknown;
}
interface Coverage {
  source: string;
  scope: string;
  state: string;
  count: number | null;
  limitations: string[];
}
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const number = (v: unknown): number | null =>
  typeof v === "number" ? v : null;
function normalizeRun(value: unknown): Run {
  const r = object(value);
  if ("at" in r) return value as Run;
  return {
    id: String(r.id ?? "Source run"),
    at: String(r.completedAt ?? r.startedAt ?? ""),
    source: String(r.kind ?? "official source"),
    sourceCount: null,
    processed: null,
    added: null,
    changed: null,
    deleted: null,
    unchanged: null,
    state: r.complete ? "COMPLETE" : "INCOMPLETE",
    limitations: ["Use the source receipt for layer counts and delta details."],
    raw: value,
  };
}
function normalizeCoverage(value: unknown): Coverage {
  const c = object(value);
  if ("source" in c) return value as Coverage;
  const counts = object(c.counts);
  return {
    source: "Official selected layers",
    scope: `${number(counts.parcels)?.toLocaleString() ?? "Unknown"} parcels · ${number(counts.addresses)?.toLocaleString() ?? "Unknown"} official site addresses`,
    state: c.completeSelectedLayers ? "complete_selected_layers" : "partial",
    count: number(counts.properties),
    limitations: Array.isArray(c.limitations)
      ? c.limitations.map(String)
      : ["Coverage unknown"],
  };
}
interface Manifest {
  snapshotId: string;
  files?: { name: string; bytes: number; sha256: string }[];
  items?: { name: string; size: number; digest: string; cid: string | null }[];
  car?: { state: string; reason: string };
  limitations?: string[];
  [key: string]: unknown;
}
interface Health {
  snapshotId: string;
  snapshotDigest: string;
  mode: "real" | "synthetic";
  count: number;
  addressCount?: number;
  buildId: string;
  accessMode: string;
  dataMode?: "synthetic" | "real-public" | "protected-real";
  head?: string;
  tree?: string;
  stage?: string;
  region?: string;
  contractVersion?: string;
  contractSha256?: string;
}
async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`/api/${path}`, { signal });
  if (r.status === 401) throw new Error("REVIEW_ACCESS_REQUIRED");
  if (!r.ok)
    throw new Error("The data service could not complete this request.");
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
    [age, setAge] = useState(0),
    [permits, setPermits] = useState<"any" | "open" | "closed">("any"),
    [minDays, setMinDays] = useState(0);
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
  const latest = runs.at(-1);
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
      // A review runtime has two reserved slots. Pace bootstrap reads so a
      // single browser does not saturate them before the workspace opens.
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
            Public base replicated · private enrichment stays protected.
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
                  {latest?.added === null
                    ? "Unknown"
                    : `+${latest?.added ?? 0}`}
                  <i> / {latest?.changed ?? "Unknown"} changed</i>
                </strong>
                <small>
                  {latest?.deleted ?? "Unknown"} tombstones recorded
                </small>
              </div>
              <div>
                <span>PUBLIC REPLICAS</span>
                <strong>2</strong>
                <small>Public P2 base · verified October 27</small>
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
                Every query and detail view uses this immutable snapshot
                identity.
              </p>
              <button className="text-button" onClick={() => setTab("query")}>
                Explore the snapshot →
              </button>
            </section>
          </>
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
                    ? "Official evidence · exact radius from site-address coordinates"
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
                  step="0.00001"
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
                  step="0.00001"
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
          <section className="panel artifact-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">ARTIFACT IDENTITY</span>
                <h2>Snapshot integrity and publication evidence</h2>
                <p>
                  Runtime file hashes are verified. The public P2 base has a
                  separate publication receipt. The current working view is
                  verified independently; protected staging includes private
                  enrichment.
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
                <h3>Public base published on two free providers</h3>
                <p>
                  Recorded October 27, 2026: Filebase and Pinata both pinned the
                  exact public P2 base. All eight files matched their SHA-256
                  hashes on each provider. Pinata retrieval also passed while
                  the Filebase pin was temporarily removed, then restored.
                </p>
                <p>
                  <strong>Public base only:</strong>{" "}
                  oakland-real-71c0ba7aafadd0e4301b
                </p>
                <code>
                  bafybeieujobn76aabzjlznxpc5ovwy7fmgjhzuy47zhrcm2a4z54o5ujzu
                </code>
                <p>
                  Owner derivatives, protected observations, contacts and
                  provider records were excluded. The runtime manifest alongside
                  this receipt describes the current working view.
                </p>
                <p className="muted">
                  This is recorded verification, not a live availability
                  monitor. Public gateways ipfs.io and dweb.link could not be
                  verified from the assessment network. Provider pins do not
                  prove isolated storage or permanent retention. IPNS was
                  verified with a 48-hour validity period; renewal is not
                  scheduled.
                </p>
                <p className="muted">
                  Publication was performed separately under explicit user
                  approval. This interface performs no uploads or IPNS updates.
                </p>
              </article>
            </div>
            <details>
              <summary>View machine-readable runtime manifest</summary>
              <pre>{JSON.stringify(manifest, null, 2)}</pre>
            </details>
          </section>
        )}
        <footer>
          <span>PRISM / PROPERTY INTELLIGENCE</span>
          <span>
            P3 · {health?.stage ?? "local"} · {health?.region ?? "us-east-1"} ·{" "}
            {health?.dataMode ?? health?.mode ?? "loading"}
          </span>
        </footer>
      </main>
      {selected && (
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
                ? "Official source evidence"
                : "Synthetic fixture"}
            </span>
            <p className="muted">
              Snapshot {result?.snapshotId} · query{" "}
              {result?.queryHash.slice(0, 16)} · generation{" "}
              {binding?.generation}
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
                  A reported sale date is not a verified transfer event or proof
                  of continuous ownership.
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
            <h3>Permits and contractor evidence</h3>
            {selected.permits.map((p) => (
              <article className="detail-permit" key={p.id}>
                <strong>{p.permitNumber ?? p.id}</strong>
                <p>
                  {p.jurisdiction ?? "Jurisdiction unavailable"} ·{" "}
                  {p.reportedPermitType ?? p.kind.replaceAll("_", " ")}
                </p>
                <p>
                  Issued {p.issuedAt ?? "date unavailable"} · Status {p.status}
                  {p.statusBasis
                    ? ` (${p.statusBasis.replaceAll("_", " ")})`
                    : ""}
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
                  {p.provenance.some(
                    (source) =>
                      source.sourceId === "official-troy-issued-permits",
                  )
                    ? "Business applicant (contractor role unverified): "
                    : "Reported contractor: "}
                  {p.contractor.reportedName ?? "Unavailable"}
                </p>
                <p>
                  Verified company:{" "}
                  {p.contractor.verifiedCompanyId ?? "Unresolved"}
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
                    · {p.contractor.ratingEvidence.matchConfidence} match
                    confidence · observed{" "}
                    {p.contractor.ratingEvidence.observedAt}. A BBB grade is not
                    a numeric score or a license.
                  </p>
                )}
                {p.matchEvidence && (
                  <p>
                    Property match: {p.matchEvidence.basis.replaceAll("_", " ")}{" "}
                    · {p.matchEvidence.confidence} confidence.{" "}
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
                Permit evidence is unavailable for this record. This is not
                proof of permit absence.
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
