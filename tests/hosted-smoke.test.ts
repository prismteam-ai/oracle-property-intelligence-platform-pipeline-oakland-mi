import { it, expect, vi } from "vitest";
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

it("reviewed29second client allowance completes a21second cold response while default remains10seconds", async () => {
  vi.useFakeTimers();
  const calls: string[] = [];
  const transport = async (input: URL | RequestInfo, init?: RequestInit) => {
    const route = new URL(String(input)).pathname;
    calls.push((init?.method ?? "GET") + route);
    if (route === "/api/health") {
      await new Promise((resolve) => setTimeout(resolve, 21000));
      return Response.json({ snapshotId: "synthetic-cold-timing" });
    }
    if (route === "/api/session" && init?.method === "POST")
      return new Response("{}", {
        headers: {
          "Set-Cookie": "prism_review=synthetic-timing; Secure; HttpOnly",
        },
      });
    return Response.json({});
  };
  try {
    const defaultResult = authenticatedSmoke(
      "https://fixture.invalid",
      "synthetic-timing-code",
      { transport: transport as typeof fetch },
    );
    const rejected = expect(defaultResult).rejects.toThrow("deadline");
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(calls).toEqual(["GET/api/health"]);
    vi.clearAllTimers();
    calls.length = 0;
    const reviewed = authenticatedSmoke(
      "https://fixture.invalid",
      "synthetic-timing-code",
      { transport: transport as typeof fetch, timeoutMs: 29000 },
    );
    await vi.advanceTimersByTimeAsync(21000);
    await expect(reviewed).resolves.toMatchObject({
      health: true,
      access: true,
      coverage: true,
      query: true,
      logout: true,
    });
    expect(calls).toEqual([
      "GET/api/health",
      "POST/api/session",
      "GET/api/coverage",
      "POST/api/search",
      "DELETE/api/session",
    ]);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});
