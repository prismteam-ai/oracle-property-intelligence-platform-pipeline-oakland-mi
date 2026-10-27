import { expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import http from "node:http";
import {
  createMcpServer,
  createMcpHttpHandler,
} from "../packages/mcp-adapter/src/server.ts";
import { SnapshotReader } from "../packages/query/src/index.ts";
import {
  syntheticProperties,
  SNAPSHOT_ID,
} from "../packages/test-support/src/fixtures.ts";
import { CONTRACT_VERSION } from "../packages/contracts/src/index.ts";
const reference = new SnapshotReader(SNAPSHOT_ID, syntheticProperties());
const snapshot = {
  snapshotId: SNAPSHOT_ID,
  mode: "synthetic" as const,
  digest: "test-fixture-digest",
  count: 48,
  search: async (input: unknown) => reference.search(input),
  detail: async (id: string, s: string) => reference.detail(id, s),
};
test("official MCP initialization, discovery, strict bounded calls and no prohibited capabilities", async () => {
  const server = createMcpServer(snapshot);
  const client = new Client({
    name: "prism-protocol-test",
    version: CONTRACT_VERSION,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual([
      "property_evidence",
      "search_properties",
      "snapshot_status",
    ]);
    expect(list.tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    const status = await client.callTool({
      name: "snapshot_status",
      arguments: { snapshotId: SNAPSHOT_ID },
    });
    expect(status.isError).not.toBe(true);
    expect(status.structuredContent).toMatchObject({
      snapshotId: SNAPSHOT_ID,
      mode: "synthetic",
      count: 48,
    });
    const good = await client.callTool({
      name: "search_properties",
      arguments: {
        snapshotId: SNAPSHOT_ID,
        lat: 42.66,
        lng: -83.29,
        radiusMeters: 8000,
      },
    });
    expect(good.isError).not.toBe(true);
    expect(good.structuredContent).toMatchObject({ snapshotId: SNAPSHOT_ID });
    const drift = await client.callTool({
      name: "snapshot_status",
      arguments: { snapshotId: "other" },
    });
    expect(drift.isError).toBe(true);
    for (const input of [
      { lat: 999 },
      { radiusMeters: 1e9 },
      { sql: "INSTALL httpfs" },
      { url: "https://example.invalid" },
    ]) {
      const bad = await client.callTool({
        name: "search_properties",
        arguments: {
          snapshotId: SNAPSHOT_ID,
          lat: 42.66,
          lng: -83.29,
          radiusMeters: 8000,
          ...input,
        },
      });
      expect(bad.isError).toBe(true);
    }
    const unsupported = await client.callTool({
      name: "execute_sql",
      arguments: { sql: "SELECT 1" },
    });
    expect(unsupported.isError).toBe(true);
    expect(server.server.getClientCapabilities()).not.toHaveProperty(
      "sampling",
    );
  } finally {
    await client.close();
    await server.close();
  }
});
test("authenticated Streamable HTTP transports initialization and tools locally", async () => {
  const handler = createMcpHttpHandler(snapshot, {
    authorize: async (req) =>
      req.headers.authorization === "Bearer test-only-mcp-session",
    allowedOrigins: [],
  });
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing local address");
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
  const client = new Client({ name: "http-test", version: CONTRACT_VERSION });
  try {
    expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(401);
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: {
            Authorization: "Bearer test-only-mcp-session",
            Origin: "https://unapproved.invalid",
          },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: { Authorization: "Bearer test-only-mcp-session" },
        },
      }),
    );
    expect((await client.listTools()).tools).toHaveLength(3);
    const response = await client.callTool({
      name: "property_evidence",
      arguments: { id: "SYN-0001", snapshotId: SNAPSHOT_ID },
    });
    expect(response.structuredContent).toMatchObject({ id: "SYN-0001" });
  } finally {
    await client.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("official SDK stdio transport initializes a separate fixture-only child process", async () => {
  const { StdioClientTransport } =
    await import("@modelcontextprotocol/sdk/client/stdio.js");
  const { mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(os.tmpdir(), "prism-mcp-stdio-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", path.resolve("scripts/mcp-stdio.ts")],
    env: {
      PATH: process.env.PATH ?? "",
      PRISM_DATA_MODE: "synthetic",
      PRISM_FIXTURE_RUN_DIR: dir,
    },
    stderr: "pipe",
  });
  const client = new Client({
    name: "stdio-protocol-test",
    version: CONTRACT_VERSION,
  });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools).toHaveLength(3);
    const response = await client.callTool({
      name: "snapshot_status",
      arguments: { snapshotId: SNAPSHOT_ID },
    });
    expect(response.structuredContent).toMatchObject({
      mode: "synthetic",
      count: 48,
      snapshotId: SNAPSHOT_ID,
    });
  } finally {
    await client.close();
  }
});
