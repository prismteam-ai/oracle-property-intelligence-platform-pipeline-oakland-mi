import { it, expect } from "vitest";
import { CONTRACT_VERSION } from "../packages/contracts/src/index.ts";
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
    manifest: { protectedView: true },
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
  const health = await api(request);
  expect(health.statusCode).toBe(200);
  expect(JSON.parse(health.body)).toMatchObject({
    region: "us-east-1",
    stage: "local",
    contractVersion: CONTRACT_VERSION,
    dataMode: "synthetic",
  });
  expect(
    (
      await api({
        ...request,
        path: "/api/source-context?sourceId=official-novi-residential-sales-pdf",
      })
    ).statusCode,
  ).toBe(401);
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
  const context = await api({
    ...authorized,
    path: "/api/source-context?sourceId=official-novi-residential-sales-pdf&page=2",
  });
  expect(context.statusCode).toBe(200);
  expect(context.headers["Cache-Control"]).toBe("no-store");
  expect(JSON.parse(context.body)).toMatchObject({
    version: "1",
    contractVersion: CONTRACT_VERSION,
    snapshotId: "fixture",
    source: {
      declaredReportPeriod: null,
      semanticBasis: "building_year_proxy",
      page: 2,
      pageUrl:
        "https://www.cityofnovi.org/media/w1efyceh/residential-non-condo-401-sales.pdf#page=2",
      partialHistory: true,
      yearBuiltIsRoofAge: false,
      tenYearTenureInference: false,
    },
  });
  expect(JSON.parse(context.body).source).not.toHaveProperty("observations");
  for (const suffix of [
    "page=19",
    "page=2.5",
    "sql=SELECT1",
    "sourceId=unknown",
  ]) {
    const path = suffix.startsWith("sourceId")
      ? `/api/source-context?${suffix}`
      : `/api/source-context?sourceId=official-novi-residential-sales-pdf&${suffix}`;
    expect(
      (await api({ ...authorized, path })).statusCode,
    ).toBeGreaterThanOrEqual(400);
  }
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
