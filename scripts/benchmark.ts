import { createRequire } from "node:module";
import { DuckDBInstance } from "@duckdb/node-api";
import { mkdtemp, stat, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
const output = process.argv[2] ?? "data/benchmark-results.json";
await mkdir(path.dirname(output), { recursive: true });
const dir = await mkdtemp(path.join(tmpdir(), "prism-benchmark-"));
const schema = `id BIGINT,lat DOUBLE,lng DOUBLE,roof_age INTEGER,roof_confidence INTEGER,permit_status VARCHAR,permit_kind VARCHAR,open_days INTEGER,last_transfer_date DATE,ownership_coverage VARCHAR,contractor_id VARCHAR,license_id VARCHAR,rating DOUBLE,source_digest VARCHAR,record_kind VARCHAR`;
const distance = `12742017.6*asin(sqrt(least(1.0,pow(sin(radians(lat-42.66)/2),2)+cos(radians(42.66))*cos(radians(lat))*pow(sin(radians(lng+83.29)/2),2))))`;
const queries = {
  radius: `SELECT id,${distance} AS distance FROM corpus WHERE lat IS NOT NULL AND ${distance}<=8046.72 ORDER BY distance,id LIMIT 200`,
  roof: `SELECT id,roof_age FROM corpus WHERE roof_age>15 ORDER BY roof_age DESC,id LIMIT 200`,
  permit: `SELECT id,open_days,contractor_id,license_id,rating FROM corpus WHERE permit_kind!='other' AND permit_status='open' AND open_days>=1825 ORDER BY open_days DESC,id LIMIT 200`,
  detail: "SELECT * FROM corpus WHERE id=4242",
  combined: `SELECT id,roof_age,open_days FROM corpus WHERE lat IS NOT NULL AND roof_age>15 AND permit_kind!='other' AND permit_status='open' AND open_days>=1825 AND ${distance}<=8046.72 ORDER BY open_days DESC,id LIMIT 200`,
  ownership:
    "SELECT id,last_transfer_date,ownership_coverage FROM corpus WHERE ownership_coverage='full' AND last_transfer_date<DATE '2016-10-26' ORDER BY id LIMIT 200",
};
async function sumFiles(root: string): Promise<number> {
  let n = 0;
  for (const e of await readdir(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) n += await sumFiles(p);
    else n += (await stat(p)).size;
  }
  return n;
}
const results = [];
for (const count of [10000, 100000, 500000]) {
  const started = performance.now();
  const instance = await DuckDBInstance.create(":memory:", {
    threads: "2",
    memory_limit: "1GB",
  });
  const db = await instance.connect();
  await db.run(`CREATE TABLE corpus (${schema})`);
  await db.run(
    `INSERT INTO corpus SELECT i,CASE WHEN i%97=0 THEN NULL ELSE 42.4+(i%1000)*0.0005 END,-83.65+((i*37)%1000)*0.0008,CASE WHEN i%11=0 THEN NULL ELSE i%45 END,i%4,CASE WHEN i%3=0 THEN 'closed' ELSE 'open' END,CASE WHEN i%7=0 THEN 'other' ELSE 'roof_replacement' END,CASE WHEN i%13=0 THEN NULL ELSE i%5000 END,CASE WHEN i%5=0 THEN DATE '2010-05-01' ELSE NULL END,CASE WHEN i%5=0 THEN 'full' ELSE 'unknown' END,CASE WHEN i%4=0 THEN 'SYN-COMPANY-'||(i%500) ELSE NULL END,CASE WHEN i%4=0 THEN 'SYN-LICENSE-'||(i%500) ELSE NULL END,CASE WHEN i%8=0 THEN 90 ELSE NULL END,md5('synthetic-'||i),'synthetic' FROM range(${count}) t(i)`,
  );
  const generateMs = performance.now() - started;
  const parquet = path.join(dir, `projection-${count}.parquet`);
  await db.run(`COPY corpus TO '${parquet}' (FORMAT PARQUET,COMPRESSION ZSTD)`);
  const parquetBytes = (await stat(parquet)).size;
  const timings: Record<
    string,
    {
      coldMs: number;
      warmMedianMs: number;
      warmP95Ms: number;
      returnedRows: number;
      repeats: number;
    }
  > = {};
  for (const [name, sql] of Object.entries(queries)) {
    const times: number[] = [];
    let rows = 0;
    for (let repeat = 0; repeat < 8; repeat++) {
      const start = performance.now();
      const r = await db.run(sql);
      rows = (await r.getRowObjectsJson()).length;
      times.push(performance.now() - start);
    }
    const sorted = times.slice(1).sort((a, b) => a - b);
    timings[name] = {
      coldMs: times[0]!,
      warmMedianMs: sorted[Math.floor(sorted.length / 2)]!,
      warmP95Ms: sorted.at(-1)!,
      returnedRows: rows,
      repeats: 8,
    };
  }
  const exactCount = Number(
    (
      await (
        await db.run("SELECT count(*) AS count FROM corpus")
      ).getRowObjectsJson()
    )[0]!.count,
  );
  const memory = process.memoryUsage();
  db.closeSync();
  instance.closeSync();
  const wallStart = performance.now();
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/benchmark-worker.ts", parquet],
    {
      encoding: "utf8",
      env: { ...process.env, PRISM_NO_NETWORK: "1" },
      timeout: 60000,
    },
  );
  if (child.status !== 0) throw new Error(child.stderr);
  const fresh = JSON.parse(child.stdout) as {
    loadMs: number;
    queryMs: number;
    rows: number;
    rssBytes: number;
    startupToQueryMs: number;
  };
  results.push({
    count,
    exactCount,
    generateMs,
    parquetBytes,
    processRssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    freshProcess: { ...fresh, wallMs: performance.now() - wallStart },
    queries: timings,
  });
  console.log(
    JSON.stringify({
      count,
      parquetBytes,
      coldProcessMs: fresh.startupToQueryMs,
      queries: timings,
    }),
  );
}
const apiRequire = createRequire(import.meta.url);
const fromApi = createRequire(apiRequire.resolve("@duckdb/node-api"));
const fromBindings = createRequire(fromApi.resolve("@duckdb/node-bindings"));
const nativePath = path.dirname(
  fromBindings.resolve(
    `@duckdb/node-bindings-${process.platform}-${process.arch}/duckdb.node`,
  ),
);
const nativeBytes = await sumFiles(nativePath);
const result = {
  kind: "local-synthetic-search-projection",
  networkUsed: false,
  node: process.version,
  duckdb: "2.0.0-r.1",
  projectionSchema: schema,
  queryDefinitions: queries,
  results,
  nativeBindingPackageBytes: nativeBytes,
  limit: 200,
  geometry: "synthetic WGS84 point population including nulls",
  comparison:
    "Root independently measures equivalent local PostgreSQL fallback. No hosted/cloud cold-start measurement.",
  limitations: [
    "Synthetic full search projection with provenance digest and all represented predicate columns; not full real entity relationship graph",
    "Per-query coldMs means first query on fresh loaded connection; freshProcess is separate process with native initialization and Parquet load",
    "Native binaries and dependency/package overhead are separately measured; actual Lambda packaging, service limits and cloud latency remain a later gate",
    "Real source width, polygon and historical permit distributions are not established by these corpora",
  ],
  recommendation: "A_REPAIR_REQUIRED_WITH_BOUNDED_FIX",
  rationale:
    "Portable local snapshot reader works at500k projection rows. Need actual complete approved snapshot width, Lambda artifact/native packaging and cloud cold-start pilot; do not claim production deployment.",
};
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
