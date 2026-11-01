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
import { PublicRunHistorySchema, publicRunLayers } from "./run-history.ts";
import {
  PublicPredecessorSchema,
  type PublicPredecessor,
} from "./run-manifest.ts";
import type { ArtifactManifest } from "../../county/src/build.ts";
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
export type PublicationProfile =
  "legacy-data-v1" | "run-history-v2" | "run-history-v3";
function approvedFiles(profile: PublicationProfile): readonly string[] {
  if (profile === "legacy-data-v1") return PUBLICATION_FILES;
  if (profile === "run-history-v2" || profile === "run-history-v3")
    return RUN_PUBLICATION_FILES;
  throw new Error("Unknown publication profile");
}
export async function verifiedPreviousPublication(
  directory: string | undefined,
) {
  if (!directory)
    throw new Error("Verified previous publication directory required");
  if ((await lstat(directory)).isSymbolicLink())
    throw new Error("Previous publication symlink rejected");
  for (const name of [
    "artifact-manifest.json",
    "publication-manifest.json",
    "runs.json",
  ]) {
    const info = await lstat(path.join(directory, name));
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size > 16 * 1048576
    )
      throw new Error("Unsafe previous publication metadata");
  }
  const file = path.join(directory, "artifact-manifest.json");
  const prior = JSON.parse(await readFile(file, "utf8")) as ArtifactManifest;
  const allowed = [...PUBLICATION_FILES, "runs.json"];
  if (
    prior.version !== "1" ||
    !/^\d+\.\d+\.\d+$/.test(prior.contractVersion) ||
    !/^oakland-real-[a-f0-9]{20}$/.test(prior.snapshotId) ||
    !/^[a-f0-9]{64}$/.test(prior.digest) ||
    ![prior.count, prior.parcelCount, prior.addressCount].every(
      (n) => Number.isSafeInteger(n) && n > 0 && n <= 10000000,
    ) ||
    !Array.isArray(prior.files) ||
    prior.files.length !== allowed.length ||
    new Set(prior.files.map((f) => f.name)).size !== allowed.length
  )
    throw new Error("Invalid previous publication manifest");
  let total = 0;
  for (const f of prior.files) {
    if (
      !(allowed as readonly string[]).includes(f.name) ||
      !Number.isSafeInteger(f.bytes) ||
      f.bytes < 0 ||
      f.bytes > 512 * 1024 ** 2 ||
      !/^[a-f0-9]{64}$/.test(f.sha256)
    )
      throw new Error("Unsafe previous file manifest");
    const full = path.join(directory, f.name),
      info = await lstat(full);
    total += info.size;
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size !== f.bytes ||
      total > 1024 ** 3 ||
      sha256(await readFile(full)) !== f.sha256
    )
      throw new Error("Previous publication integrity failure");
  }
  const dataset = JSON.parse(
    await readFile(path.join(directory, "dataset-manifest.json"), "utf8"),
  ) as Record<string, unknown>;
  const publication = JSON.parse(
    await readFile(path.join(directory, "publication-manifest.json"), "utf8"),
  ) as {
    rootCid: string;
    snapshotId: string;
    datasetDigest: string;
    car: { bytes: number; sha256: string };
    publicationProfile?: PublicationProfile;
    files: { name: string; bytes: number; sha256: string }[];
    history: unknown;
  };
  if (
    dataset.snapshotId !== prior.snapshotId ||
    dataset.digest !== prior.digest ||
    dataset.contractVersion !== prior.contractVersion ||
    publication.snapshotId !== prior.snapshotId ||
    publication.datasetDigest !== prior.digest
  )
    throw new Error("Previous publication identity mismatch");
  const car = path.join(directory, "snapshot.car"),
    info = await lstat(car);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size > 128 * 1024 ** 2 ||
    info.size !== publication.car.bytes ||
    sha256(await readFile(car)) !== publication.car.sha256
  )
    throw new Error("Previous CAR integrity failure");
  const profile = publication.publicationProfile ?? "legacy-data-v1";
  const expectedNames = [...approvedFiles(profile)].sort();
  if (
    !Array.isArray(publication.files) ||
    stableJson(publication.files.map((f) => f.name).sort()) !==
      stableJson(expectedNames)
  )
    throw new Error("Previous publication file profile mismatch");
  const carProof = await verifyLocalCar(
    car,
    publication.rootCid,
    publication.files,
    profile,
  );
  const historyBytes = await readFile(path.join(directory, "runs.json"));
  const history = PublicRunHistorySchema.parse(
    JSON.parse(historyBytes.toString()),
  );
  let run: PublicRunManifest | undefined,
    runManifestSha256: string | null = null;
  let prefix: PublicPredecessor[] = [];
  if (profile !== "legacy-data-v1") {
    const runInfo = await lstat(path.join(directory, "run-manifest.json"));
    if (
      !runInfo.isFile() ||
      runInfo.isSymbolicLink() ||
      runInfo.nlink !== 1 ||
      runInfo.size > 16 * 1048576
    )
      throw new Error("Unsafe previous run manifest");
    const bytes = await readFile(path.join(directory, "run-manifest.json"));
    runManifestSha256 = sha256(bytes);
    run = PublicRunManifestSchema.parse(JSON.parse(bytes.toString()));
    if (
      run.runsSha256 !== sha256(historyBytes) ||
      run.datasetManifestSha256 !==
        prior.files.find((f) => f.name === "dataset-manifest.json")?.sha256 ||
      run.datasetSnapshotId !== prior.snapshotId ||
      run.datasetDigest !== prior.digest ||
      run.runId !== history.at(-1)?.id
    )
      throw new Error("Previous run identity mismatch");
    prefix =
      run.version === "public-run-manifest-v2"
        ? run.predecessors
        : history.slice(0, -1).map((r) => ({
            runId: r.id,
            snapshotId: r.snapshotId,
            datasetDigest: r.digest,
            rootCid: run!.priorRootCid,
          }));
    if (
      prefix.length !== history.length - 1 ||
      prefix.some(
        (p, i) =>
          p.runId !== history[i]!.id ||
          p.snapshotId !== history[i]!.snapshotId ||
          p.datasetDigest !== history[i]!.digest,
      )
    )
      throw new Error("Previous immutable catalog/history mismatch");
    if (
      run.version !== "public-run-manifest-v2" &&
      history
        .slice(0, -1)
        .some((r) => r.snapshotId !== run!.priorDatasetSnapshotId)
    )
      throw new Error("Historical predecessor snapshot mismatch");
  } else if (
    history.some(
      (r) => r.snapshotId !== prior.snapshotId || r.digest !== prior.digest,
    )
  )
    throw new Error("Legacy data-only history may not relabel another dataset");
  const catalog = history.map((r, i) =>
    PublicPredecessorSchema.parse(
      i < history.length - 1 && run
        ? prefix[i]
        : {
            runId: r.id,
            snapshotId: r.snapshotId,
            datasetDigest: r.digest,
            rootCid: publication.rootCid,
          },
    ),
  );
  if (
    catalog.at(-1)?.snapshotId !== prior.snapshotId ||
    catalog.at(-1)?.datasetDigest !== prior.digest
  )
    throw new Error("Previous latest history/data mismatch");
  const expectedHistory = history.map((r, i) => ({
    runId: r.id,
    kind: r.kind,
    complete: r.complete,
    snapshotId: r.snapshotId,
    datasetRootCid: catalog[i]!.rootCid,
    deltas: r.deltas,
  }));
  if (stableJson(publication.history) !== stableJson(expectedHistory))
    throw new Error("Previous publication history relabeling rejected");
  return {
    manifest: prior,
    dataset,
    rootCid: publication.rootCid,
    history,
    catalog,
    profile,
    artifactManifestSha256: sha256(await readFile(file)),
    historySha256: sha256(historyBytes),
    runManifestSha256,
    runManifest: run,
    carProof,
  };
}
export async function publicRunManifest(
  root: string,
  manifest: {
    snapshotId: string;
    digest: string;
    contractVersion: string;
    parcelCount: number;
    addressCount: number;
    count: number;
    files: readonly { name: string; sha256: string }[];
  },
  previousDirectory: string | undefined,
) {
  const file = path.join(root, "run-manifest.json"),
    info = await lstat(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size > 16 * 1048576
  )
    throw new Error("Unsafe public run manifest");
  const run = PublicRunManifestSchema.parse(
    JSON.parse(await readFile(file, "utf8")),
  );
  if ((await stat(path.join(root, "runs.json"))).size > 16 * 1048576)
    throw new Error("Public run history exceeds minimized bound");
  const history = PublicRunHistorySchema.parse(
    JSON.parse(await readFile(path.join(root, "runs.json"), "utf8")),
  );
  const previous = await verifiedPreviousPublication(previousDirectory);
  const current = history.filter((r) => r.id === run.runId);
  const priorLast = previous.history.at(-1)!,
    priorLayers = publicRunLayers(priorLast);
  const dataset = JSON.parse(
    await readFile(path.join(root, "dataset-manifest.json"), "utf8"),
  ) as Record<string, unknown>;
  if (
    run.datasetSnapshotId !== manifest.snapshotId ||
    run.datasetDigest !== manifest.digest ||
    run.contractVersion !== manifest.contractVersion ||
    run.priorRootCid !== previous.rootCid ||
    run.priorDatasetSnapshotId !== previous.manifest.snapshotId ||
    history.length !== previous.history.length + 1 ||
    history.at(-1)?.id !== run.runId ||
    stableJson(history.slice(0, -1)) !== stableJson(previous.history) ||
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
    current[0]?.canonicalPropertyCount !== manifest.count ||
    priorLast.snapshotId !== run.priorDatasetSnapshotId ||
    priorLast.digest !== previous.manifest.digest ||
    priorLast.canonicalPropertyCount !== previous.manifest.count ||
    priorLayers.tax_parcel.count !== previous.manifest.parcelCount ||
    priorLayers.site_address.count !== previous.manifest.addressCount ||
    stableJson(current[0]?.deltas) !== stableJson(run.factDelta) ||
    dataset.termsDigest !== run.acceptedTermsDigest ||
    dataset.fieldClassificationDigest !== run.publicFieldClassificationDigest ||
    run.schemaOrProvenanceChanged !==
      [
        "transformVersion",
        "contractVersion",
        "fieldClassificationDigest",
        "termsDigest",
        "parcelProvenanceDigest",
        "addressProvenanceDigest",
      ].some((key) => dataset[key] !== previous.dataset[key]) ||
    run.dataFactsChanged !==
      ["parcelContentDigest", "addressContentDigest"].some(
        (key) => dataset[key] !== previous.dataset[key],
      ) ||
    run.sourceLayers.some((layer) => {
      const parcel = layer.id === "oakland-tax-parcel-plus";
      return (
        layer.count !==
          (parcel ? manifest.parcelCount : manifest.addressCount) ||
        layer.contentDigest !==
          dataset[parcel ? "parcelContentDigest" : "addressContentDigest"] ||
        stableJson(layer.delta) !==
          stableJson(
            current[0]
              ? publicRunLayers(current[0])[
                  parcel ? "tax_parcel" : "site_address"
                ].delta
              : null,
          ) ||
        layer.delta.deleted + layer.delta.changed + layer.delta.unchanged !==
          (parcel
            ? previous.manifest.parcelCount
            : previous.manifest.addressCount)
      );
    })
  )
    throw new Error("Run manifest differs from verified data/history identity");
  if (run.version === "public-run-manifest-v2") {
    const entry = current[0]!;
    if (
      !("version" in entry) ||
      run.previousRunId !== priorLast.id ||
      run.previousArtifactManifestSha256 !== previous.artifactManifestSha256 ||
      run.previousHistorySha256 !== previous.historySha256 ||
      run.previousRunManifestSha256 !== previous.runManifestSha256 ||
      stableJson(run.predecessors) !== stableJson(previous.catalog) ||
      run.observationDigest !== entry.observationDigest ||
      stableJson(run.sourceObservations) !==
        stableJson(entry.sourceObservations) ||
      stableJson(run.failures) !== stableJson(entry.failures)
    )
      throw new Error("Generic predecessor/observation lineage mismatch");
  }
  return { run, previous };
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
  options: {
    profile?: PublicationProfile;
    previousPublicationDirectory?: string;
  } = {},
): Promise<Record<string, unknown>> {
  const { directory: root, manifest } =
    await verifySnapshotDirectory(directory);
  const profile = options.profile ?? "legacy-data-v1",
    allowed = approvedFiles(profile);
  const verifiedRun =
    profile !== "legacy-data-v1"
      ? await publicRunManifest(
          root,
          manifest,
          options.previousPublicationDirectory,
        )
      : undefined;
  const run = verifiedRun?.run;
  if (
    run &&
    (profile === "run-history-v3") !==
      (run.version === "public-run-manifest-v2")
  )
    throw new Error("Run manifest/profile version mismatch");
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
    // The original data-only wire format predates an explicit profile marker.
    ...(profile === "legacy-data-v1" ? {} : { publicationProfile: profile }),
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
    history: runs.map((r, i) => ({
      runId: r.id,
      kind: r.kind,
      complete: r.complete,
      snapshotId:
        run && i < runs.length - 1
          ? verifiedRun!.previous.catalog[i]!.snapshotId
          : manifest.snapshotId,
      datasetRootCid:
        run && i < runs.length - 1
          ? verifiedRun!.previous.catalog[i]!.rootCid
          : rootNode.cid.toString(),
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
    ...(profile === "run-history-v3"
      ? {
          classification: "public-safe-assessment-product-snapshot",
          artifacts: [
            {
              name: "/",
              artifactKind: "directory",
              cid: rootNode.cid.toString(),
              bytes: (await allBytes(store.get(rootNode.cid))).length,
              codec: "dag-pb",
              sha256: sha256(await allBytes(store.get(rootNode.cid))),
              classification: "public-safe",
            },
            ...files.map((f) => ({
              name: f.name,
              artifactKind: "file",
              cid: f.cid,
              bytes: f.bytes,
              codec: f.codec,
              sha256: f.sha256,
              classification: "public-safe",
            })),
          ],
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
