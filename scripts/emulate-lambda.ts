import type { RuntimeIdentity } from "../packages/hosted-runtime/src/release.ts";
import { sourceIdentity } from "../packages/hosted-runtime/src/source-identity.ts";
import { validatePrivateManifest } from "../packages/hosted-runtime/src/private-cache.ts";
import { privateEmulationEnvironment } from "../packages/hosted-runtime/src/private-emulation-env.ts";
import { protectedPermitOpenDays } from "../packages/county/src/private-permits.ts";
import type { SearchResponse } from "../packages/contracts/src/index.ts";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
const image =
    "public.ecr.aws/lambda/nodejs@sha256:92b7cccd985332238af80ac8da42d6965d418552e88955e315da4e3c0c76ca79",
  root = process.cwd(),
  mode = process.env.PRISM_DATA_MODE ?? "synthetic",
  snapshot = process.env.PRISM_SNAPSHOT_DIR;
const privateDirectory = process.env.PRISM_PRIVATE_OPERATIONAL_DIR;
const memoryMiB = Number(process.env.PRISM_EMULATOR_MEMORY_MIB ?? "4096");
if (![2560, 3008, 4096].includes(memoryMiB))
  throw new Error("Unsupported measured memory cap");
if (mode === "real" && !snapshot)
  throw new Error(
    "Real emulation requires an explicit verified snapshot directory",
  );
const publicManifestSha256 = snapshot
  ? createHash("sha256")
      .update(await readFile(path.join(snapshot, "artifact-manifest.json")))
      .digest("hex")
  : undefined;
const privateManifestSha256 = privateDirectory
  ? createHash("sha256")
      .update(
        await readFile(
          path.join(privateDirectory, "private-operational-manifest.json"),
        ),
      )
      .digest("hex")
  : undefined;
const cpuLimit = memoryMiB <= 3008 ? 1 : 2;
const packageReport = JSON.parse(
  await readFile(path.join(root, "dist-lambda/package-report.json"), "utf8"),
) as { zipSha256: string; identity: RuntimeIdentity };
const source = sourceIdentity();
if (
  source.head !== packageReport.identity.head ||
  source.tree !== packageReport.identity.tree ||
  (packageReport.identity.stage === "p3-review" && source.dirty)
)
  throw new Error("Emulation must match measured clean staging source");
const archive = path.join(root, "oracle-lambda.zip"),
  archiveDigest = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
if (archiveDigest !== packageReport.zipSha256)
  throw new Error("Deployment archive does not match measured package");
const extractionRoot = path.join(root, "data/lambda-emulation");
await mkdir(extractionRoot, { recursive: true });
const packageDirectory = await mkdtemp(path.join(extractionRoot, "archive-"));
execFileSync("unzip", ["-q", archive, "-d", packageDirectory]);
const code = "synthetic-emulation-fixture-code",
  signingKey = randomBytes(48).toString("hex"),
  name = `prism-oracle-rie-${process.pid}`;
const args = [
  "run",
  "--rm",
  "-d",
  "--name",
  name,
  "--network",
  "none",
  "--memory",
  `${memoryMiB}m`,
  "--cpus",
  String(cpuLimit),
  "--pids-limit",
  "128",
  "--read-only",
  "--tmpfs",
  "/tmp:rw,size=4294967296",
  "--mount",
  `type=bind,src=${packageDirectory},dst=/var/task,readonly`,
  "-e",
  "PRISM_RUNTIME_EMULATION=1",
  "-e",
  `PRISM_DATA_MODE=${mode}`,
  "-e",
  "PRISM_FIXTURE_RUN_DIR=/tmp/fixture-runs",
  "-e",
  `PRISM_EMULATION_SIGNING_KEY=${signingKey}`,
  "-e",
  `PRISM_EMULATION_CODE_DIGEST=${createHash("sha256").update(code).digest("hex")}`,
  "-e",
  "AWS_REGION=us-east-1",
];
if (snapshot)
  args.push(
    "--mount",
    `type=bind,src=${path.resolve(snapshot)},dst=/snapshot,readonly`,
    "-e",
    "PRISM_SNAPSHOT_DIR=/snapshot",
  );
