import { createReadStream } from "node:fs";
import { open, readFile, writeFile, stat, lstat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { importer, type ImportResult } from "ipfs-unixfs-importer";
import { exporter } from "ipfs-unixfs-exporter";
import { fixedSize } from "ipfs-unixfs-importer/chunker";
import { balanced } from "ipfs-unixfs-importer/layout";
import { MemoryBlockstore } from "blockstore-core/memory";
import { CarWriter, CarReader } from "@ipld/car";
import { CID } from "multiformats/cid";
import { sha256 as multihashSha256 } from "multiformats/hashes/sha2";
import { sha256, stableJson } from "../../county/src/model.ts";
import { verifySnapshotDirectory } from "../../query/src/real.ts";
import {
  PublicRunManifestSchema,
  type PublicRunManifest,
} from "./run-manifest.ts";
export const PUBLICATION_FILES = [
  "parcels.parquet",
  "site-addresses.parquet",
  "parcel-address-links.parquet",
  "permits.parquet",
  "coverage.json",
  "dataset-manifest.json",
  "schema.json",
  "sample.json",
] as const;
export const RUN_PUBLICATION_FILES = [
  ...PUBLICATION_FILES,
  "runs.json",
  "run-manifest.json",
] as const;
export type PublicationProfile = "legacy-data-v1" | "run-history-v2";
function approvedFiles(profile: PublicationProfile): readonly string[] {
  if (profile === "legacy-data-v1") return PUBLICATION_FILES;
  if (profile === "run-history-v2") return RUN_PUBLICATION_FILES;
  throw new Error("Unknown publication profile");
}
async function publicRunManifest(
  root: string,
  manifest: {
    snapshotId: string;
    digest: string;
    contractVersion: string;
    parcelCount: number;
    addressCount: number;
    files: readonly { name: string; sha256: string }[];
  },
): Promise<PublicRunManifest> {
  const file = path.join(root, "run-manifest.json"),
    info = await lstat(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size > 1048576
  )
    throw new Error("Unsafe public run manifest");
  const run = PublicRunManifestSchema.parse(
    JSON.parse(await readFile(file, "utf8")),
  );
  const runs: unknown = JSON.parse(
    await readFile(path.join(root, "runs.json"), "utf8"),
  );
  const history = Array.isArray(runs)
    ? (runs as Record<string, unknown>[])
    : [];
  const current = history.filter((r) => r.id === run.runId);
  const dataset = JSON.parse(
    await readFile(path.join(root, "dataset-manifest.json"), "utf8"),
  ) as Record<string, unknown>;
  if (
    run.datasetSnapshotId !== manifest.snapshotId ||
    run.datasetDigest !== manifest.digest ||
    run.contractVersion !== manifest.contractVersion ||
    run.datasetManifestSha256 !==
      manifest.files.find((f) => f.name === "dataset-manifest.json")?.sha256 ||
    run.runsSha256 !==
      manifest.files.find((f) => f.name === "runs.json")?.sha256 ||
    current.length !== 1 ||
    current[0]?.complete !== true ||
    current[0]?.snapshotId !== run.datasetSnapshotId ||
    current[0]?.digest !== run.datasetDigest ||
    current[0]?.startedAt !== run.startedAt ||
    current[0]?.completedAt !== run.completedAt ||
    stableJson(current[0]?.deltas) !== stableJson(run.factDelta) ||
    dataset.termsDigest !== run.acceptedTermsDigest ||
    dataset.fieldClassificationDigest !== run.publicFieldClassificationDigest ||
    run.sourceLayers.some((layer) => {
      const parcel = layer.id === "oakland-tax-parcel-plus";
      return (
        layer.count !==
          (parcel ? manifest.parcelCount : manifest.addressCount) ||
        layer.contentDigest !==
          dataset[parcel ? "parcelContentDigest" : "addressContentDigest"]
      );
    })
  )
    throw new Error("Run manifest differs from verified data/history identity");
  return run;
}
async function allBytes(
  parts: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const c of parts) {
    chunks.push(c);
    length += c.length;
  }
  const out = new Uint8Array(length);
  let i = 0;
  for (const c of chunks) {
    out.set(c, i);
    i += c.length;
  }
  return out;
}
async function contentDigest(
  parts: AsyncIterable<Uint8Array>,
): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of parts) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), bytes };
}
export async function verifyLocalCar(
  carFile: string,
  rootCid: string,
  expected: readonly { name: string; bytes: number; sha256: string }[],
  profile: PublicationProfile = "legacy-data-v1",
): Promise<{
  rootCid: string;
  blocks: number;
  files: number;
  bytesVerified: number;
}> {
  const reader = await CarReader.fromIterable(createReadStream(carFile));
  const roots = await reader.getRoots();
  if (roots.length !== 1 || roots[0]!.toString() !== rootCid)
    throw new Error("CAR root mismatch");
  const imported = new MemoryBlockstore();
  let blocks = 0;
  const allCids = new Set<string>();
  for await (const block of reader.blocks()) {
    const key = block.cid.toString();
    if (allCids.has(key)) throw new Error("Duplicate CAR block");
    if (![0x55, 0x70].includes(block.cid.code) || block.cid.version !== 1)
      throw new Error("Unapproved CAR codec/version");
    allCids.add(key);
    const actual = CID.create(
      block.cid.version,
      block.cid.code,
      await multihashSha256.digest(block.bytes),
    );
    if (!actual.equals(block.cid)) throw new Error("CAR block digest mismatch");
    await imported.put(block.cid, block.bytes);
    blocks++;
  }
  const allowed = approvedFiles(profile);
  const expectedNames = [...expected.map((f) => f.name)].sort();
  if (
    expectedNames.length !== allowed.length ||
    expectedNames.some((n, i) => n !== [...allowed].sort()[i])
  )
    throw new Error("CAR file allowlist mismatch");
  const visited = new Set<string>();
  const tracking = {
    get: async function* (cid: CID) {
      visited.add(cid.toString());
      yield* imported.get(cid);
    },
  };
  const directory = await exporter(rootCid, tracking);
  if (directory.type !== "directory")
    throw new Error("Expected UnixFS directory root");
  const names: string[] = [];
  for await (const child of directory.entries()) names.push(child.name);
  names.sort();
  if (
    names.length !== expectedNames.length ||
    names.some((n, i) => n !== expectedNames[i])
  )
    throw new Error("Unexpected CAR root file/directory");
  let bytesVerified = 0;
  for (const file of expected) {
    const entry = await exporter(rootCid + "/" + file.name, tracking);
    if (entry.type !== "file" && entry.type !== "raw")
      throw new Error("Expected UnixFS file/raw entry");
    const got = await contentDigest(entry.content());
    if (got.sha256 !== file.sha256 || got.bytes !== file.bytes)
      throw new Error("CAR local fetch byte mismatch");
    bytesVerified += got.bytes;
  }
  if (
    visited.size !== allCids.size ||
    [...allCids].some((cid) => !visited.has(cid))
  )
    throw new Error("Unreachable/unapproved CAR block rejected");
  return { rootCid, blocks, files: expected.length, bytesVerified };
}
/** Local-only deterministic UnixFS DAG/CAR generation; never contacts a node, gateway or provider. */
export async function rehearsePublication(
  directory: string,
  options: { profile?: PublicationProfile } = {},
): Promise<Record<string, unknown>> {
  const { directory: root, manifest } =
    await verifySnapshotDirectory(directory);
  const profile = options.profile ?? "legacy-data-v1",
    allowed = approvedFiles(profile);
  const run =
    profile === "run-history-v2"
      ? await publicRunManifest(root, manifest)
      : undefined;
  const store = new MemoryBlockstore();
  const inputs = [];
  for (const name of [...allowed].sort())
    inputs.push({
      path: name,
      content: createReadStream(path.join(root, name)),
    });
  const imported: ImportResult[] = [];
  for await (const item of importer(inputs, store, {
    cidVersion: 1,
    rawLeaves: true,
    wrapWithDirectory: true,
    chunker: fixedSize({ chunkSize: 262144 }),
    layout: balanced({ maxChildrenPerNode: 174 }),
    fileImportConcurrency: 1,
    blockWriteConcurrency: 1,
  }))
    imported.push(item);
  const rootNode = imported.find((x) => x.path === "");
  if (!rootNode) throw new Error("Missing deterministic directory root");
  const { writer, out } = CarWriter.create([rootNode.cid]);
  const carFile = path.join(root, "snapshot.car");
  const writing = (async () => {
    const f = await open(carFile, "w");
    try {
      for await (const chunk of out) await f.write(chunk);
    } finally {
      await f.close();
    }
  })();
  const expected = manifest.files.filter((f) => allowed.includes(f.name));
  if (run) {
    const file = path.join(root, "run-manifest.json"),
      bytes = await readFile(file);
    expected.push({
      name: "run-manifest.json",
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  // The importer may leave superseded intermediate directory nodes in its blockstore.
  // Serialize only blocks reached through the final approved files, never every stored block.
  const reachable = new Set<string>();
  const tracking = {
    get: async function* (cid: CID) {
      reachable.add(cid.toString());
      yield* store.get(cid);
    },
  };
  for (const file of expected) {
    const entry = await exporter(
      rootNode.cid.toString() + "/" + file.name,
      tracking,
    );
    if (entry.type !== "file" && entry.type !== "raw")
      throw new Error("Invalid public file entry");
    const got = await contentDigest(entry.content());
    if (got.sha256 !== file.sha256 || got.bytes !== file.bytes)
      throw new Error("Importer file bytes mismatch");
  }
  const blocks = [];
  for (const key of reachable) {
    const cid = CID.parse(key);
    blocks.push({ cid, bytes: await allBytes(store.get(cid)) });
  }
  blocks.sort((a, b) => (a.cid.toString() < b.cid.toString() ? -1 : 1));
  for (const block of blocks) await writer.put(block);
  await writer.close();
  await writing;

  const proof = await verifyLocalCar(
    carFile,
    rootNode.cid.toString(),
    expected,
    profile,
  );
  const files = expected.map((f) => {
    const entry = imported.find((e) => e.path === f.name);
    if (!entry) throw new Error("Missing file DAG root");
    return {
      ...f,
      cid: entry.cid.toString(),
      codec: entry.cid.code === 0x55 ? "raw" : "dag-pb",
      cidVersion: entry.cid.version,
    };
  });
  const runs = JSON.parse(
    await readFile(path.join(root, "runs.json"), "utf8"),
  ) as { id?: string; kind?: string; complete?: boolean; deltas?: unknown }[];
  const publication = {
    version: "1",
    mode: "local-unpublished",
    publicationProfile: profile,
    snapshotId: manifest.snapshotId,
    datasetDigest: manifest.digest,
    rootCid: rootNode.cid.toString(),
    rootCodec: "dag-pb",
    cidVersion: 1,
    multihash: "sha2-256",
    deterministicOptions: {
      chunkBytes: 262144,
      layout: "balanced",
      maxChildren: 174,
      rawLeaves: true,
      mtime: "omitted",
      mode: "omitted",
      canonicalFileOrder: true,
      canonicalCarBlockOrder: true,
    },
    files,
    car: {
      name: "snapshot.car",
      bytes: (await stat(carFile)).size,
      sha256: sha256(await readFile(carFile)),
      roots: [rootNode.cid.toString()],
      ...proof,
    },
    history: runs.map((r) => ({
      runId: r.id,
      kind: r.kind,
      complete: r.complete,
      snapshotId:
        run && r.id !== run.runId
          ? run.priorDatasetSnapshotId
          : manifest.snapshotId,
      datasetRootCid:
        run && r.id !== run.runId ? run.priorRootCid : rootNode.cid.toString(),
      deltas: r.deltas ?? null,
    })),
    historyExclusion: run
      ? "Public run history and strict minimized run-manifest are included in this publication root. Fact delta and schema/provenance change are stated separately; prior root remains immutable."
      : "Run receipts/timestamps and packaging manifest are not dataset-root inputs. A verified no-change run reuses the data root; operation history is separate.",
    ...(run
      ? {
          runId: run.runId,
          priorRootCid: run.priorRootCid,
          factDelta: run.factDelta,
          dataFactsChanged: run.dataFactsChanged,
          schemaOrProvenanceChanged: run.schemaOrProvenanceChanged,
        }
      : {}),
    publicUpload: false,
    ipns: { state: "deferred_not_published" },
    atlas: { state: "deferred_not_submitted" },
    providerPersistence: {
      state: "not_attempted",
      independentProvidersVerified: 0,
    },
    limitations: [
      "Local CAR import/fetch proves byte integrity, not public availability or vendor-loss persistence.",
      "Exact public upload bytes still require Human approval.",
    ],
  };
  await writeFile(
    path.join(root, "publication-manifest.json"),
    JSON.stringify(publication, null, 2) + "\n",
  );
  return publication;
}
