import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadPrivateCache,
  validatePrivateManifest,
} from "../packages/hosted-runtime/src/private-cache.ts";
import { sha256, stableJson } from "../packages/county/src/model.ts";
it("pins private roles/base/hash separately, rejects extras and wrong base before files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-private-cache-")),
    base = "oakland-real-" + "a".repeat(20),
    data = Buffer.from("synthetic-private-file"),
    files = [
      {
        name: "owner-derivatives.parquet",
        role: "owner",
        bytes: data.length,
        sha256: sha256(data),
      },
      {
        name: "protected-enrichment.parquet",
        role: "enrichment",
        bytes: data.length,
        sha256: sha256(data),
      },
    ],
    manifest = {
      version: "1",
      publicSnapshotId: base,
      snapshotId: base,
      digest: sha256(stableJson(files)),
      files,
    };
  const raw = Buffer.from(JSON.stringify(manifest));
  let reads = 0;
  const opts = {
    publicSnapshotId: base,
    reader: {
      read: async (key: string) => {
        reads++;
        return key.endsWith("private-operational-manifest.json") ? raw : data;
      },
    },
    prefix: "private/v1/",
    manifestDigest: sha256(raw),
    cacheRoot: root,
  };
  try {
    const ready = await loadPrivateCache(opts);
    expect(ready.ownerSha256).toBe(sha256(data));
    expect(ready.enrichmentFile).toContain("protected-enrichment.parquet");
    await loadPrivateCache(opts);
    expect(reads).toBe(3);
    await expect(
      loadPrivateCache({ ...opts, publicSnapshotId: "different" }),
    ).rejects.toThrow("snapshot");
    expect(() =>
      validatePrivateManifest(
        {
          ...manifest,
          files: [
            ...files,
            {
              name: "raw-owner-postal.json",
              role: "owner",
              bytes: 0,
              sha256: sha256(""),
            },
          ],
        },
        base,
      ),
    ).toThrow();
    expect(() =>
      validatePrivateManifest(
        {
          ...manifest,
          files: [
            { ...files[0], name: "protected-enrichment.parquet" },
            files[1],
          ],
        },
        base,
      ),
    ).toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("v2 requires exactly owner/enrichment/permits, while v1 forbids permits and unknown metadata", async () => {
  const base = "oakland-real-" + "b".repeat(20),
    data = Buffer.from("synthetic"),
    root = await mkdtemp(path.join(tmpdir(), "prism-private-v2-"));
  const files = [
    {
      name: "owner-derivatives.parquet",
      role: "owner",
      bytes: data.length,
      sha256: sha256(data),
    },
    {
      name: "protected-enrichment.parquet",
      role: "enrichment",
      bytes: data.length,
      sha256: sha256(data),
    },
    {
      name: "protected-permits.parquet",
      role: "permits",
      bytes: data.length,
      sha256: sha256(data),
    },
  ];
  const manifest = {
    version: "2",
    publicSnapshotId: base,
    snapshotId: base,
    digest: sha256(stableJson(files)),
    files,
  };
  expect(() => validatePrivateManifest(manifest, base)).not.toThrow();
  for (const invalid of [
    { ...manifest, version: "1" },
    { ...manifest, files: files.slice(0, 2) },
    { ...manifest, rawPath: "private/raw" },
    {
      ...manifest,
      files: [
        ...files.slice(0, 2),
        { ...files[2], name: "../protected-permits.parquet" },
      ],
    },
  ])
    expect(() => validatePrivateManifest(invalid, base)).toThrow();
  const raw = Buffer.from(JSON.stringify(manifest));
  try {
    const ready = await loadPrivateCache({
      publicSnapshotId: base,
      reader: {
        read: async (key) =>
          key.endsWith("private-operational-manifest.json") ? raw : data,
      },
      prefix: "private/v2/",
      manifestDigest: sha256(raw),
      cacheRoot: root,
    });
    expect(ready.permitsSha256).toBe(sha256(data));
    expect(ready.permitsFile).toContain("protected-permits.parquet");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
