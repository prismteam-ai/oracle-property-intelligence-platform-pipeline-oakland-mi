import { authenticatedSmoke } from "../packages/hosted-runtime/src/smoke.ts";
import { it, expect } from "vitest";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApi } from "../apps/api/src/handler.ts";
import { SnapshotReader } from "../packages/query/src/index.ts";
import {
  syntheticProperties,
  SNAPSHOT_ID,
} from "../packages/test-support/src/fixtures.ts";
import {
  AccessService,
  accessCodeDigest,
} from "../packages/hosted-runtime/src/access.ts";
import { MemoryQuotaStore } from "../packages/hosted-runtime/src/quota.ts";
import { MemorySessionStore } from "../packages/hosted-runtime/src/sessions.ts";
it("exposes authenticated, bounded official SDK MCP through the actual HTTP route", async () => {
  const reader = new SnapshotReader(SNAPSHOT_ID, syntheticProperties()),
    access = new AccessService({
      signingKey: "x".repeat(40),
      reviewCodeDigest: accessCodeDigest("synthetic-only-review"),
      keyVersion: "test",
    });
  const api = createApi({
    snapshot: {
      snapshotId: SNAPSHOT_ID,
      mode: "synthetic",
      digest: "a".repeat(64),
      count: 48,
      search: async (q) => reader.search(q),
      detail: async (id, s) => reader.detail(id, s),
      coverage: [],
      runs: [],
      manifest: {},
      close() {},
    },
    access: async () => access,
    quota: new MemoryQuotaStore(),
    sessions: new MemorySessionStore(),
  });
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += String(chunk);
    const out = await api({
      method: req.method ?? "GET",
      path: req.url ?? "/",
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [
          k,
          Array.isArray(v) ? v.join(";") : v,
        ]),
      ),
      body,
    });
    res.writeHead(out.statusCode, out.headers);
    res.end(out.body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number },
    base = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: "hosted-route-test", version: "0.2.1" });
  try {
    expect(
      (await fetch(base + "/api/mcp", { method: "POST", body: "{}" })).status,
    ).toBe(401);
    const session = await fetch(base + "/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: "synthetic-only-review" }),
      }),
      cookie = session.headers.get("set-cookie")!.split(";")[0]!;
    expect(
      (
        await fetch(base + "/api/mcp", {
          method: "POST",
          headers: { cookie, Origin: "https://unapproved.invalid" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + "/api/mcp"), {
        requestInit: { headers: { cookie } },
      }),
    );
    expect((await client.listTools()).tools).toHaveLength(3);
    const status = await client.callTool({
      name: "snapshot_status",
      arguments: { snapshotId: SNAPSHOT_ID },
    });
    expect(status.isError).not.toBe(true);
    expect(status.structuredContent).toMatchObject({
      snapshotId: SNAPSHOT_ID,
      count: 48,
    });
    expect(
      (
        await client.callTool({
          name: "search_properties",
          arguments: {
            snapshotId: SNAPSHOT_ID,
            lat: 42.66,
            lng: -83.29,
            radiusMeters: 5000,
            limit: 51,
          },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await client.callTool({
          name: "execute_sql",
          arguments: { sql: "SELECT 1" },
        })
      ).isError,
    ).toBe(true);
    expect(
      await authenticatedSmoke(base, "synthetic-only-review", { mcp: true }),
    ).toMatchObject({ mcp: true, query: true, logout: true });
    await fetch(base + "/api/session", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(
      (
        await fetch(base + "/api/mcp", {
          method: "POST",
          headers: { cookie },
          body: "{}",
        })
      ).status,
    ).toBe(401);
  } finally {
    await client.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
