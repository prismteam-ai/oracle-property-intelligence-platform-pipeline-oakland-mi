/** Only the operator script may supply a reviewed HTTPS origin; tests inject loopback fixtures. */
export async function authenticatedSmoke(
  base: string,
  code: string,
  options: { transport?: typeof fetch; timeoutMs?: number } = {},
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
    h = JSON.parse(health.text) as { snapshotId?: unknown };
  if (typeof h.snapshotId !== "string" || !h.snapshotId)
    throw new Error("Snapshot health identity missing");
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
  await request("/api/session", { method: "DELETE", headers: { cookie } });
  return {
    health: true,
    access: true,
    coverage: true,
    query: true,
    logout: true,
  };
}
