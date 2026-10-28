import { it, expect } from "vitest";
import { privateEmulationEnvironment } from "../packages/hosted-runtime/src/private-emulation-env.ts";
import type { PrivateManifest } from "../packages/hosted-runtime/src/private-cache.ts";
it("maps each v3/v4 role exactly once without overwriting enrichment with permits or raw intake", () => {
  const files = [
      {
        name: "owner-derivatives.parquet",
        role: "owner",
        bytes: 1,
        sha256: "a".repeat(64),
      },
      {
        name: "protected-enrichment.parquet",
        role: "enrichment",
        bytes: 1,
        sha256: "b".repeat(64),
      },
      {
        name: "protected-permits.parquet",
        role: "permits",
        bytes: 1,
        sha256: "c".repeat(64),
      },
      {
        name: "private-source-intake.parquet",
        role: "source-intake",
        bytes: 1,
        sha256: "d".repeat(64),
      },
    ] as PrivateManifest["files"],
    base = {
      version: "3",
      publicSnapshotId: "oakland-real-" + "a".repeat(20),
      snapshotId: "oakland-real-" + "a".repeat(20),
      digest: "e".repeat(64),
      files,
    } as PrivateManifest;
  const v3 = privateEmulationEnvironment(base);
  expect(v3.PRISM_PRIVATE_ENRICHMENT).toBe(
    "/protected/protected-enrichment.parquet",
  );
  expect(v3.PRISM_PRIVATE_ENRICHMENT_SHA256).toBe("b".repeat(64));
  expect(v3.PRISM_PRIVATE_PERMITS).toBe("/protected/protected-permits.parquet");
  expect(v3.PRISM_PRIVATE_SOURCE_INTAKE).toBe(
    "/protected/private-source-intake.parquet",
  );
  expect(JSON.parse(v3.PRISM_PRIVATE_FULL_SOURCES!)).toEqual([]);
  const rawFiles = ["county-parcels", "county-addresses"].map((role) => ({
    name: role + ".parquet",
    role,
    bytes: 1,
    sha256: "f".repeat(64),
    sourceSchemaSha256: "1".repeat(64),
    sourceRecordCount: 2,
    sourceValidationSha256: "2".repeat(64),
    sourceValidatedOffline: true,
  })) as PrivateManifest["files"];
  const v4 = privateEmulationEnvironment({
    ...base,
    version: "4",
    files: [...files, ...rawFiles],
  });
  expect(v4.PRISM_PRIVATE_ENRICHMENT).toBe(v3.PRISM_PRIVATE_ENRICHMENT);
  const full = JSON.parse(v4.PRISM_PRIVATE_FULL_SOURCES!);
  expect(full).toHaveLength(2);
  expect(full[0]).toMatchObject({
    role: "county-parcels",
    file: "/protected/county-parcels.parquet",
    sourceRecordCount: 2,
    sourceSchemaSha256: "1".repeat(64),
    sourceValidationSha256: "2".repeat(64),
    sourceValidatedOffline: true,
  });
});
