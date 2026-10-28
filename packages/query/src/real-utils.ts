import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { CONTRACT_VERSION } from "../../contracts/src/index.ts";
import { sha256 } from "../../county/src/model.ts";
import type { ArtifactManifest } from "../../county/src/build.ts";
const CORE_FILES = [
  "parcels.parquet",
  "site-addresses.parquet",
  "parcel-address-links.parquet",
  "permits.parquet",
  "coverage.json",
  "runs.json",
  "dataset-manifest.json",
  "schema.json",
  "sample.json",
];
export const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
export type Row = Record<string, unknown>;
export function text(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}
export async function verifySnapshotDirectory(
  directory: string,
): Promise<{ directory: string; manifest: ArtifactManifest }> {
  if ((await lstat(directory)).isSymbolicLink())
    throw new Error("Snapshot directory must not be a symlink");
  const root = await realpath(directory);
  const manifestPath = path.join(root, "artifact-manifest.json");
  if ((await lstat(manifestPath)).isSymbolicLink())
    throw new Error("Manifest symlink rejected");
  const raw = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as ArtifactManifest;
  if (
    raw.version !== "1" ||
    ![CONTRACT_VERSION, "0.4.0", "0.3.0", "0.2.1"].includes(
      raw.contractVersion,
    ) ||
    !/^oakland-real-[a-f0-9]{20}$/.test(raw.snapshotId) ||
    !/^[a-f0-9]{64}$/.test(raw.digest) ||
    !Number.isSafeInteger(raw.count) ||
    raw.count < 1 ||
    !Array.isArray(raw.files) ||
    raw.files.length !== CORE_FILES.length
  )
    throw new Error("Invalid snapshot manifest");
  const names = new Set<string>();
  let total = 0;
  for (const f of raw.files) {
    if (
      !CORE_FILES.includes(f.name) ||
      names.has(f.name) ||
      !Number.isSafeInteger(f.bytes) ||
      f.bytes < 0 ||
      f.bytes > 512 * 1024 ** 2 ||
      !/^[a-f0-9]{64}$/.test(f.sha256)
    )
      throw new Error("Unsafe/duplicate snapshot manifest entry");
    names.add(f.name);
    const p = path.join(root, f.name),
      s = await lstat(p);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink > 1 || s.size !== f.bytes)
      throw new Error("Unsafe or wrong-size snapshot file");
    total += s.size;
    if (total > 1024 ** 3)
      throw new Error("Snapshot exceeds bounded local load");
    if (sha256(await readFile(p)) !== f.sha256)
      throw new Error("Snapshot content integrity failure");
  }
  const dataset = JSON.parse(
    await readFile(path.join(root, "dataset-manifest.json"), "utf8"),
  ) as { snapshotId?: string; digest?: string };
  if (dataset.snapshotId !== raw.snapshotId || dataset.digest !== raw.digest)
    throw new Error("Snapshot identity mismatch");
  return { directory: root, manifest: raw };
}
