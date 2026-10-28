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
it("v3 pins exactly four private roles and keeps source intake forbidden in historical versions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-private-v3-")),
    base = "oakland-real-" + "c".repeat(20),
    data = Buffer.from("synthetic-private");
  const files = [
    { name: "owner-derivatives.parquet", role: "owner" },
    { name: "protected-enrichment.parquet", role: "enrichment" },
    { name: "protected-permits.parquet", role: "permits" },
    { name: "private-source-intake.parquet", role: "source-intake" },
  ].map((f) => ({ ...f, bytes: data.length, sha256: sha256(data) }));
  const canonical = [...files].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    ),
    manifest = {
      version: "3",
      publicSnapshotId: base,
      snapshotId: base,
      digest: sha256(stableJson(canonical)),
      files,
    };
  expect(() => validatePrivateManifest(manifest, base)).not.toThrow();
  for (const invalid of [
    { ...manifest, version: "2" },
    { ...manifest, files: files.slice(0, 3) },
    { ...manifest, files: [...files, { ...files[3] }] },
  ])
    expect(() => validatePrivateManifest(invalid, base)).toThrow();
  const raw = Buffer.from(JSON.stringify(manifest));
  try {
    const prepared = await loadPrivateCache({
      publicSnapshotId: base,
      reader: {
        read: async (key) =>
          key.endsWith("private-operational-manifest.json") ? raw : data,
      },
      prefix: "private/v3/",
      manifestDigest: sha256(raw),
      cacheRoot: root,
    });
    expect(prepared.sourceIntakeFile).toContain(
      "private-source-intake.parquet",
    );
    expect(prepared.sourceIntakeSha256).toBe(sha256(data));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("v4 pins exactly six roles and offline schema/count/proof metadata for full county views", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-private-v4-")),
    base = "oakland-real-" + "d".repeat(20),
    data = Buffer.from("synthetic-private"),
    baseFiles = [
      { name: "owner-derivatives.parquet", role: "owner" },
      { name: "protected-enrichment.parquet", role: "enrichment" },
      { name: "protected-permits.parquet", role: "permits" },
      { name: "private-source-intake.parquet", role: "source-intake" },
    ].map((f) => ({ ...f, bytes: data.length, sha256: sha256(data) })),
    countyFiles = [
      { name: "county-parcels.parquet", role: "county-parcels" },
      { name: "county-addresses.parquet", role: "county-addresses" },
    ].map((f) => ({
      ...f,
      bytes: data.length,
      sha256: sha256(data),
      sourceSchemaSha256: sha256("synthetic-schema"),
      sourceRecordCount: 2,
      sourceValidationSha256: sha256("synthetic-offline-proof"),
      sourceValidatedOffline: true,
    })),
    files = [...baseFiles, ...countyFiles],
    canonical = [...files].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    ),
    manifest = {
      version: "4",
      publicSnapshotId: base,
      snapshotId: base,
      digest: sha256(stableJson(canonical)),
      files,
    };
  expect(() => validatePrivateManifest(manifest, base)).not.toThrow();
  for (const invalid of [
    { ...manifest, version: "3" },
    { ...manifest, files: files.slice(0, 5) },
    {
      ...manifest,
      files: [
        ...files,
        {
          ...countyFiles[0],
          name: "novi-footprints.parquet",
          role: "novi-footprints",
        },
      ],
    },
    {
      ...manifest,
      files: [
        ...baseFiles,
        { ...countyFiles[0], sourceValidatedOffline: false },
        countyFiles[1],
      ],
    },
    {
      ...manifest,
      files: [
        ...baseFiles,
        { ...countyFiles[0], sourceSchemaSha256: "unknown" },
        countyFiles[1],
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
      prefix: "private/v4/",
      manifestDigest: sha256(raw),
      cacheRoot: root,
    });
    expect(ready.fullSources).toHaveLength(2);
    expect(ready.fullSources[0]).toMatchObject({
      role: "county-parcels",
      sourceRecordCount: 2,
      sourceValidatedOffline: true,
    });
    expect(ready.fullSources[0]?.file).toContain("county-parcels.parquet");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
