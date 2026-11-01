import { expect, test } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  rehearsePublication,
  PUBLICATION_FILES,
  verifyLocalCar,
} from "../packages/publication/src/local.ts";
import { sha256 } from "../packages/county/src/model.ts";
import { CarReader, CarWriter } from "@ipld/car";
import { CID } from "multiformats/cid";
import { sha256 as multihashSha256 } from "multiformats/hashes/sha2";
import { CONTRACT_VERSION } from "../packages/contracts/src/index.ts";
test("CIDv1/UnixFS/CAR round trip is deterministic, tamper-evident and separate from history", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "prism-car-"));
  const snapshotId = "oakland-real-" + "a".repeat(20);
  const digest = "b".repeat(64);
  const files = [];
  for (const name of [...PUBLICATION_FILES, "runs.json"]) {
    const body =
      name === "dataset-manifest.json"
        ? JSON.stringify({ snapshotId, digest })
        : name === "runs.json"
          ? JSON.stringify([
              {
                id: "synthetic-test-run-01",
                kind: "synthetic-byte-fixture",
                complete: true,
              },
            ])
          : JSON.stringify({
              kind: "synthetic-byte-fixture",
              name,
              content: "test-only-data".repeat(
                name.endsWith(".parquet") ? 30000 : 1,
              ),
            });
    await writeFile(path.join(dir, name), body);
    files.push({ name, bytes: Buffer.byteLength(body), sha256: sha256(body) });
  }
  await writeFile(
    path.join(dir, "artifact-manifest.json"),
    JSON.stringify({
      version: "1",
      contractVersion: CONTRACT_VERSION,
      snapshotId,
      digest,
      count: 1,
      addressCount: 1,
      parcelCount: 1,
      files,
      limitations: [
        "Synthetic byte-level fixture; not actual Parquet or county data.",
      ],
    }),
  );
  const first = await rehearsePublication(dir);
  const firstCar = await readFile(path.join(dir, "snapshot.car"));
  const second = await rehearsePublication(dir);
  expect(first.rootCid).toBe(second.rootCid);
  expect(sha256(await readFile(path.join(dir, "snapshot.car")))).toBe(
    sha256(firstCar),
  );
  const expected = files.filter((f) => f.name !== "runs.json");
  const proof = await verifyLocalCar(
    path.join(dir, "snapshot.car"),
    String(first.rootCid),
    expected,
  );
  expect(proof.files).toBe(8);
  expect(proof.blocks).toBeGreaterThan(8);
  const runs = JSON.stringify([
    {
      id: "synthetic-test-run-02",
      kind: "synthetic-byte-fixture",
      complete: true,
    },
  ]);
  await writeFile(path.join(dir, "runs.json"), runs);
  const r = files.find((f) => f.name === "runs.json")!;
  r.bytes = Buffer.byteLength(runs);
  r.sha256 = sha256(runs);
  await writeFile(
    path.join(dir, "artifact-manifest.json"),
    JSON.stringify({
      version: "1",
      contractVersion: CONTRACT_VERSION,
      snapshotId,
      digest,
      count: 1,
      addressCount: 1,
      parcelCount: 1,
      files,
    }),
  );
  expect((await rehearsePublication(dir)).rootCid).toBe(first.rootCid);
  const carReader = await CarReader.fromBytes(firstCar);
  const extra = Buffer.from("SYNTHETIC_PRIVATE_POSTAL_CANARY");
  const extraCid = CID.createV1(0x55, await multihashSha256.digest(extra));
  const { writer, out } = CarWriter.create(await carReader.getRoots());
  const collect = (async () => {
    const chunks: Uint8Array[] = [];
    for await (const c of out) chunks.push(c);
    return Buffer.concat(chunks);
  })();
  for await (const block of carReader.blocks()) await writer.put(block);
  await writer.put({ cid: extraCid, bytes: extra });
  await writer.close();
  const withExtra = path.join(dir, "extra-block.car");
  await writeFile(withExtra, await collect);
  await expect(
    verifyLocalCar(withExtra, String(first.rootCid), expected),
  ).rejects.toThrow("Unreachable");
  const corrupt = Buffer.from(firstCar);
  corrupt[corrupt.length - 20] ^= 1;
  await writeFile(path.join(dir, "bad.car"), corrupt);
  await expect(
    verifyLocalCar(path.join(dir, "bad.car"), String(first.rootCid), expected),
  ).rejects.toThrow();
  expect(first.publicUpload).toBe(false);
});