if (privateDirectory) {
  if (mode !== "real" || !snapshot)
    throw new Error("Protected emulation requires real public base");
  const base = JSON.parse(
      await readFile(path.join(snapshot, "artifact-manifest.json"), "utf8"),
    ) as { snapshotId: string },
    raw = JSON.parse(
      await readFile(
        path.join(privateDirectory, "private-operational-manifest.json"),
        "utf8",
      ),
    ) as unknown;
  validatePrivateManifest(raw, base.snapshotId);
  args.push(
    "--mount",
    `type=bind,src=${path.resolve(privateDirectory)},dst=/protected,readonly`,
  );
  for (const f of raw.files) {
    const bytes = await readFile(path.join(privateDirectory, f.name));
    if (
      bytes.length !== f.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== f.sha256
    )
      throw new Error("Private emulation integrity failure");
  }
  for (const [name, value] of Object.entries(privateEmulationEnvironment(raw)))
    args.push("-e", `${name}=${value}`);
}
args.push(image, "index.handler");
let id: string;
try {
  id = execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
} catch {
  await rm(packageDirectory, { recursive: true, force: true });
  throw new Error(
    "Local Docker RIE failed to start; fixture configuration redacted",
  );
}
interface Response {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
  cookies?: string[];
}
const invocationMilliseconds: number[] = [];
async function invoke(
  method: string,
  rawPath: string,
  body?: unknown,
  cookie?: string,
  headers: Record<string, string> = {},
) {
  const event = {
    version: "2.0",
    rawPath: rawPath.split("?")[0],
    rawQueryString: rawPath.split("?").slice(1).join("?"),
    headers: { "content-type": "application/json", ...headers },
    cookies: cookie ? [cookie] : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method, sourceIp: "127.0.0.1" } },
  };
  const program =
    "let input='';for await(const c of process.stdin)input+=c;const r=await fetch('http://127.0.0.1:8080/2015-03-31/functions/function/invocations',{method:'POST',body:input});console.log(await r.text())";
  const start = performance.now();
  const raw = execFileSync(
    "docker",
    ["exec", "-i", id, "node", "--input-type=module", "-e", program],
    { input: JSON.stringify(event), encoding: "utf8", timeout: 120000 },
  );
  const milliseconds = performance.now() - start;
  invocationMilliseconds.push(milliseconds);
  return { out: JSON.parse(raw) as Response, milliseconds };
}
try {
  // Start-up polling is local to the network-disabled container.
  let health: Awaited<ReturnType<typeof invoke>> | undefined;
  for (let n = 0; n < 10; n++) {
    try {
      health = await invoke("GET", "/api/health");
      break;
    } catch {
      if (n === 9) throw new Error("Local RIE did not start");
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  if (!health || health.out.statusCode !== 200)
    throw new Error(`Packaged health failed: ${JSON.stringify(health?.out)}`);
  const h = JSON.parse(health.out.body) as {
    snapshotId: string;
    mode: string;
    snapshotDigest: string;
    count: number;
    addressCount?: number;
    head: string;
    tree: string;
    buildId: string;
    contractVersion: string;
    contractSha256: string;
    stage: string;
    region: string;
    dataMode: string;
  };
  if (h.mode !== mode) throw new Error("Emulator mode drift");
  for (const key of [
    "head",
    "tree",
    "buildId",
    "contractVersion",
    "contractSha256",
    "stage",
    "region",
  ] as const)
    if (h[key] !== packageReport.identity[key])
      throw new Error("Packaged runtime identity drift");
  const unauthorized = await invoke("GET", "/api/coverage");
  if (unauthorized.out.statusCode !== 401)
    throw new Error("Unauthenticated data route exposed");
  const login = await invoke("POST", "/api/session", { accessCode: code });
  const cookie = login.out.cookies?.[0]?.split(";")[0];
  if (login.out.statusCode !== 200 || !cookie)
    throw new Error("Packaged session issue failed");
  const q = {
    snapshotId: h.snapshotId,
    lat: 42.66,
    lng: -83.29,
    radiusMeters: 8046.72,
    includeUnknown: true,
    permitStatus: "any",
    limit: 10,
  };
  const cold = await invoke("POST", "/api/search", q, cookie),
    warm = await invoke("POST", "/api/search", q, cookie);
  if (cold.out.statusCode !== 200 || warm.out.statusCode !== 200)
    throw new Error("Packaged query failed");
  const result = JSON.parse(warm.out.body) as {
    rows: unknown[];
    total: number;
    queryHash: string;
  };
  const rpc = async (
    id: number,
    method: string,
    params: Record<string, unknown>,
  ) => {
    const invoked = await invoke(
      "POST",
      "/api/mcp",
      { jsonrpc: "2.0", id, method, params },
      cookie,
      { accept: "application/json, text/event-stream" },
    );
    const message = JSON.parse(invoked.out.body) as {
      id?: number;
      error?: unknown;
      result?: Record<string, unknown>;
    };
    if (
      invoked.out.statusCode !== 200 ||
      message.error ||
      message.id !== id ||
      !message.result
    )
      throw new Error("Packaged MCP protocol failure");
    return message.result;
  };
  await rpc(1, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "prism-p3-rie", version: "1" },
  });
  const tools = (await rpc(2, "tools/list", {})).tools as unknown[];
  if (!Array.isArray(tools) || tools.length !== 3)
    throw new Error("Packaged MCP discovery failure");
  const mcpStatus = (
    await rpc(3, "tools/call", {
      name: "snapshot_status",
      arguments: { snapshotId: h.snapshotId },
    })
  ).structuredContent as { snapshotId?: string; digest?: string };
  if (
    mcpStatus?.snapshotId !== h.snapshotId ||
    mcpStatus.digest !== h.snapshotDigest
  )
    throw new Error("Packaged MCP snapshot mismatch");
  const mcpSearch = (
    await rpc(4, "tools/call", {
      name: "search_properties",
      arguments: { ...q, limit: 1 },
    })
  ).structuredContent as { snapshotId?: string; rows?: unknown[] };
  if (
    mcpSearch?.snapshotId !== h.snapshotId ||
    !Array.isArray(mcpSearch.rows) ||
    mcpSearch.rows.length > 1
  )
    throw new Error("Packaged MCP search bound failed");
  let protectedChecks: Record<string, unknown> | undefined;
  if (privateDirectory) {
    const roof = await invoke(
        "POST",
        "/api/search",
        {
          ...q,
          radiusMeters: 32187,
          roofMinAgeYears: 15,
          includeUnknown: false,
        },
        cookie,
      ),
      owner = await invoke(
        "POST",
        "/api/search",
        { ...q, ownerRegion: "out_of_area" },
        cookie,
      ),
      tenure = await invoke(
        "POST",
        "/api/search",
        { ...q, minOwnershipYears: 10 },
        cookie,
      );
    if (
      roof.out.statusCode !== 200 ||
      owner.out.statusCode !== 200 ||
      tenure.out.statusCode !== 400
    )
      throw new Error("Protected evidence guards failed");
    const evidence = JSON.parse(roof.out.body) as {
      total: number;
      rows: {
        roof: { ageYears: number | null; basis: string; caveats: string[] };
        ownership: {
          lastTransferDate: string | null;
          events?: { kind: string }[];
        };
      }[];
    };
    if (
      evidence.total < 1 ||
      !evidence.rows.every(
        (p) =>
          p.roof.ageYears !== null &&
          p.roof.ageYears > 15 &&
          p.roof.basis === "built_year" &&
          p.roof.caveats.some((c) =>
            /^Source-reported building year: \d{4}\. This is a building year proxy, not a verified roof installation year\.$/.test(
              c,
            ),
          ) &&
          p.ownership.lastTransferDate === null,
      )
    )
      throw new Error("Protected roof proxy semantics failed");
    const open = await invoke(
      "POST",
      "/api/search",
      {
        ...q,
        radiusMeters: 32000,
        permitStatus: "open",
        minOpenDays: 1827,
        includeUnknown: false,
        limit: 2,
      },
      cookie,
    );
    const openEvidence = JSON.parse(open.out.body) as SearchResponse;
    if (
      open.out.statusCode !== 200 ||
      !Array.isArray(openEvidence.rows) ||
      !Number.isSafeInteger(openEvidence.total) ||
      openEvidence.total < openEvidence.rows.length ||
      openEvidence.rows.length > 2 ||
      !openEvidence.rows.every((row) =>
        row.permits.some(
          (permit) =>
            (protectedPermitOpenDays(permit, row.roof.asOf) ?? -1) >= 1827,
        ),
      )
    )
      throw new Error("Packaged explicit open-duration filter failed");
    const context = await invoke(
        "GET",
        "/api/source-context?sourceId=official-novi-residential-sales-pdf&page=2",
        undefined,
        cookie,
      ),
      contextBody = JSON.parse(context.out.body) as {
        source?: {
          semanticBasis?: string;
          declaredReportPeriod?: unknown;
          pageUrl?: string;
          observations?: unknown;
        };
      };
    if (
      context.out.statusCode !== 200 ||
      contextBody.source?.semanticBasis !== "building_year_proxy" ||
      contextBody.source.declaredReportPeriod !== null ||
      !contextBody.source.pageUrl?.endsWith("#page=2") ||
      contextBody.source.observations
    )
      throw new Error("Packaged source context semantics failed");
    protectedChecks = {
      sourceReportedBuildingYearPresent: true,
      sourceContextMetadataNoRows: true,
      sourceContextDeclaredPeriodUnknown: true,
      roofProxyMatches: evidence.total,
      explicitOpenOverFiveYearsMatches: openEvidence.total,
      emptyOpenResultAccepted: openEvidence.total === 0,
      returnedProxyRows: evidence.rows.length,
      sourceReportedSaleEvents: evidence.rows.reduce(
        (a, p) =>
          a +
          (p.ownership.events?.filter((e) => e.kind === "reported_sale")
            .length ?? 0),
        0,
      ),
      outOfAreaMatches: (JSON.parse(owner.out.body) as { total: number }).total,
      tenureRemainsUnsupported: true,
      privateRowsReturnedInEvidence: false,
      ownerZeroIsNotProofOfAbsence: true,
      ownerEvidenceState:
        "Source format is partial or unknown; positive owner-state results are not assumed",
    };
  }
  const bad = await invoke(
    "POST",
    "/api/search",
    { ...q, sql: "SELECT arbitrary" },
    cookie,
  );
  if (bad.out.statusCode !== 400)
    throw new Error("Packaged rawSQL guard failed");
  await invoke("DELETE", "/api/session", undefined, cookie);
  if (
    (await invoke("GET", "/api/coverage", undefined, cookie)).out.statusCode !==
    401
  )
    throw new Error("Packaged revoked session accepted");
  const abi = JSON.parse(
    execFileSync(
      "docker",
      [
        "exec",
        "-w",
        "/var/task",
        id,
        "node",
        "--input-type=module",
        "-e",
        "import {DuckDBInstance} from '@duckdb/node-api';const db=await DuckDBInstance.create(':memory:');const c=await db.connect();const rows=await(await c.run('SELECT 42 AS answer')).getRowObjectsJson();console.log(JSON.stringify({node:process.version,modules:process.versions.modules,napi:process.versions.napi,platform:process.platform,architecture:process.arch,glibc:process.report.getReport().header.glibcVersionRuntime,nativeSelect42:rows[0].answer}));c.closeSync();db.closeSync();",
      ],
      { encoding: "utf8" },
    ),
  );
  const memory = execFileSync(
    "docker",
    ["stats", "--no-stream", "--format", "{{.MemUsage}}", id],
    { encoding: "utf8" },
  ).trim();
  if (invocationMilliseconds.some((n) => n >= 29000))
    throw new Error("Measured invocation exceeded configured29second envelope");
  const report = {
    kind: "actual AWS Runtime Interface Emulator",
    image,
    imageNetwork: "none",
    deployedArchiveSha256: archiveDigest,
    archiveExtractedForEmulation: true,
    configuredMemoryMiB: memoryMiB,
    configuredCpuLimit: cpuLimit,
    measuredInvocationCount: invocationMilliseconds.length,
    maximumInvocationMilliseconds: Math.max(...invocationMilliseconds),
    allInvocationsFitConfiguredTimeout: invocationMilliseconds.every(
      (n) => n < 29000,
    ),
    configuredTimeoutSeconds: 29,
    coldFitsConfiguredTimeout: health.milliseconds < 29000,
    allMeasuredQueriesFitConfiguredTimeout: [
      cold.milliseconds,
      warm.milliseconds,
    ].every((x) => x < 29000),
    snapshotMode: h.mode,
    runtimeIdentity: {
      head: h.head,
      tree: h.tree,
      buildId: h.buildId,
      contractVersion: h.contractVersion,
      contractSha256: h.contractSha256,
      stage: h.stage,
      region: h.region,
      dataMode: h.dataMode,
    },
    publicManifestSha256,
    privateManifestSha256,
    source: {
      head: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
        encoding: "utf8",
      }).trim(),
      contractSha256: createHash("sha256")
        .update(await readFile("packages/contracts/src/index.ts"))
        .digest("hex"),
    },
    protectedCompanionEnabled: !!privateDirectory,
    protectedChecks,
    snapshotId: h.snapshotId,
    snapshotDigest: h.snapshotDigest,
    count: h.count,
    addressCount: h.addressCount,
    abi,
    healthColdMilliseconds: health.milliseconds,
    firstSearchMilliseconds: cold.milliseconds,
    warmSearchMilliseconds: warm.milliseconds,
    queryHash: result.queryHash,
    totalMatches: result.total,
    returnedRows: result.rows.length,
    containerMemory: memory,
    assertions: {
      health: true,
      accessRequired: true,
      signedStoredSession: true,
      query: true,
      unknownKeyRejected: true,
      revocation: true,
      nativeDuckDb: true,
      hostedMcpDiscoveryAndBoundedSearch: true,
      compiledReleaseIdentity: true,
    },
    limitations: [
      "Local RIE is not a deployed Lambda/API Gateway/CDN proof.",
      "Cold invocation includes image runtime and snapshot initialization; search timings include local docker exec overhead.",
      "Emulation uses fixture secrets and memory session/quota stores; production code selects SecretsManager and DynamoDB adapters.",
      "Snapshot data is mounted read-only for emulation; production S3 integrity cache is exercised separately with fake object reader tests.",
    ],
    package: JSON.parse(
      await readFile(
        path.join(root, "dist-lambda/package-report.json"),
        "utf8",
      ),
    ),
  };
  if (
    snapshot &&
    createHash("sha256")
      .update(await readFile(path.join(snapshot, "artifact-manifest.json")))
      .digest("hex") !== publicManifestSha256
  )
    throw new Error(
      "Public artifact changed during emulation; evidence rejected",
    );
  if (
    privateDirectory &&
    createHash("sha256")
      .update(
        await readFile(
          path.join(privateDirectory, "private-operational-manifest.json"),
        ),
      )
      .digest("hex") !== privateManifestSha256
  )
    throw new Error(
      "Private artifact changed during emulation; evidence rejected",
    );
  const output = process.env.PRISM_EMULATOR_EVIDENCE;
  if (output) await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, package: undefined }, null, 2));
} finally {
  execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" });
  await rm(packageDirectory, { recursive: true, force: true });
}
