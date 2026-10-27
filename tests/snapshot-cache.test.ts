import { it, expect } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { verifiedSnapshotCache } from "../packages/hosted-runtime/src/snapshot-cache.ts";
it("verifies cold and warm cache, repairs corruption, rejects bad hash and traversal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-cache-")),
    data = Buffer.from("fixture bytes"),
    h = (d: Uint8Array) => createHash("sha256").update(d).digest("hex");
  const raw = Buffer.from(
    JSON.stringify({
      version: "1",
      snapshotId: "synthetic-test",
      files: [{ name: "parcels.parquet", bytes: data.length, sha256: h(data) }],
    }),
  );
  let calls = 0;
  const opts = {
    reader: {
      read: async (key: string) => {
        calls++;
        return key.endsWith("artifact-manifest.json") ? raw : data;
      },
    },
    prefix: "snapshots/v1/",
    manifestDigest: h(raw),
    cacheRoot: root,
  };
  try {
    const dir = await verifiedSnapshotCache(opts);
    expect(await readFile(path.join(dir, "parcels.parquet"))).toEqual(data);
    await verifiedSnapshotCache(opts);
    expect(calls).toBe(2);
    await writeFile(path.join(dir, "parcels.parquet"), "corrupt");
    await verifiedSnapshotCache(opts);
    expect(calls).toBe(4);
    await expect(
      verifiedSnapshotCache({ ...opts, manifestDigest: "0".repeat(64) }),
    ).rejects.toThrow("integrity");
    const bad = Buffer.from(
      JSON.stringify({
        version: "1",
        snapshotId: "x",
        files: [{ name: "../escape", bytes: 0, sha256: h(data) }],
      }),
    );
    await expect(
      verifiedSnapshotCache({
        ...opts,
        reader: { read: async () => bad },
        manifestDigest: h(bad),
      }),
    ).rejects.toThrow("rejected");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("repairs linked root/manifest caches without following links", async () => {
  const { symlink, link, rename } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(tmpdir(), "prism-cache-link-")),
    data = Buffer.from("fixture"),
    h = (d: Uint8Array) => createHash("sha256").update(d).digest("hex"),
    raw = Buffer.from(
      JSON.stringify({
        version: "1",
        snapshotId: "fixture",
        files: [
          { name: "parcels.parquet", bytes: data.length, sha256: h(data) },
        ],
      }),
    );
  let reads = 0;
  const opts = {
    reader: {
      read: async (key: string) => {
        reads++;
        return key.endsWith("artifact-manifest.json") ? raw : data;
      },
    },
    prefix: "v1/",
    manifestDigest: h(raw),
    cacheRoot: root,
  };
  try {
    const dir = await verifiedSnapshotCache(opts);
    const saved = dir + "-external";
    await rename(dir, saved);
    await symlink(saved, dir);
    expect(await verifiedSnapshotCache(opts)).toBe(dir);
    expect(reads).toBe(4);
    expect(await readFile(path.join(saved, "parcels.parquet"))).toEqual(data);
    const m = path.join(dir, "artifact-manifest.json");
    await rm(m);
    await symlink(path.join(saved, "artifact-manifest.json"), m);
    await verifiedSnapshotCache(opts);
    expect(reads).toBe(6);
    await link(
      path.join(dir, "artifact-manifest.json"),
      path.join(root, "manifest-alias"),
    );
    await verifiedSnapshotCache(opts);
    expect(reads).toBe(8);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
