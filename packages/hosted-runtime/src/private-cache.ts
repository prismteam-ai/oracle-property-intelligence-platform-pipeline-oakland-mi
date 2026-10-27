import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  S3ObjectReader,
  verifiedSnapshotCache,
  type ObjectReader,
} from "./snapshot-cache.ts";
import { stableJson, sha256 } from "../../county/src/model.ts";
export interface PrivateFile {
  name: "owner-derivatives.parquet" | "protected-enrichment.parquet";
  role: "owner" | "enrichment";
  bytes: number;
  sha256: string;
}
export interface PrivateManifest {
  version: "1";
  publicSnapshotId: string;
  snapshotId: string;
  digest: string;
  files: PrivateFile[];
}
export function validatePrivateManifest(
  value: unknown,
  publicSnapshotId: string,
): asserts value is PrivateManifest {
  const m = value as PrivateManifest;
  if (
    !/^oakland-real-[a-f0-9]{20}$/.test(publicSnapshotId) ||
    !m ||
    Object.keys(m).some(
      (k) =>
        ![
          "version",
          "publicSnapshotId",
          "snapshotId",
          "digest",
          "files",
        ].includes(k),
    ) ||
    m.version !== "1" ||
    m.publicSnapshotId !== publicSnapshotId ||
    m.snapshotId !== publicSnapshotId ||
    !Array.isArray(m.files) ||
    m.files.length !== 2
  )
    throw new Error("Protected manifest snapshot/shape rejected");
  const names = new Set<string>(),
    roles = new Set<string>();
  for (const f of m.files) {
    if (
      !f ||
      Object.keys(f).some(
        (k) => !["name", "role", "bytes", "sha256"].includes(k),
      ) ||
      (f.role === "owner"
        ? f.name !== "owner-derivatives.parquet"
        : f.role === "enrichment"
          ? f.name !== "protected-enrichment.parquet"
          : true) ||
      names.has(f.name) ||
      roles.has(f.role) ||
      !Number.isSafeInteger(f.bytes) ||
      f.bytes < 0 ||
      f.bytes > 128 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(f.sha256)
    )
      throw new Error("Protected file role/name/size rejected");
    names.add(f.name);
    roles.add(f.role);
  }
  const canonical = [...m.files].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  if (m.digest !== sha256(stableJson(canonical)))
    throw new Error("Protected canonical manifest digest rejected");
}
export async function loadPrivateCache(options: {
  publicSnapshotId: string;
  reader: ObjectReader;
  prefix: string;
  manifestDigest: string;
  cacheRoot: string;
}) {
  const directory = await verifiedSnapshotCache({
    ...options,
    manifestName: "private-operational-manifest.json",
    validateManifest: (value) =>
      validatePrivateManifest(value, options.publicSnapshotId),
  });
  const m = JSON.parse(
    await readFile(
      path.join(directory, "private-operational-manifest.json"),
      "utf8",
    ),
  ) as PrivateManifest;
  const owner = m.files.find((f) => f.role === "owner")!,
    enrichment = m.files.find((f) => f.role === "enrichment")!;
  return {
    ownerFile: path.join(directory, owner.name),
    ownerSha256: owner.sha256,
    enrichmentFile: path.join(directory, enrichment.name),
    enrichmentSha256: enrichment.sha256,
  };
}
export async function preparePrivateCache(publicSnapshotId: string) {
  if (process.env.PRISM_ENABLE_PROTECTED_VIEW !== "1") return;
  const bucket = process.env.PRISM_PRIVATE_SNAPSHOT_BUCKET,
    prefix = process.env.PRISM_PRIVATE_SNAPSHOT_PREFIX,
    manifestDigest = process.env.PRISM_PRIVATE_SNAPSHOT_MANIFEST_SHA256;
  if (
    !bucket ||
    !prefix ||
    !manifestDigest ||
    process.env.PRISM_REQUIRE_AUTH !== "1"
  )
    throw new Error(
      "Protected cache requires explicit authenticated configuration",
    );
  const prepared = await loadPrivateCache({
    publicSnapshotId,
    reader: new S3ObjectReader(bucket),
    prefix,
    manifestDigest,
    cacheRoot: "/tmp/prism-private-snapshots",
  });
  process.env.PRISM_OWNER_DERIVATIVES = prepared.ownerFile;
  process.env.PRISM_OWNER_DERIVATIVES_SHA256 = prepared.ownerSha256;
  process.env.PRISM_PRIVATE_ENRICHMENT = prepared.enrichmentFile;
  process.env.PRISM_PRIVATE_ENRICHMENT_SHA256 = prepared.enrichmentSha256;
}
