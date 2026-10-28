import { expect, it, vi } from "vitest";
import { createApi } from "../apps/api/src/handler.ts";
import {
  AccessService,
  accessCodeDigest,
} from "../packages/hosted-runtime/src/access.ts";
import { MemoryQuotaStore } from "../packages/hosted-runtime/src/quota.ts";
import { MemorySessionStore } from "../packages/hosted-runtime/src/sessions.ts";
import { syntheticProperties } from "../packages/test-support/src/fixtures.ts";
const canary = "SYNTHETIC_PROTECTED_SOURCE_CANARY";
function fixture(protectedView: boolean, local: boolean) {
  const property = { ...syntheticProperties()[0]!, address: canary };
  const detail = vi.fn(async () => property);
  const access = vi.fn(
    async () =>
      new AccessService({
        signingKey: "s".repeat(64),
        reviewCodeDigest: accessCodeDigest("synthetic-local-review-code"),
        keyVersion: "synthetic",
      }),
  );
  return {
    detail,
    access,
    options: {
      local,
      snapshot: {
        snapshotId: "synthetic-boundary",
        mode: "real" as const,
        digest: "a".repeat(64),
        count: 1,
        manifest: { protectedView },
        coverage: [{ canary }],
        runs: [{ canary }],
        search: vi.fn(async () => {
          throw new Error("unused");
        }),
        detail,
        close() {},
      },
      access,
      quota: new MemoryQuotaStore(),
      sessions: new MemorySessionStore(),
    },
  };
}
it("rejects protected snapshots before any unauthenticated local route can be constructed", () => {
  const { options, detail, access } = fixture(true, true);
  expect(() => createApi(options)).toThrow(/protected.*local/i);
  expect(detail).not.toHaveBeenCalled();
  expect(access).not.toHaveBeenCalled();
});
it("preserves explicit public local development without requiring credentials", async () => {
  const { options, access } = fixture(false, true);
  const app = createApi(options);
  const result = await app({
    method: "GET",
    path: "/api/properties/synthetic?snapshotId=synthetic-boundary",
    headers: {},
  });
  expect(result.statusCode).toBe(200);
  expect(access).not.toHaveBeenCalled();
});
it("requires a stored signed session for protected detail and supports authenticated review", async () => {
  const { options, detail } = fixture(true, false);
  const app = createApi(options);
  for (const [method, path] of [
    ["GET", "/api/properties/synthetic?snapshotId=synthetic-boundary"],
    ["POST", "/api/search"],
    ["GET", "/api/coverage"],
    ["GET", "/api/runs"],
    ["GET", "/api/manifest"],
    ["POST", "/api/mcp"],
  ]) {
    const result = await app({
      method: method!,
      path: path!,
      headers: {},
      body: "{}",
    });
    expect(result.statusCode).toBe(401);
    expect(result.body).not.toContain(canary);
  }
  expect(detail).not.toHaveBeenCalled();
  const login = await app({
    method: "POST",
    path: "/api/session",
    headers: {},
    body: JSON.stringify({ accessCode: "synthetic-local-review-code" }),
  });
  const cookie = login.headers["Set-Cookie"]!.split(";")[0]!;
  const result = await app({
    method: "GET",
    path: "/api/properties/synthetic?snapshotId=synthetic-boundary",
    headers: { cookie },
  });
  expect(result.statusCode).toBe(200);
  expect(result.body).toContain(canary);
  expect(detail).toHaveBeenCalledTimes(1);
});
