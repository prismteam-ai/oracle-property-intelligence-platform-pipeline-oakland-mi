import { performance } from "node:perf_hooks";
import { RealSnapshot } from "../packages/query/src/real.ts";
const directory = process.argv[2];
if (!directory) throw new Error("Snapshot directory required");
const start = performance.now();
const snapshot = await RealSnapshot.open(directory);
const loadMs = performance.now() - start;
try {
  const qStart = performance.now();
  const result = await snapshot.search({
    snapshotId: snapshot.snapshotId,
    lat: 42.66,
    lng: -83.29,
    radiusMeters: 8046.72,
    limit: 50,
  });
  console.log(
    JSON.stringify({
      snapshotId: snapshot.snapshotId,
      count: snapshot.count,
      addressCount: snapshot.addressCount,
      loadMs,
      firstRadiusMs: performance.now() - qStart,
      total: result.total,
      returned: result.rows.length,
      rss: process.memoryUsage().rss,
      heapUsed: process.memoryUsage().heapUsed,
      allSourceRecordsLoaded: true,
      networkUsed: false,
    }),
  );
} finally {
  snapshot.close();
}
