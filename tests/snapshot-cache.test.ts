import { it, expect } from "vitest";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  readdir,
  stat,
} from "node:fs/promises";
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
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(dir, "parcels.parquet"))).mode & 0o777).toBe(
      0o600,
    );
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
it("fetches cache objects with at most three workers while preserving every hash", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-cache-parallel-")),
    data = Buffer.from("synthetic-file"),
    hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex"),
    files = Array.from({ length: 6 }, (_, i) => ({
      name: `file-${i}.parquet`,
      bytes: data.length,
      sha256: hash(data),
    })),
    raw = Buffer.from(
      JSON.stringify({ version: "1", snapshotId: "synthetic", files }),
    );
  let active = 0,
    maximum = 0,
    reads = 0;
  try {
    const directory = await verifiedSnapshotCache({
      prefix: "parallel/",
      manifestDigest: hash(raw),
      cacheRoot: root,
      reader: {
        read: async (key) => {
          if (key.endsWith("artifact-manifest.json")) return raw;
          active++;
          reads++;
          maximum = Math.max(maximum, active);
          await new Promise((resolve) => setImmediate(resolve));
          active--;
          return data;
        },
      },
    });
    expect(maximum).toBe(3);
    expect(reads).toBe(6);
    for (const file of files)
      expect(await readFile(path.join(directory, file.name))).toEqual(data);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("drains all in-flight reads and writes before removing a failed partial cache", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-cache-drain-")),
    data = Buffer.from("synthetic"),
    hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex"),
    files = ["a.parquet", "b.parquet", "c.parquet", "d.parquet"].map(
      (name) => ({ name, bytes: data.length, sha256: hash(data) }),
    ),
    raw = Buffer.from(
      JSON.stringify({ version: "1", snapshotId: "synthetic", files }),
    );
  let started = 0,
    finished = false,
    releaseB = () => {},
    releaseC = () => {},
    allStarted = () => {};
  const startedPromise = new Promise<void>((resolve) => (allStarted = resolve)),
    heldB = new Promise<void>((resolve) => (releaseB = resolve)),
    heldC = new Promise<void>((resolve) => (releaseC = resolve));
  const operation = verifiedSnapshotCache({
    prefix: "drain/",
    manifestDigest: hash(raw),
    cacheRoot: root,
    reader: {
      read: async (key) => {
        if (key.endsWith("artifact-manifest.json")) return raw;
        started++;
        if (started === 3) allStarted();
        if (key.endsWith("a.parquet"))
          throw new Error("synthetic fetch failure");
        await (key.endsWith("b.parquet") ? heldB : heldC);
        return data;
      },
    },
  }).then(
    () => {
      finished = true;
      return null;
    },
    (error) => {
      finished = true;
      return error as Error;
    },
  );
  try {
    await startedPromise;
    await new Promise((resolve) => setImmediate(resolve));
    expect(finished).toBe(false);
    expect((await readdir(root)).some((x) => x.startsWith(".partial-"))).toBe(
      true,
    );
    releaseB();
    await new Promise((resolve) => setImmediate(resolve));
    expect(finished).toBe(false);
    releaseC();
    expect((await operation)?.message).toBe("synthetic fetch failure");
    expect(started).toBe(3);
    expect(await readdir(root)).toEqual([]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(await readdir(root)).toEqual([]);
  } finally {
    releaseB();
    releaseC();
    await operation;
    await rm(root, { recursive: true, force: true });
  }
});
it("never accepts private manifest versions on the public cache path", async () => {
  const root = await mkdtemp(
      path.join(tmpdir(), "prism-cache-public-version-"),
    ),
    raw = Buffer.from(
      JSON.stringify({
        version: "3",
        snapshotId: "synthetic",
        files: [
          {
            name: "source.parquet",
            bytes: 0,
            sha256: createHash("sha256").update("").digest("hex"),
          },
        ],
      }),
    );
  try {
    await expect(
      verifiedSnapshotCache({
        prefix: "public/",
        manifestDigest: createHash("sha256").update(raw).digest("hex"),
        cacheRoot: root,
        validateManifest: () => {},
        reader: { read: async () => raw },
      }),
    ).rejects.toThrow("manifest rejected");
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
