import { it, expect } from "vitest";
import http from "node:http";
import { authenticatedSmoke } from "../packages/hosted-runtime/src/smoke.ts";
it("never follows an access-code redirect to another origin", async () => {
  let foreign = 0;
  const target = http.createServer((_q, r) => {
    foreign++;
    r.end("unexpected");
  });
  await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
  const a = target.address() as { port: number };
  const source = http.createServer((q, r) => {
    if (q.url === "/api/health") {
      r.setHeader("Content-Type", "application/json");
      r.end(JSON.stringify({ snapshotId: "synthetic-test" }));
    } else {
      r.writeHead(307, { Location: `http://127.0.0.1:${a.port}/foreign` });
      r.end();
    }
  });
  await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
  const b = source.address() as { port: number };
  try {
    await expect(
      authenticatedSmoke(`http://127.0.0.1:${b.port}`, "fixture-only-code"),
    ).rejects.toThrow();
    expect(foreign).toBe(0);
  } finally {
    await Promise.all([
      new Promise<void>((r) => source.close(() => r())),
      new Promise<void>((r) => target.close(() => r())),
    ]);
  }
});
it("requires successful logout and bounds even non-cooperative transports", async () => {
  const calls: RequestInit[] = [];
  const transport = async (input: URL | RequestInfo, init?: RequestInit) => {
    calls.push(init!);
    const u = new URL(String(input));
    if (u.pathname === "/api/health")
      return Response.json({ snapshotId: "fixture" });
    if (init?.method === "DELETE")
      return new Response("failed", { status: 500 });
    if (u.pathname === "/api/session")
      return new Response("{}", {
        headers: {
          "Set-Cookie": "prism_review=fixture-token; Secure; HttpOnly",
        },
      });
    return Response.json({});
  };
  await expect(
    authenticatedSmoke("https://fixture.invalid", "fixture-only-code", {
      transport: transport as typeof fetch,
    }),
  ).rejects.toThrow("/api/session failed");
  expect(calls.every((c) => c.redirect === "error" && c.signal)).toBe(true);
  await expect(
    authenticatedSmoke("https://fixture.invalid", "fixture-only-code", {
      transport: async () => new Promise(() => {}),
      timeoutMs: 10,
    }),
  ).rejects.toThrow("deadline");
});
