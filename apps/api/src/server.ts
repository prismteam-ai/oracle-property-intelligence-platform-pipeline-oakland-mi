import { loadRedactedSummary } from "../../../packages/receipts/src/redacted-summary.ts";
import http from "node:http";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  CONTRACT_VERSION,
  DomainError,
} from "../../../packages/contracts/src/index.ts";
import {
  syntheticProperties,
  SNAPSHOT_ID,
} from "../../../packages/test-support/src/fixtures.ts";
import { SnapshotReader } from "../../../packages/query/src/index.ts";
import { DuckSnapshot } from "../../../packages/query/src/duckdb.ts";
import { RunLedger } from "../../../packages/run-ledger/src/index.ts";
import { callTool } from "../../../packages/mcp-adapter/src/index.ts";
import { dryManifest } from "../../../packages/publication/src/index.ts";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const properties = syntheticProperties(),
  reader = new SnapshotReader(SNAPSHOT_ID, properties);
const duck = await DuckSnapshot.create(SNAPSHOT_ID, properties);
let clockStep = 0;
const ledger = new RunLedger(path.join(root, "data/local-runs"), () =>
  new Date(Date.UTC(2026, 9, 26, 14, clockStep++)).toISOString(),
);
const first = [
  ...properties.slice(0, -1).map((p) => ({
    nativeId: p.nativeId,
    content: { propertyId: p.id, age: p.roof.ageYears, sourceRevision: 1 },
  })),
  {
    nativeId: "SYN-RETIRED-TEST",
    content: { propertyId: "SYN-RETIRED", age: 9, sourceRevision: 1 },
  },
];
await ledger.run("fixture-run-01", first);
await ledger.run(
  "fixture-run-02",
  [
    ...properties.map((p, index) => ({
      nativeId: p.nativeId,
      content: {
        propertyId: p.id,
        age: p.roof.ageYears,
        sourceRevision: index === 44 ? 2 : 1,
      },
    })),
    { nativeId: "SYN-RETIRED-TEST", content: {}, tombstone: true },
  ],
  { transformVersion: "v1" },
);
await mkdir(path.join(root, "data"), { recursive: true });
const coverage = [
  {
    source: "Synthetic product fixtures",
    scope: "48 properties / one local demonstration cohort",
    state: "fixture_only",
    count: 48,
    limitations: [
      "Not a county dataset",
      "Permits, identity and ratings are synthetic",
    ],
  },
  {
    source: "Oakland official parcel sample",
    scope: "Private minimized source slice",
    state: "external_private_sample",
    count: null,
    limitations: [
      "Run the private real-slice command for redacted count/digest evidence",
      "Raw real rows are never served by fixture endpoints",
    ],
  },
  {
    source: "Municipal permit history",
    scope: "63 authority inventory; no full-county acquisition",
    state: "unavailable_in_fixture",
    count: null,
    limitations: [
      "Official-source feasibility is recorded separately; unknown is not zero",
    ],
  },
];
function send(res: http.ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}
async function body(req: http.IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of req) {
    text += String(chunk);
    if (Buffer.byteLength(text) > 65536)
      throw new DomainError("INVALID_INPUT", "Payload too large");
  }
  return JSON.parse(text || "{}") as unknown;
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/api/health")
      return send(res, 200, {
        contractVersion: CONTRACT_VERSION,
        snapshotId: SNAPSHOT_ID,
        mode: "synthetic",
        county: "Oakland County, MI",
        engine: "DuckDB portable snapshot",
        count: properties.length,
        upstreamMcp: false,
      });
    if (req.method === "POST" && url.pathname === "/api/search")
      return send(res, 200, await duck.search(await body(req)));
    if (req.method === "GET" && url.pathname.startsWith("/api/properties/"))
      return send(
        res,
        200,
        reader.detail(
          decodeURIComponent(url.pathname.split("/").at(-1)!),
          url.searchParams.get("snapshotId") ?? "",
        ),
      );
    if (req.method === "GET" && url.pathname === "/api/runs")
      return send(res, 200, (await ledger.inspect()).runs);
    if (req.method === "GET" && url.pathname === "/api/coverage") {
      const summary = process.env.PRISM_REAL_SUMMARY
        ? await loadRedactedSummary(process.env.PRISM_REAL_SUMMARY)
        : null;
      const safeCoverage = coverage.map((c) =>
        c.source === "Oakland official parcel sample" && summary
          ? {
              ...c,
              count: summary.canonicalCount,
              state: "verified_minimized_sample",
              limitations: [
                "Private transformed sample verified; no raw rows served",
                ...summary.unknowns.map(
                  (s) => `${s}: unknown from parcel sample`,
                ),
              ],
            }
          : c,
      );
      return send(res, 200, safeCoverage);
    }
    if (req.method === "GET" && url.pathname === "/api/manifest")
      return send(res, 200, dryManifest(SNAPSHOT_ID, properties));
    if (req.method === "POST" && url.pathname === "/api/tools")
      return send(res, 200, callTool(reader, await body(req)));
    if (req.method === "GET" && url.pathname === "/api/real-summary") {
      const p = process.env.PRISM_REAL_SUMMARY;
      if (!p)
        return send(res, 200, {
          state: "not_loaded",
          reason: "Private file path required; no real rows served",
        });
      return send(res, 200, await loadRedactedSummary(p));
    }
    return send(res, 404, {
      code: "INVALID_INPUT",
      message: "Route not found",
    });
  } catch (error) {
    const e =
      error instanceof DomainError
        ? error
        : new DomainError("INVALID_INPUT", "Request rejected");
    send(res, e.code === "CONFLICT" ? 409 : 400, {
      code: e.code,
      message: e.message,
    });
  }
});
server.listen(4310, "127.0.0.1", () =>
  console.log(
    "Oracle local API http://127.0.0.1:4310 · synthetic fixture only",
  ),
);
process.on("SIGTERM", () =>
  server.close(() => {
    duck.close();
    process.exit(0);
  }),
);
