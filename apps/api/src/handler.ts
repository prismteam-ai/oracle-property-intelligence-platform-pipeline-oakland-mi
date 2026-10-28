import { assessmentEvidence } from "../../../packages/hosted-runtime/src/assessment-evidence.ts";
import { sourceContext } from "../../../packages/hosted-runtime/src/source-context.ts";
import { serveMcpFetch } from "../../../packages/mcp-adapter/src/server.ts";
import { compiledIdentity } from "../../../packages/hosted-runtime/src/runtime-identity.ts";
import { type RuntimeIdentity } from "../../../packages/hosted-runtime/src/release.ts";
import { type SessionStore } from "../../../packages/hosted-runtime/src/sessions.ts";
import { createHash } from "node:crypto";
import {
  CONTRACT_VERSION,
  DomainError,
  QuerySchema,
  type Property,
  type SearchResponse,
} from "../../../packages/contracts/src/index.ts";
import {
  AccessError,
  AccessService,
  readSessionCookie,
  sessionCookie,
  clearSessionCookie,
} from "../../../packages/hosted-runtime/src/access.ts";
import { type QuotaStore } from "../../../packages/hosted-runtime/src/quota.ts";
export interface ActiveSnapshot {
  snapshotId: string;
  mode: "real" | "synthetic";
  digest: string;
  count: number;
  addressCount?: number;
  search(input: unknown): Promise<SearchResponse>;
  detail(id: string, snapshotId: string): Promise<Property>;
  coverage: unknown[];
  runs: unknown[];
  manifest: unknown;
  close(): void;
}
export interface ApiRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body?: string;
  sourceIp?: string;
}
export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}
export interface ApiOptions {
  snapshot: ActiveSnapshot;
  access: () => Promise<AccessService>;
  quota: QuotaStore;
  sessions: SessionStore;
  local?: boolean;
  clock?: () => number;
  buildId?: string;
  identity?: RuntimeIdentity;
  mcpAllowedOrigins?: readonly string[];
}
export function createApi(options: ApiOptions) {
  const clock = options.clock ?? Date.now;
  const send = (
    statusCode: number,
    value: unknown,
    headers: Record<string, string> = {},
  ): ApiResponse => ({
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...headers,
    },
    body: JSON.stringify(value),
  });
  return async (req: ApiRequest): Promise<ApiResponse> => {
    try {
      if (Buffer.byteLength(req.body ?? "") > 65536)
        throw new AccessError(413, "Payload too large");
      const url = new URL(req.path, "https://oracle.invalid"),
        s = options.snapshot;
      const json = () => {
        try {
          return JSON.parse(req.body ?? "{}");
        } catch {
          throw new AccessError(400, "Malformed JSON");
        }
      };
      if (req.method === "GET" && url.pathname === "/api/health")
        return send(200, {
          snapshotId: s.snapshotId,
          mode: s.mode,
          snapshotDigest: s.digest,
          count: s.count,
          addressCount: s.addressCount,
          ...(options.identity ?? compiledIdentity()),
          contractVersion: CONTRACT_VERSION,
          buildId:
            options.identity?.buildId ??
            options.buildId ??
            compiledIdentity().buildId,
          dataMode:
            s.mode === "synthetic"
              ? "synthetic"
              : (s.manifest as { protectedView?: boolean }).protectedView
                ? "protected-real"
                : "real-public",
          publicSnapshotId:
            (s.manifest as { publicSnapshotId?: string }).publicSnapshotId ??
            s.snapshotId,
          accessMode: options.local ? "local" : "review",
          engine: "DuckDB immutable snapshot",
          upstreamMcp: false,
        });
      if (req.method === "GET" && url.pathname === "/api/evidence") {
        if (url.search)
          throw new AccessError(400, "Evidence parameters are unsupported");
        return send(
          200,
          assessmentEvidence(options.identity ?? compiledIdentity(), {
            snapshotId: s.snapshotId,
            snapshotDigest: s.digest,
            publicSnapshotId:
              (s.manifest as { publicSnapshotId?: string }).publicSnapshotId ??
              s.snapshotId,
          }),
        );
      }
      // Local access is opt-in at the Node adapter and cannot be selected by request headers.
      let subject = "local-review";
      if (!options.local) {
        const access = await options.access();
        if (req.method === "POST" && url.pathname === "/api/session") {
          await options.quota.consume({
            subject: `auth:${createHash("sha256")
              .update(req.sourceIp ?? "unknown")
              .digest("hex")}`,
            category: "auth",
            limit: 10,
            windowSeconds: 900,
            nowMs: clock(),
          });
          const body = json() as Record<string, unknown>;
          if (
            !body ||
            Object.keys(body).length !== 1 ||
            typeof body.accessCode !== "string"
          )
            throw new AccessError(400, "Access code required");
          const issued = access.issue(body.accessCode);
          await options.sessions.put(issued.session);
          return send(
            200,
            { session: issued.session },
            { "Set-Cookie": sessionCookie(issued.token, access.ttl, true) },
          );
        }
        const session = access.verify(readSessionCookie(req.headers));
        const stored = await options.sessions.get(session.id);
        if (
          !stored ||
          stored.expiresAt !== session.expiresAt ||
          stored.expiresAt <= Math.floor(clock() / 1000)
        )
          throw new AccessError(401, "Session expired or revoked");
        subject = session.id;
        if (req.method === "GET" && url.pathname === "/api/session")
          return send(200, { session });
        if (req.method === "DELETE" && url.pathname === "/api/session") {
          await options.sessions.revoke(session.id);
          return send(
            200,
            { signedOut: true },
            { "Set-Cookie": clearSessionCookie(true) },
          );
        }
      } else if (url.pathname === "/api/session")
        return send(200, {
          session: {
            id: subject,
            workspaceId: "review",
            expiresAt: Math.floor(clock() / 1000) + 3600,
          },
          local: true,
        });
      await options.quota.consume({
        subject,
        category: "read",
        limit: 120,
        windowSeconds: 60,
        nowMs: clock(),
      });
      if (url.pathname === "/api/mcp") {
        const origin = req.headers.origin ?? req.headers.Origin;
        if (origin && !(options.mcpAllowedOrigins ?? []).includes(origin))
          throw new AccessError(403, "MCP origin rejected");
        const headers = Object.fromEntries(
          Object.entries(req.headers).filter(([, v]) => v !== undefined),
        ) as Record<string, string>;
        const response = await serveMcpFetch(
          s,
          new Request("https://oracle.invalid/api/mcp", {
            method: req.method,
            headers,
            ...(req.method === "POST" ? { body: req.body ?? "{}" } : {}),
          }),
        );
        return {
          statusCode: response.status,
          headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            ...Object.fromEntries(response.headers),
          },
          body: await response.text(),
        };
      }
      if (req.method === "POST" && url.pathname === "/api/search")
        return send(200, await s.search(QuerySchema.parse(json())));
      if (req.method === "GET" && url.pathname.startsWith("/api/properties/"))
        return send(
          200,
          await s.detail(
            decodeURIComponent(url.pathname.slice("/api/properties/".length)),
            url.searchParams.get("snapshotId") ?? "",
          ),
        );
      if (req.method === "GET" && url.pathname === "/api/source-context") {
        if (
          options.local ||
          !(s.manifest as { protectedView?: boolean }).protectedView
        )
          throw new AccessError(
            403,
            "Protected source context requires the hosted evaluator view",
          );
        const keys = [...url.searchParams.keys()];
        if (
          keys.some((k) => !["sourceId", "page"].includes(k)) ||
          new Set(keys).size !== keys.length
        )
          throw new AccessError(400, "Source metadata parameters rejected");
        const source = sourceContext(
          url.searchParams.get("sourceId") ?? "",
          url.searchParams.has("page")
            ? Number(url.searchParams.get("page"))
            : undefined,
        );
        if (!source)
          return send(404, {
            code: "INVALID_INPUT",
            message: "Source metadata unavailable",
          });
        return send(200, {
          version: "1",
          contractVersion: CONTRACT_VERSION,
          snapshotId: s.snapshotId,
          digest: s.digest,
          source,
        });
      }
      if (req.method === "GET" && url.pathname === "/api/runs")
        return send(200, s.runs);
      if (req.method === "GET" && url.pathname === "/api/coverage")
        return send(200, s.coverage);
      if (req.method === "GET" && url.pathname === "/api/manifest")
        return send(200, s.manifest);
      return send(404, { code: "INVALID_INPUT", message: "Route not found" });
    } catch (error) {
      if (error instanceof AccessError)
        return send(error.status, {
          code: error.status === 429 ? "RATE_LIMITED" : "NOT_AUTHORIZED",
          message: error.message,
        });
      if (error instanceof DomainError)
        return send(error.code === "SNAPSHOT_UNAVAILABLE" ? 409 : 400, {
          code: error.code,
          message: error.message,
        });
      // Never echo request, database, filesystem or provider exception details.
      return send(400, { code: "INVALID_INPUT", message: "Request rejected" });
    }
  };
}
