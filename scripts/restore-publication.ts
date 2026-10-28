/** Restore only approved, hash-verified public files from a local publication CAR. */
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CarReader } from "@ipld/car";
import { MemoryBlockstore } from "blockstore-core/memory";
import { exporter } from "ipfs-unixfs-exporter";
import { CID } from "multiformats/cid";
import { sha256 as multihash } from "multiformats/hashes/sha2";
import { sha256 } from "../packages/county/src/model.ts";
import {
  PUBLICATION_FILES,
  RUN_PUBLICATION_FILES,
  verifyLocalCar,
} from "../packages/publication/src/local.ts";
assert(
  process.argv[2] && process.argv[3],
  "Usage: restore-publication.ts <local-publication> <new-output>",
);
const source = path.resolve(process.argv[2]!),
  output = path.resolve(process.argv[3]!);
const publication = JSON.parse(
  await readFile(path.join(source, "publication-manifest.json"), "utf8"),
) as {
  rootCid: string;
  car: { bytes: number; sha256: string };
  files: { name: string; bytes: number; sha256: string }[];
};
const names = publication.files.map((f) => f.name).sort();
assert(
  [PUBLICATION_FILES, RUN_PUBLICATION_FILES].some(
    (allowed) => JSON.stringify([...allowed].sort()) === JSON.stringify(names),
  ),
  "Exact public file allowlist required",
);
const carFile = path.join(source, "snapshot.car"),
  carInfo = await lstat(carFile);
assert(
  carInfo.isFile() &&
    !carInfo.isSymbolicLink() &&
    carInfo.size === publication.car.bytes &&
    carInfo.size <= 128 * 1024 ** 2,
);
assert.equal(sha256(await readFile(carFile)), publication.car.sha256);
// Hashing the packaging bytes and extracting listed files alone does not prove
// that every block is reachable or that the root has no additional entries.
// Reuse the publication boundary verifier before creating any output artifact.
await verifyLocalCar(
  carFile,
  publication.rootCid,
  publication.files,
  publication.files.length === PUBLICATION_FILES.length
    ? "legacy-data-v1"
    : "run-history-v2",
);
await mkdir(output, { mode: 0o700 });
const reader = await CarReader.fromIterable(createReadStream(carFile)),
  roots = await reader.getRoots();
assert.equal(roots.length, 1);
assert.equal(roots[0]!.toString(), publication.rootCid);
const store = new MemoryBlockstore(),
  seen = new Set<string>();
for await (const block of reader.blocks()) {
  assert(!seen.has(block.cid.toString()));
  seen.add(block.cid.toString());
  assert(block.cid.version === 1 && [0x55, 0x70].includes(block.cid.code));
  assert(
    CID.create(1, block.cid.code, await multihash.digest(block.bytes)).equals(
      block.cid,
    ),
  );
  await store.put(block.cid, block.bytes);
}
for (const file of publication.files) {
  assert(/^[a-z-]+\.(json|parquet)$/.test(file.name));
  const entry = await exporter(publication.rootCid + "/" + file.name, store);
  assert(entry.type === "file" || entry.type === "raw");
  const parts: Uint8Array[] = [];
  for await (const part of entry.content()) parts.push(part);
  const bytes = Buffer.concat(parts);
  assert.equal(bytes.length, file.bytes);
  assert.equal(sha256(bytes), file.sha256);
  await writeFile(path.join(output, file.name), bytes);
}
const artifact = JSON.parse(
  await readFile(path.join(source, "artifact-manifest.json"), "utf8"),
) as { files: { name: string; bytes: number; sha256: string }[] };
for (const name of [
  "artifact-manifest.json",
  "publication-manifest.json",
  "runs.json",
])
  await copyFile(path.join(source, name), path.join(output, name));
await copyFile(carFile, path.join(output, "snapshot.car"));
for (const f of artifact.files) {
  const b = await readFile(path.join(output, f.name));
  assert.equal(b.length, f.bytes);
  assert.equal(sha256(b), f.sha256);
}
console.log(
  JSON.stringify({
    rootCid: publication.rootCid,
    files: publication.files.length,
    blocks: seen.size,
    allFileDigestsMatch: true,
    sourceModified: false,
    remoteCalls: 0,
  }),
);
