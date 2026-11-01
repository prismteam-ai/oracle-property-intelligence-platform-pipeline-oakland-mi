import { createActiveSnapshot } from "../packages/query/src/active.ts";
import { serveMcpStdio } from "../packages/mcp-adapter/src/server.ts";
const snapshot = await createActiveSnapshot();
const server = await serveMcpStdio(snapshot);
process.on("SIGTERM", () => {
  void server.close().finally(() => snapshot.close());
});
