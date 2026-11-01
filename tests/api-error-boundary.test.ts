import { afterEach, expect, it, vi } from "vitest";
import { DomainError, QuerySchema } from "../packages/contracts/src/index.ts";
import { AccessError } from "../packages/hosted-runtime/src/access.ts";
import { telemetry } from "../packages/hosted-runtime/src/observability.ts";
import { classifyApiError } from "../packages/hosted-runtime/src/api-errors.ts";
import { DynamoQuotaStore } from "../packages/hosted-runtime/src/quota.ts";
import { createApi } from "../apps/api/src/handler.ts";
import { MemorySessionStore } from "../packages/hosted-runtime/src/sessions.ts";
const canary = "PRIVATE-SQL-TOKEN-PATH-DO-NOT-ECHO";
const query = QuerySchema.parse({
  snapshotId: "synthetic-boundary",
  lat: 42.66,
  lng: -83.29,
  radiusMeters: 8046.72,
});
afterEach(() => vi.restoreAllMocks());
function fixture(error?: Error, quota?: () => Promise<unknown>) {
  return createApi({
    local: true,
    sessions: new MemorySessionStore(),
    access: async () => {
      throw Error("No access expected");
    },
    quota: {
      consume: async () => {
        await quota?.();
        return { remaining: 9, resetAt: 60 };
      },
    },
    snapshot: {
      snapshotId: query.snapshotId,
      mode: "synthetic",
      digest: "test",
      count: 0,
      manifest: {},
      coverage: [],
      runs: [],
      close() {},
      search: async () => {
        if (error) throw error;
        return {} as never;
      },
      detail: async () => {
        throw Error("No detail dispatch expected");
      },
    },
  });
}
const invoke = (
  app: ReturnType<typeof fixture>,
  method: string,
  path: string,
  body?: unknown,
) =>
  app({
    method,
    path,
    headers: {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
function observation() {
  const warn = vi.spyOn(telemetry.logger, "warn").mockImplementation(() => {});
  vi.spyOn(telemetry.logger, "info").mockImplementation(() => {});
  vi.spyOn(telemetry.metrics, "publishStoredMetrics").mockImplementation(
    () => telemetry.metrics,
  );
  vi.spyOn(telemetry.metrics, "captureColdStartMetric").mockImplementation(
    () => {},
  );
  const add = vi.spyOn(telemetry.metrics, "addMetric");
  return { warn, add };
}
it("keeps schema and malformed path validation at400 without application failure metrics", async () => {
  const { add } = observation();
  for (const [method, path, body] of [
    ["POST", "/api/search", {}],
    ["GET", "/api/properties/%ZZ?snapshotId=synthetic-boundary", undefined],
  ] as const) {
    const out = await telemetry.observe("query", () =>
      invoke(fixture(), method, path, body),
    );
    expect(out.statusCode).toBe(400);
    expect(JSON.parse(out.body).code).toBe("INVALID_INPUT");
  }
  expect(
    add.mock.calls.filter(([name]) => name === "RequestError"),
  ).toHaveLength(0);
});
it("preserves known auth, conflict, domain and quota rejections", async () => {
  observation();
  for (const [error, status] of [
    [new AccessError(401, "Sign in"), 401],
    [new AccessError(403, "Denied"), 403],
    [new AccessError(404, "Missing"), 404],
    [new AccessError(429, "Quota"), 429],
    [new DomainError("COST_LIMIT_REACHED", "Model limit"), 429],
    [new DomainError("CONFLICT", "Version changed"), 409],
  ] as const) {
    expect(classifyApiError(error).status).toBe(status);
  }
  const out = await invoke(
    fixture(new AccessError(429, "Quota")),
    "POST",
    "/api/search",
    query,
  );
  expect(out.statusCode).toBe(429);
});
it("returns safe500 for unexpected query, storage, quota-store and programming exceptions and emits RequestError", async () => {
  const { warn, add } = observation();
  for (const error of [
    new Error(canary),
    new TypeError(canary),
    new SyntaxError(canary),
  ]) {
    const out = await telemetry.observe("query", () =>
      invoke(fixture(error), "POST", "/api/search", query),
    );
    expect(out.statusCode).toBe(500);
    expect(JSON.parse(out.body)).toEqual({
      code: "INTERNAL_ERROR",
      message: "Request could not be completed",
    });
    expect(out.body).not.toContain(canary);
  }
  const store = new DynamoQuotaStore(
    {
      send: async () => {
        throw new Error(canary);
      },
    } as never,
    "test",
  );
  const storage = await telemetry.observe("query", () =>
    invoke(
      fixture(undefined, () =>
        store.consume({
          subject: "test",
          category: "read",
          limit: 10,
          windowSeconds: 60,
          nowMs: 0,
        }),
      ),
      "POST",
      "/api/search",
      query,
    ),
  );
  expect(storage.statusCode).toBe(500);
  expect(
    add.mock.calls.filter(([name]) => name === "RequestError"),
  ).toHaveLength(4);
  expect(
    warn.mock.calls.every(
      ([, detail]) =>
        (detail as { classification: string }).classification ===
        "INTERNAL_ERROR",
    ),
  ).toBe(true);
  expect(JSON.stringify(warn.mock.calls)).not.toContain(canary);
});
it("returns safe503 for recognized dependency failures with original redacted diagnostics and5xx metrics", async () => {
  const { warn, add } = observation();
  const error = Object.assign(new Error(canary), {
    name: "ServiceUnavailableException",
    code: "ETIMEDOUT",
    $metadata: { httpStatusCode: 503, requestId: canary },
    cause: { token: canary },
  });
  const store = new DynamoQuotaStore(
    {
      send: async () => {
        throw error;
      },
    } as never,
    "test",
  );
  for (const app of [
    fixture(error),
    fixture(undefined, () =>
      store.consume({
        subject: "test",
        category: "read",
        limit: 10,
        windowSeconds: 60,
        nowMs: 0,
      }),
    ),
  ]) {
    const out = await telemetry.observe("query", () =>
      invoke(app, "POST", "/api/search", query),
    );
    expect(out.statusCode).toBe(503);
    expect(JSON.parse(out.body).code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(out.body).not.toContain(canary);
  }
  expect(warn).toHaveBeenCalledWith("api_request_failed", {
    classification: "DEPENDENCY_UNAVAILABLE",
    stage: "application",
    errorName: "ServiceUnavailableException",
    networkCode: "ETIMEDOUT",
    httpStatus: 503,
  });
  expect(JSON.stringify(warn.mock.calls)).not.toContain(canary);
  expect(
    add.mock.calls.filter(([name]) => name === "RequestError"),
  ).toHaveLength(2);
});
