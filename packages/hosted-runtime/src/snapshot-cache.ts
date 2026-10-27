import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  lstat,
} from "node:fs/promises";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
interface Manifest {
  version: string;
  snapshotId: string;
  files: { name: string; bytes: number; sha256: string }[];
}
export interface ObjectReader {
  read(key: string, maxBytes: number): Promise<Uint8Array>;
}
export class S3ObjectReader implements ObjectReader {
  constructor(
    private readonly bucket: string,
    private readonly client = new S3Client({}),
  ) {}
  async read(key: string, maxBytes: number) {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!out.Body || Number(out.ContentLength ?? 0) > maxBytes)
      throw new Error("Snapshot object exceeds allowed size");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of out.Body as AsyncIterable<Uint8Array>) {
      bytes += chunk.length;
      if (bytes > maxBytes)
        throw new Error("Snapshot object exceeds allowed size");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
function parse(bytes: Uint8Array): Manifest {
  const m = JSON.parse(Buffer.from(bytes).toString("utf8")) as Manifest;
  if (
    m.version !== "1" ||
    !m.snapshotId ||
    !Array.isArray(m.files) ||
    m.files.length < 1 ||
    m.files.length > 64
  )
    throw new Error("Snapshot manifest rejected");
  const seen = new Set<string>();
  let total = 0;
  for (const f of m.files) {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(f.name) ||
      seen.has(f.name) ||
      !Number.isSafeInteger(f.bytes) ||
      f.bytes < 0 ||
      f.bytes > 512 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(f.sha256)
    )
      throw new Error("Snapshot file entry rejected");
    seen.add(f.name);
    total += f.bytes;
  }
  if (total > 1536 * 1024 * 1024)
    throw new Error("Snapshot cache size exceeded");
  return m;
}
export async function verifiedSnapshotCache(opts: {
  reader: ObjectReader;
  prefix: string;
  manifestDigest: string;
  cacheRoot: string;
  manifestName?: "artifact-manifest.json" | "private-operational-manifest.json";
  validateManifest?: (value: unknown) => void;
}): Promise<string> {
  if (
    !/^[a-f0-9]{64}$/.test(opts.manifestDigest) ||
    !/^([a-zA-Z0-9_.-]+\/)*$/.test(opts.prefix)
  )
    throw new Error("Snapshot cache configuration rejected");
  const manifestName = opts.manifestName ?? "artifact-manifest.json";
  const checked = (bytes: Uint8Array) => {
    const m = parse(bytes);
    opts.validateManifest?.(JSON.parse(Buffer.from(bytes).toString("utf8")));
    return m;
  };
  const target = path.join(opts.cacheRoot, opts.manifestDigest);
  try {
    const parent = await lstat(opts.cacheRoot);
    if (!parent.isDirectory() || parent.isSymbolicLink())
      throw new Error("Snapshot cache root rejected");
  } catch (e) {
    if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
  }
  async function verify(directory: string) {
    const dir = await lstat(directory);
    if (!dir.isDirectory() || dir.isSymbolicLink())
      throw new Error("Snapshot cache directory rejected");
    const manifestPath = path.join(directory, manifestName),
      manifestStat = await lstat(manifestPath);
    if (
      !manifestStat.isFile() ||
      manifestStat.isSymbolicLink() ||
      manifestStat.nlink > 1 ||
      manifestStat.size > 1024 * 1024
    )
      throw new Error("Snapshot cache manifest rejected");
    const raw = await readFile(manifestPath);
    if (hash(raw) !== opts.manifestDigest)
      throw new Error("Manifest integrity mismatch");
    const m = checked(raw);
    for (const f of m.files) {
      const p = path.join(directory, f.name),
        st = await lstat(p);
      if (
        !st.isFile() ||
        st.isSymbolicLink() ||
        st.nlink > 1 ||
        st.size !== f.bytes ||
        hash(await readFile(p)) !== f.sha256
      )
        throw new Error("Snapshot file integrity mismatch");
    }
    return m;
  }
  try {
    await verify(target);
    return target;
  } catch {
    /* A failed or partial cache is never used. */
  }
  await mkdir(opts.cacheRoot, { recursive: true });
  const rootStat = await lstat(opts.cacheRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error("Snapshot cache root rejected");
  const raw = await opts.reader.read(
    `${opts.prefix}${manifestName}`,
    1024 * 1024,
  );
  if (hash(raw) !== opts.manifestDigest)
    throw new Error("Manifest integrity mismatch");
  const m = checked(raw);
  const stage = path.join(opts.cacheRoot, `.partial-${randomUUID()}`);
  await mkdir(stage);
  try {
    await writeFile(path.join(stage, manifestName), raw, {
      flag: "wx",
    });
    for (const f of m.files) {
      const bytes = await opts.reader.read(`${opts.prefix}${f.name}`, f.bytes);
      if (bytes.length !== f.bytes || hash(bytes) !== f.sha256)
        throw new Error("Snapshot file integrity mismatch");
      await writeFile(path.join(stage, f.name), bytes, { flag: "wx" });
    }
    await verify(stage);
    await rm(target, { recursive: true, force: true });
    await rename(stage, target);
    return target;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
export async function prepareSnapshotCache() {
  const bucket = process.env.PRISM_SNAPSHOT_BUCKET,
    prefix = process.env.PRISM_SNAPSHOT_PREFIX ?? "",
    manifestDigest = process.env.PRISM_SNAPSHOT_MANIFEST_SHA256;
  if (!bucket || !manifestDigest)
    throw new Error("Immutable snapshot configuration required");
  return verifiedSnapshotCache({
    reader: new S3ObjectReader(bucket),
    prefix,
    manifestDigest,
    cacheRoot: "/tmp/prism-snapshots",
  });
}
