import { it, expect } from "vitest";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FULL_SOURCE_DEFINITIONS } from "../packages/county/src/private-full-source.ts";
import { sha256, stableJson } from "../packages/county/src/model.ts";
import {
  loadPrivateCache,
  validatePrivateManifest,
} from "../packages/hosted-runtime/src/private-cache.ts";
import { verifiedSnapshotCache } from "../packages/hosted-runtime/src/snapshot-cache.ts";

function fixture() {
  const publicSnapshotId = "oakland-real-" + "a".repeat(20);
  const base = [
    { name: "owner-derivatives.parquet", role: "owner" },
    { name: "protected-enrichment.parquet", role: "enrichment" },
    { name: "protected-permits.parquet", role: "permits" },
    { name: "private-source-intake.parquet", role: "source-intake" },
    {
      name: "provider-permit-observations.parquet",
      role: "provider-permit-observations",
    },
    {
      name: "recorded-transfer-observations.parquet",
      role: "recorded-transfer-observations",
    },
    { name: "private-source-runs.json", role: "private-source-runs" },
  ];
  const full = Object.entries(FULL_SOURCE_DEFINITIONS).map(([role, d]) => ({
    name: d.name,
    role,
    sourceSchemaSha256: sha256("synthetic-schema"),
    sourceRecordCount: 0,
    sourceValidationSha256: sha256("synthetic-proof"),
    sourceValidatedOffline: true,
  }));
  const objects = new Map<string, Buffer>();
  const files = [...base, ...full].map((f) => {
    const data = Buffer.from("synthetic-cache-bytes-" + f.role);
    objects.set(f.name, data);
    return { ...f, bytes: data.length, sha256: sha256(data) };
  });
  const manifest = {
    version: "8",
    publicSnapshotId,
    snapshotId: publicSnapshotId,
    digest: sha256(
      stableJson(
        [...files].sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        ),
      ),
    ),
    files,
  };
  validatePrivateManifest(manifest, publicSnapshotId);
  const raw = Buffer.from(JSON.stringify(manifest));
  objects.set("private-operational-manifest.json", raw);
  return { publicSnapshotId, manifest, objects, raw };
}
it("v8 cold/warm cache admits all twelve exact roles through outer and actual private validation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-v8-cache-")),
    f = fixture();
  let reads = 0;
  const opts = {
    publicSnapshotId: f.publicSnapshotId,
    prefix: "private/v8/",
    manifestDigest: sha256(f.raw),
    cacheRoot: root,
    reader: {
      read: async (key: string, maxBytes: number) => {
        reads++;
        expect(key.startsWith("private/v8/")).toBe(true);
        const data = f.objects.get(key.slice("private/v8/".length));
        if (!data || data.length > maxBytes)
          throw new Error("Synthetic reader bounds");
        return data;
      },
    },
  };
  try {
    const ready = await loadPrivateCache(opts);
    expect(reads).toBe(13);
    expect(ready.fullSources).toHaveLength(5);
    expect(Object.keys(ready.sourceObservations)).toHaveLength(3);
    for (const file of f.manifest.files)
      expect(
        await readFile(path.join(root, opts.manifestDigest, file.name)),
      ).toEqual(f.objects.get(file.name));
    expect(await loadPrivateCache(opts)).toEqual(ready);
    expect(reads).toBe(13);
    await writeFile(
      ready.sourceObservations["provider-permit-observations"]!.file,
      "corrupt",
    );
    expect(await loadPrivateCache(opts)).toEqual(ready);
    expect(reads).toBe(26);
    expect((await readdir(root)).some((n) => n.startsWith(".partial-"))).toBe(
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("v8 remains forbidden for public paths and private paths without actual validator", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-v8-cache-denied-")),
    f = fixture();
  let dataReads = 0;
  const reader = {
    read: async (key: string) => {
      if (!key.endsWith("manifest.json")) dataReads++;
      return f.raw;
    },
  };
  try {
    for (const options of [
      {
        validateManifest: (value: unknown) =>
          validatePrivateManifest(value, f.publicSnapshotId),
      },
      { manifestName: "private-operational-manifest.json" as const },
    ])
      await expect(
        verifiedSnapshotCache({
          reader,
          prefix: "v8/",
          manifestDigest: sha256(f.raw),
          cacheRoot: root,
          ...options,
        }),
      ).rejects.toThrow("manifest rejected");
    expect(dataReads).toBe(0);
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("v8 still rejects invalid inner role/digest before any file is downloaded", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-v8-cache-inner-")),
    f = fixture();
  let reads = 0;
  const raw = Buffer.from(
    JSON.stringify({ ...f.manifest, files: f.manifest.files.slice(0, 11) }),
  );
  try {
    await expect(
      loadPrivateCache({
        publicSnapshotId: f.publicSnapshotId,
        prefix: "v8/",
        manifestDigest: sha256(raw),
        cacheRoot: root,
        reader: {
          read: async () => {
            reads++;
            return raw;
          },
        },
      }),
    ).rejects.toThrow("Protected manifest snapshot/shape rejected");
    expect(reads).toBe(1);
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
