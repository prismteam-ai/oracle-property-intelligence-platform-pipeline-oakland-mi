import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";
import { RealSnapshot } from "../packages/query/src/real.ts";
import { sha256 } from "../packages/county/src/model.ts";
const directory = process.argv[2] ?? process.env.PRISM_SNAPSHOT_DIR;
if (!directory) throw new Error("Snapshot directory required");
const output = process.argv[3];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const freshStart = performance.now();
const fresh = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      path.join(root, "scripts/benchmark-real-worker.ts"),
      directory,
    ],
    { encoding: "utf8", timeout: 120000 },
  ),
) as Record<string, unknown>;
const freshProcessWallMs = performance.now() - freshStart;
const start = performance.now();
const snapshot = await RealSnapshot.open(directory);
const loadMs = performance.now() - start;
const base = {
  snapshotId: snapshot.snapshotId,
  lat: 42.66,
  lng: -83.29,
  radiusMeters: 8046.72,
  limit: 50,
};
const queries = [
  ["radius", {}],
  ["roof_known_age", { roofMinAgeYears: 15 }],
  ["roof_unknown_explicit", { roofMinAgeYears: 15, includeUnknown: true }],
  ["open_roofing_permit", { permitStatus: "open", minOpenDays: 1827 }],
  [
    "combined",
    { roofMinAgeYears: 15, permitStatus: "open", minOpenDays: 1827 },
  ],
  ["public_owner_unknown", { ownerRegion: "unknown" }],
  ["largest_allowed_radius", { radiusMeters: 32187 }],
] as const;
const results = [];
try {
  let firstId: string | undefined;
  for (const [name, extra] of queries) {
    const times = [];
    let total = 0,
      returned = 0,
      hash = "";
    for (let i = 0; i < 8; i++) {
      const tick = performance.now();
      const result = await snapshot.search({ ...base, ...extra });
      times.push(performance.now() - tick);
      total = result.total;
      returned = result.rows.length;
      hash = result.queryHash;
      firstId ??= result.rows[0]?.id;
    }
    const warm = times.slice(1).sort((a, b) => a - b);
    results.push({
      name,
      query: { ...base, ...extra },
      queryHash: hash,
      total,
      returned,
      firstMs: times[0],
      warmP50Ms: warm[Math.floor(warm.length / 2)],
      warmP95Ms: warm[warm.length - 1],
      samples: times,
      interpretation:
        total === 0
          ? "No source-backed matches; missing evidence is not a county-wide absence claim."
          : "Actual complete-snapshot query",
    });
  }
  const detailTimes = [];
  if (firstId)
    for (let i = 0; i < 8; i++) {
      const t = performance.now();
      await snapshot.detail(firstId, snapshot.snapshotId);
      detailTimes.push(performance.now() - t);
    }
  let tenureRejection = "";
  try {
    await snapshot.search({ ...base, minOwnershipYears: 10 });
  } catch (e) {
    tenureRejection = e instanceof Error ? e.message : "rejected";
  }
  const bytes = await readFile(path.join(directory, "artifact-manifest.json"));
  const manifest = JSON.parse(bytes.toString()) as {
    files: { name: string; bytes: number }[];
  };
  const report = {
    kind: "complete-real-public-safe-snapshot",
    generatedUtc: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    snapshotId: snapshot.snapshotId,
    digest: snapshot.digest,
    properties: snapshot.count,
    siteAddresses: snapshot.addressCount,
    manifestSha256: sha256(bytes),
    artifactBytes: manifest.files.reduce((n, f) => n + f.bytes, 0),
    loadMs,
    freshProcess: { ...fresh, parentWallMs: freshProcessWallMs },
    results,
    detail: {
      samples: detailTimes,
      warmP95Ms: Math.max(...detailTimes.slice(1)),
    },
    ownershipTenure: {
      state: "unsupported_source_event_missing",
      explicitRejection: tenureRejection,
    },
    memory: process.memoryUsage(),
    networkUsed: false,
    limitations: [
      "Local OS process/native timing is not an AWS cold-start service measurement.",
      "Every acquired parcel/address is retained; only result payloads are bounded.",
      "Roof/permit unknown-source zero matches must not be interpreted as zero permits or new roofs.",
      "Fresh-process Parquet load/hash/index time includes local filesystem/native startup; remote S3 fetch requires later authorized hosted measurement.",
      "Empirical p95 is largest of seven warm samples.",
    ],
  };
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      snapshotId: snapshot.snapshotId,
      properties: snapshot.count,
      addresses: snapshot.addressCount,
      loadMs,
      freshProcessWallMs,
      results: results.map((r) => ({
        name: r.name,
        total: r.total,
        warmP95Ms: r.warmP95Ms,
      })),
      output,
    }),
  );
} finally {
  snapshot.close();
}
