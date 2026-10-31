import { createReadStream } from "node:fs";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { importer } from "ipfs-unixfs-importer";
import { fixedSize } from "ipfs-unixfs-importer/chunker";
import { balanced } from "ipfs-unixfs-importer/layout";
import { exporter } from "ipfs-unixfs-exporter";
import { CarReader, CarWriter } from "@ipld/car";
import { CID } from "multiformats/cid";
import { sha256 as multihash } from "multiformats/hashes/sha2";
import { stableJson } from "../../county/src/model.ts";

export type CurrentPublicFile = {
  name: string;
  bytes: number;
  sha256: string;
  cid: string;
  codec: "raw" | "dag-pb";
};
const options = {
  cidVersion: 1 as const,
  rawLeaves: true,
  wrapWithDirectory: true,
  chunker: fixedSize({ chunkSize: 262144 }),
  layout: balanced({ maxChildrenPerNode: 174 }),
  fileImportConcurrency: 1,
  blockWriteConcurrency: 1,
};
async function body(
  value: Uint8Array | Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
) {
  if (value instanceof Uint8Array) return value;
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const part of value) {
    size += part.length;
    if (size > 2 * 1024 ** 2) throw new Error("Public block byte bound");
    parts.push(part);
  }
  return Buffer.concat(parts);
}
function diskStore(directory: string) {
  return {
    async put(
      cid: CID,
      value: Uint8Array | Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
    ) {
      await writeFile(path.join(directory, cid.toString()), await body(value));
      return cid;
    },
    async *get(cid: CID) {
      yield await readFile(path.join(directory, cid.toString()));
    },
  };
}
export async function publicFileDigest(file: string) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const part of createReadStream(file)) {
    bytes += part.length;
    hash.update(part);
  }
  return { bytes, sha256: hash.digest("hex") };
}
export async function verifyCurrentPublicCar(
  carFile: string,
  rootCid: string,
  files: readonly CurrentPublicFile[],
) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "prism-public-car-check-"),
  );
  const store = diskStore(directory);
  try {
    const reader = await CarReader.fromIterable(createReadStream(carFile));
    const roots = await reader.getRoots();
    if (roots.length !== 1 || roots[0]!.toString() !== rootCid)
      throw new Error("Public CAR root mismatch");
    const blocks = new Set<string>();
    for await (const block of reader.blocks()) {
      const key = block.cid.toString();
      if (
        blocks.has(key) ||
        block.cid.version !== 1 ||
        ![0x55, 0x70].includes(block.cid.code) ||
        !CID.createV1(
          block.cid.code,
          await multihash.digest(block.bytes),
        ).equals(block.cid)
      )
        throw new Error("Public CAR block integrity");
      blocks.add(key);
      await store.put(block.cid, block.bytes);
    }
    const visited = new Set<string>();
    const tracking = {
      async *get(cid: CID) {
        visited.add(cid.toString());
        yield* store.get(cid);
      },
    };
    const root = await exporter(rootCid, tracking);
    if (root.type !== "directory") throw new Error("Public directory required");
    const names: string[] = [];
    for await (const entry of root.entries()) names.push(entry.name);
    if (
      stableJson(names.sort()) !==
      stableJson(files.map((file) => file.name).sort())
    )
      throw new Error("Public CAR exact file list");
    for (const file of files) {
      const entry = await exporter(rootCid + "/" + file.name, tracking);
      if (entry.type !== "raw" && entry.type !== "file")
        throw new Error("Public file required");
      const hash = createHash("sha256");
      let size = 0;
      for await (const part of entry.content()) {
        size += part.length;
        hash.update(part);
      }
      if (
        entry.cid.toString() !== file.cid ||
        size !== file.bytes ||
        hash.digest("hex") !== file.sha256
      )
        throw new Error("Public CAR file bytes mismatch");
    }
    if (
      visited.size !== blocks.size ||
      [...blocks].some((cid) => !visited.has(cid))
    )
      throw new Error("Unreachable public CAR block");
    return {
      roots: [rootCid],
      blocks: blocks.size,
      files: files.length,
      everyFileVerified: true,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
/** Payload index excludes its own CID/root to avoid a content-addressing cycle. */
export async function packCurrentPublicDirectory(
  directory: string,
  names: readonly string[],
) {
  if (
    !names.length ||
    names.length > 64 ||
    new Set(names).size !== names.length ||
    names.some((name) => !/^[a-z0-9][a-z0-9.-]+$/.test(name))
  )
    throw new Error("Finite public payload list required");
  const blocksDirectory = await mkdtemp(
    path.join(tmpdir(), "prism-public-blocks-"),
  );
  const store = diskStore(blocksDirectory);
  try {
    const input = (paths: readonly string[]) =>
      paths.map((name) => ({
        path: name,
        content: createReadStream(path.join(directory, name)),
      }));
    const first = [];
    for await (const entry of importer(
      input([...names].sort()),
      store,
      options,
    ))
      first.push(entry);
    const payload: CurrentPublicFile[] = [];
    for (const name of [...names].sort()) {
      const entry = first.find((value) => value.path === name)!;
      payload.push({
        name,
        ...(await publicFileDigest(path.join(directory, name))),
        cid: entry.cid.toString(),
        codec: entry.cid.code === 0x55 ? "raw" : "dag-pb",
      });
    }
    await writeFile(
      path.join(directory, "artifact-index.json"),
      stableJson({
        version: "p13-public-payload-index-v1",
        files: payload,
        selfAndCurrentRootExcluded: true,
      }) + "\n",
      { flag: "wx" },
    );
    const final = [];
    for await (const entry of importer(
      input([...names, "artifact-index.json"].sort()),
      store,
      options,
    ))
      final.push(entry);
    const root = final.find((entry) => entry.path === "")!;
    const files: CurrentPublicFile[] = [];
    for (const name of [...names, "artifact-index.json"].sort()) {
      const entry = final.find((value) => value.path === name)!;
      files.push({
        name,
        ...(await publicFileDigest(path.join(directory, name))),
        cid: entry.cid.toString(),
        codec: entry.cid.code === 0x55 ? "raw" : "dag-pb",
      });
    }
    const visited = new Set<string>();
    const tracking = {
      async *get(cid: CID) {
        visited.add(cid.toString());
        yield* store.get(cid);
      },
    };
    for (const file of files) {
      const entry = await exporter(
        root.cid.toString() + "/" + file.name,
        tracking,
      );
      if (entry.type !== "file" && entry.type !== "raw")
        throw new Error("Public DAG file required");
      const hash = createHash("sha256");
      let size = 0;
      for await (const part of entry.content()) {
        hash.update(part);
        size += part.length;
      }
      if (size !== file.bytes || hash.digest("hex") !== file.sha256)
        throw new Error("Imported public payload changed");
    }
    const { writer, out } = CarWriter.create([root.cid]);
    const carFile = path.join(directory, "snapshot.car");
    const writing = (async () => {
      const stream = await open(carFile, "wx", 0o600);
      try {
        for await (const part of out) await stream.writeFile(part);
      } finally {
        await stream.close();
      }
    })();
    for (const key of [...visited].sort()) {
      const cid = CID.parse(key);
      await writer.put({ cid, bytes: await body(store.get(cid)) });
    }
    await writer.close();
    await writing;
    const proof = await verifyCurrentPublicCar(
      carFile,
      root.cid.toString(),
      files,
    );
    // The CAR is a separate artifact, not part of the DAG it serializes.
    let carCid = "";
    for await (const entry of importer(input(["snapshot.car"]), store, {
      ...options,
      wrapWithDirectory: false,
    }))
      carCid = entry.cid.toString();
    return {
      rootCid: root.cid.toString(),
      rootCodec: "dag-pb" as const,
      files,
      car: {
        name: "snapshot.car",
        ...(await publicFileDigest(carFile)),
        cid: carCid,
        codec: "dag-pb" as const,
        ...proof,
        separateFromOwnDag: true,
      },
      deterministicOptions: {
        chunkBytes: 262144,
        rawLeaves: true,
        balancedMaxChildren: 174,
        canonicalFileAndBlockOrder: true,
        mtimeAndMode: "omitted",
      },
    };
  } finally {
    await rm(blocksDirectory, { recursive: true, force: true });
  }
}
