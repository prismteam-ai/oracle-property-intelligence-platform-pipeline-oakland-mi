import { MemorySessionStore } from "../../../packages/hosted-runtime/src/sessions.ts";
import http from "node:http";
import { createActiveSnapshot } from "../../../packages/query/src/active.ts";
import { AccessService } from "../../../packages/hosted-runtime/src/access.ts";
import { MemoryQuotaStore } from "../../../packages/hosted-runtime/src/quota.ts";
import { createApi } from "./handler.ts";
const local = process.env.PRISM_ACCESS_MODE === "local";
if (
  local &&
  (process.env.PRISM_OWNER_DERIVATIVES || process.env.PRISM_PRIVATE_ENRICHMENT)
)
  throw new Error("Protected derivatives require authenticated review access");
const snapshot = await createActiveSnapshot();
if (process.env.AWS_LAMBDA_FUNCTION_NAME)
  throw new Error("Use the Lambda entry point in Lambda");
const handler = createApi({
  snapshot,
  local,
  quota: new MemoryQuotaStore(),
  sessions: new MemorySessionStore(),
  access: async () =>
    new AccessService({
      signingKey: process.env.PRISM_SIGNING_KEY ?? "",
      reviewCodeDigest: process.env.PRISM_REVIEW_CODE_DIGEST ?? "",
      keyVersion: process.env.PRISM_KEY_VERSION ?? "v1",
    }),
  buildId: process.env.PRISM_BUILD_ID,
});
const server = http.createServer(async (req, res) => {
  let body: string;
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of req) {
      const data = Buffer.from(chunk as Uint8Array);
      bytes += data.length;
      chunks.push(data);
      if (bytes > 65536) {
        res.writeHead(413);
        res.end();
        return;
      }
    }
    body = Buffer.concat(chunks).toString("utf8");
    const out = await handler({
      method: req.method ?? "GET",
      path: req.url ?? "/",
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [
          k,
          Array.isArray(v) ? v.join(";") : v,
        ]),
      ),
      body,
      sourceIp: req.socket.remoteAddress,
    });
    res.writeHead(out.statusCode, out.headers);
    res.end(out.body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ code: "INVALID_INPUT", message: "Request rejected" }),
    );
  }
});
server.listen(Number(process.env.PORT ?? 4310), "127.0.0.1", () =>
  console.log(
    `Oracle API ready: ${snapshot.mode} snapshot ${snapshot.snapshotId}; ${local ? "explicit local access" : "review access required"}`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () =>
    server.close(() => {
      snapshot.close();
      process.exit(0);
    }),
  );
