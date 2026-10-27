import { it, expect } from "vitest";
import { createApi, type ActiveSnapshot } from "../apps/api/src/handler.ts";
import {
  AccessService,
  accessCodeDigest,
} from "../packages/hosted-runtime/src/access.ts";
import { MemorySessionStore } from "../packages/hosted-runtime/src/sessions.ts";
import { MemoryQuotaStore } from "../packages/hosted-runtime/src/quota.ts";
it("gates data, binds immutable snapshot, revokes logout, bounds malformed requests", async () => {
  let searches = 0;
  const snapshot = {
    snapshotId: "fixture",
    mode: "synthetic",
    digest: "a".repeat(64),
    count: 1,
    search: async () => {
      searches++;
      return { snapshotId: "fixture" };
    },
    detail: async () => ({}),
    coverage: [],
    runs: [],
    manifest: {},
    close() {},
  } as unknown as ActiveSnapshot;
  const api = createApi({
    snapshot,
    access: async () =>
      new AccessService({
        signingKey: "x".repeat(40),
        reviewCodeDigest: accessCodeDigest("test-fixture-code"),
        keyVersion: "v1",
      }),
    quota: new MemoryQuotaStore(),
    sessions: new MemorySessionStore(),
  });
  const request = { method: "GET", path: "/api/health", headers: {} };
  expect((await api(request)).statusCode).toBe(200);
  expect((await api({ ...request, path: "/api/runs" })).statusCode).toBe(401);
  const issued = await api({
    ...request,
    method: "POST",
    path: "/api/session",
    body: JSON.stringify({ accessCode: "test-fixture-code" }),
  });
  expect(issued.statusCode).toBe(200);
  const cookie = issued.headers["Set-Cookie"]!.split(";")[0]!;
  const authorized = { ...request, headers: { cookie } };
  expect((await api({ ...authorized, path: "/api/runs" })).statusCode).toBe(
    200,
  );
  expect(
    (
      await api({
        ...authorized,
        method: "POST",
        path: "/api/search",
        body: JSON.stringify({
          snapshotId: "fixture",
          lat: 42,
          lng: -83,
          radiusMeters: 1,
          sql: "drop table",
        }),
      })
    ).statusCode,
  ).toBe(400);
  expect(searches).toBe(0);
  expect(
    (await api({ ...authorized, method: "DELETE", path: "/api/session" }))
      .statusCode,
  ).toBe(200);
  expect((await api({ ...authorized, path: "/api/runs" })).statusCode).toBe(
    401,
  );
  expect((await api({ ...request, body: "a".repeat(65537) })).statusCode).toBe(
    413,
  );
});
