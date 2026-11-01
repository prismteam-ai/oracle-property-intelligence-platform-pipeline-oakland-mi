import { expect, it } from "vitest";
import { validatePrivateManifest } from "../packages/hosted-runtime/src/private-cache.ts";
import { privateEmulationEnvironment } from "../packages/hosted-runtime/src/private-emulation-env.ts";
import { FULL_SOURCE_DEFINITIONS } from "../packages/county/src/private-full-source.ts";
import { sha256, stableJson } from "../packages/county/src/model.ts";
it("v8 binds exactly nine preserved roles and three new observation/run roles with no public export role", () => {
  const snapshot = "oakland-real-" + "a".repeat(20);
  const basic = [
    ["owner", "owner-derivatives.parquet"],
    ["enrichment", "protected-enrichment.parquet"],
    ["permits", "protected-permits.parquet"],
    ["source-intake", "private-source-intake.parquet"],
    ["provider-permit-observations", "provider-permit-observations.parquet"],
    [
      "recorded-transfer-observations",
      "recorded-transfer-observations.parquet",
    ],
    ["private-source-runs", "private-source-runs.json"],
  ].map(([role, name]) => ({ role, name, bytes: 1, sha256: "b".repeat(64) }));
  const full = Object.entries(FULL_SOURCE_DEFINITIONS).map(([role, def]) => ({
    role,
    name: def.name,
    bytes: 1,
    sha256: "c".repeat(64),
    sourceSchemaSha256: "d".repeat(64),
    sourceRecordCount: 1,
    sourceValidationSha256: "e".repeat(64),
    sourceValidatedOffline: true,
  }));
  const files = [...basic, ...full];
  const make = (input: typeof files) => ({
    version: "8",
    publicSnapshotId: snapshot,
    snapshotId: snapshot,
    files: input,
    digest: sha256(
      stableJson(
        [...input].sort((a, b) =>
          a.name! < b.name! ? -1 : a.name! > b.name! ? 1 : 0,
        ),
      ),
    ),
  });
  const manifest = make(files);
  validatePrivateManifest(manifest, snapshot);
  const env = privateEmulationEnvironment(manifest);
  expect(env.PRISM_PRIVATE_PROVIDER_OBSERVATIONS).toBe(
    "/protected/provider-permit-observations.parquet",
  );
  expect(env.PRISM_PRIVATE_TRANSFER_OBSERVATIONS).toBe(
    "/protected/recorded-transfer-observations.parquet",
  );
  expect(env.PRISM_PRIVATE_SOURCE_RUNS).toBe(
    "/protected/private-source-runs.json",
  );
  for (const invalid of [
    { ...manifest, version: "7" },
    make(files.slice(1)),
    make([...files.slice(1), files[1]!]),
    make(
      files.map((f) =>
        f.role === "private-source-runs"
          ? { ...f, name: "public-source-runs.json" }
          : f,
      ),
    ),
    make(
      files.map((f) =>
        f.role === "private-source-runs" ? { ...f, sourceRecordCount: 149 } : f,
      ),
    ),
    make(
      files.map((f) =>
        f.role === "assessment-source"
          ? { ...f, sourceValidatedOffline: false }
          : f,
      ),
    ),
  ])
    expect(() => validatePrivateManifest(invalid, snapshot)).toThrow();
});
