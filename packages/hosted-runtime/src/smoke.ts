/** Only the operator script may supply a reviewed HTTPS origin; tests inject loopback fixtures. */
export async function authenticatedSmoke(
  base: string,
  code: string,
  options: {
    transport?: typeof fetch;
    timeoutMs?: number;
    mcp?: boolean;
    expectedHealth?: Record<string, string>;
  } = {},
) {
  const transport = options.transport ?? fetch,
    timeout = options.timeoutMs ?? 10000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30000)
    throw new Error("Invalid smoke deadline");
  async function request(route: string, init: RequestInit = {}) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await transport(new URL(route, base), {
            ...init,
            redirect: "error",
            signal: controller.signal,
          });
          if (
            response.redirected ||
            (response.status >= 300 && response.status < 400)
          )
            throw new Error("Smoke redirects are forbidden");
          if (!response.ok) throw new Error(`Smoke ${route} failed`);
          const text = await response.text();
          if (Buffer.byteLength(text) > 4000000)
            throw new Error("Smoke response exceeds byte limit");
          return { response, text };
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Smoke deadline exceeded"));
          }, timeout);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const health = await request("/api/health"),
    h = JSON.parse(health.text) as Record<string, unknown>;
  if (typeof h.snapshotId !== "string" || !h.snapshotId)
    throw new Error("Snapshot health identity missing");
  for (const [key, value] of Object.entries(options.expectedHealth ?? {}))
    if (h[key] !== value)
      throw new Error(`Hosted health ${key} differs from pinned release`);
  const login = await request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessCode: code }),
  });
  const cookie = login.response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie || !cookie.startsWith("prism_review="))
    throw new Error("Session cookie missing");
  await request("/api/coverage", { headers: { cookie } });
  await request("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      snapshotId: h.snapshotId,
      lat: 42.66,
      lng: -83.29,
      radiusMeters: 1609.344,
      includeUnknown: true,
      limit: 1,
    }),
  });
  if (options.mcp) {
    const rpc = async (
      id: number,
      method: string,
      params: Record<string, unknown>,
    ) => {
      const r = await request("/api/mcp", {
        method: "POST",
        headers: {
          cookie,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      const message = JSON.parse(r.text) as {
        id?: number;
        error?: unknown;
        result?: Record<string, unknown>;
      };
      if (message.id !== id || message.error || !message.result)
        throw new Error("MCP protocol smoke failed");
      return message.result;
    };
    const initialized = await rpc(1, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "prism-p3-bounded-smoke", version: "1" },
    });
    if (!initialized.protocolVersion)
      throw new Error("MCP initialization missing");
    const listed = await rpc(2, "tools/list", {}),
      tools = listed.tools as { name: string }[];
    if (
      !Array.isArray(tools) ||
      JSON.stringify(tools.map((t) => t.name).sort()) !==
        JSON.stringify([
          "property_evidence",
          "search_properties",
          "snapshot_status",
        ])
    )
      throw new Error("MCP bounded tool list changed");
    const called = await rpc(3, "tools/call", {
        name: "snapshot_status",
        arguments: { snapshotId: h.snapshotId },
      }),
      status = called.structuredContent as Record<string, unknown>;
    if (
      called.isError ||
      status?.snapshotId !== h.snapshotId ||
      status?.digest !== h.snapshotDigest
    )
      throw new Error("MCP snapshot proof differs from health");
    const searched = await rpc(4, "tools/call", {
        name: "search_properties",
        arguments: {
          snapshotId: h.snapshotId,
          lat: 42.66,
          lng: -83.29,
          radiusMeters: 1609.344,
          includeUnknown: true,
          limit: 1,
        },
      }),
      evidence = searched.structuredContent as {
        snapshotId?: string;
        rows?: unknown[];
        queryHash?: string;
      };
    if (
      searched.isError ||
      evidence?.snapshotId !== h.snapshotId ||
      !Array.isArray(evidence.rows) ||
      evidence.rows.length > 1 ||
      !/^[a-f0-9]{64}$/.test(evidence.queryHash ?? "")
    )
      throw new Error("MCP bounded search proof failed");
  }
  await request("/api/session", { method: "DELETE", headers: { cookie } });
  return {
    health: true,
    access: true,
    coverage: true,
    query: true,
    logout: true,
    mcp: options.mcp ? true : "not_requested",
    identity: {
      head: h.head,
      tree: h.tree,
      buildId: h.buildId,
      contractVersion: h.contractVersion,
      contractSha256: h.contractSha256,
      stage: h.stage,
      region: h.region,
      snapshotId: h.snapshotId,
      snapshotDigest: h.snapshotDigest,
      dataMode: h.dataMode,
    },
  };
}
