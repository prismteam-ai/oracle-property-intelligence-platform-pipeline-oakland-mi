import {
  compiledIdentity,
  assertRuntimeRegion,
} from "../../../packages/hosted-runtime/src/runtime-identity.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { preparePrivateCache } from "../../../packages/hosted-runtime/src/private-cache.ts";
import { AccessService } from "../../../packages/hosted-runtime/src/access.ts";
import { MemoryQuotaStore } from "../../../packages/hosted-runtime/src/quota.ts";
import { MemorySessionStore } from "../../../packages/hosted-runtime/src/sessions.ts";
import { DynamoSessionStore } from "../../../packages/hosted-runtime/src/sessions.ts";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createActiveSnapshot } from "../../../packages/query/src/active.ts";
import { secretAccessProvider } from "../../../packages/hosted-runtime/src/secrets.ts";
import { DynamoQuotaStore } from "../../../packages/hosted-runtime/src/quota.ts";
import { prepareSnapshotCache } from "../../../packages/hosted-runtime/src/snapshot-cache.ts";
import { createApi, type ApiRequest } from "./handler.ts";
import {
  telemetry,
  operationForPath,
} from "../../../packages/hosted-runtime/src/observability.ts";
export { alertHandler } from "../../../packages/hosted-runtime/src/alerts.ts";
interface V2Event {
  version: string;
  rawPath: string;
  rawQueryString?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string>;
  cookies?: string[];
  requestContext: { http: { method: string; sourceIp?: string } };
}
let prepared: Promise<ReturnType<typeof createApi>> | undefined;
async function runtime() {
  const identity = compiledIdentity();
  assertRuntimeRegion(identity);
  if (process.env.PRISM_DATA_MODE === "synthetic") {
    if (process.env.PRISM_RUNTIME_EMULATION !== "1")
      throw new Error(
        "Hosted synthetic runtime requires explicit emulation mode",
      );
  } else if (process.env.PRISM_RUNTIME_EMULATION !== "1")
    process.env.PRISM_SNAPSHOT_DIR = await prepareSnapshotCache();
  process.env.PRISM_REQUIRE_AUTH = "1";
  if (process.env.PRISM_ENABLE_PROTECTED_VIEW === "1") {
    if (
      process.env.PRISM_DATA_MODE !== "real" ||
      !process.env.PRISM_SNAPSHOT_DIR
    )
      throw new Error("Protected view requires a real verified public base");
    const base = JSON.parse(
      await readFile(
        path.join(process.env.PRISM_SNAPSHOT_DIR, "artifact-manifest.json"),
        "utf8",
      ),
    ) as { snapshotId: string };
    await preparePrivateCache(base.snapshotId);
  }
  const snapshot = await createActiveSnapshot();
  telemetry.snapshot(snapshot.count, snapshot.addressCount);
  if (process.env.PRISM_RUNTIME_EMULATION === "1")
    return createApi({
      snapshot,
      access: async () =>
        new AccessService({
          signingKey: process.env.PRISM_EMULATION_SIGNING_KEY ?? "",
          reviewCodeDigest: process.env.PRISM_EMULATION_CODE_DIGEST ?? "",
          keyVersion: "emulation",
        }),
      quota: new MemoryQuotaStore(),
      sessions: new MemorySessionStore(),
      buildId: process.env.PRISM_BUILD_ID,
      identity,
      mcpAllowedOrigins: (process.env.PRISM_MCP_ALLOWED_ORIGINS ?? "")
        .split(",")
        .filter(Boolean),
    });
  const secretId = process.env.PRISM_ACCESS_SECRET_ARN,
    table = process.env.PRISM_QUOTA_TABLE;
  if (!secretId || !table)
    throw new Error("Hosted access configuration required");
  return createApi({
    snapshot,
    access: secretAccessProvider(secretId),
    sessions: new DynamoSessionStore(
      DynamoDBDocumentClient.from(new DynamoDBClient({})),
      table,
    ),
    quota: new DynamoQuotaStore(
      DynamoDBDocumentClient.from(new DynamoDBClient({})),
      table,
    ),
    buildId: process.env.PRISM_BUILD_ID,
    identity,
    mcpAllowedOrigins: (process.env.PRISM_MCP_ALLOWED_ORIGINS ?? "")
      .split(",")
      .filter(Boolean),
  });
}
export async function handler(event: V2Event) {
  return telemetry.observe(operationForPath(event.rawPath ?? ""), () =>
    handle(event),
  );
}
async function handle(event: V2Event) {
  if (event.version !== "2.0")
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: "INVALID_INPUT",
        message: "HTTP API v2 event required",
      }),
    };
  try {
    prepared ??= runtime();
    const api = await prepared;
    const req: ApiRequest = {
      method: event.requestContext.http.method,
      path:
        event.rawPath +
        (event.rawQueryString ? `?${event.rawQueryString}` : ""),
      headers: {
        ...event.headers,
        cookie: event.cookies?.join("; ") ?? event.headers?.cookie,
      },
      body: event.isBase64Encoded
        ? Buffer.from(event.body ?? "", "base64").toString("utf8")
        : (event.body ?? undefined),
      sourceIp: event.requestContext.http.sourceIp,
    };
    const out = await api(req);
    const cookie = out.headers["Set-Cookie"];
    if (cookie) delete out.headers["Set-Cookie"];
    return { ...out, ...(cookie ? { cookies: [cookie] } : {}) };
  } catch {
    prepared = undefined;
    return {
      statusCode: 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        code: "SNAPSHOT_UNAVAILABLE",
        message: "Verified runtime unavailable",
      }),
    };
  }
}
