import { performance } from "node:perf_hooks";
const start = performance.now();
const { DuckDBInstance } = await import("@duckdb/node-api");
const instance = await DuckDBInstance.create(":memory:", {
  threads: "2",
  memory_limit: "1GB",
});
const db = await instance.connect();
const loadStart = performance.now();
await db.run("CREATE TABLE corpus AS SELECT * FROM read_parquet($1)", [
  process.argv[2]!,
]);
const loadMs = performance.now() - loadStart;
const queryStart = performance.now();
const r = await db.run(
  "SELECT id,open_days FROM corpus WHERE roof_age>15 AND permit_kind!='other' AND permit_status='open' AND open_days>=1825 ORDER BY open_days DESC,id LIMIT 200",
);
const rows = (await r.getRowObjectsJson()).length;
console.log(
  JSON.stringify({
    loadMs,
    queryMs: performance.now() - queryStart,
    rows,
    rssBytes: process.memoryUsage().rss,
    startupToQueryMs: performance.now() - start,
  }),
);
db.closeSync();
instance.closeSync();
