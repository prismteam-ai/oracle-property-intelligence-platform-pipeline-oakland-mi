import { it, expect } from "vitest";
import { privateEmulationEnvironment } from "../packages/hosted-runtime/src/private-emulation-env.ts";
import type { PrivateManifest } from "../packages/hosted-runtime/src/private-cache.ts";
import { validatePrivateManifest } from "../packages/hosted-runtime/src/private-cache.ts";
import { FULL_SOURCE_DEFINITIONS } from "../packages/county/src/private-full-source.ts";
import { sha256, stableJson } from "../packages/county/src/model.ts";
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

it("maps every exact v9 role and hash into an isolated emulator without dropping the official profile", () => {
  const snapshot = "oakland-real-" + "a".repeat(20);
  const named = [
    ["owner", "owner-derivatives.parquet", "PRISM_OWNER_DERIVATIVES"],
    ["enrichment", "protected-enrichment.parquet", "PRISM_PRIVATE_ENRICHMENT"],
    ["permits", "protected-permits.parquet", "PRISM_PRIVATE_PERMITS"],
    [
      "source-intake",
      "private-source-intake.parquet",
      "PRISM_PRIVATE_SOURCE_INTAKE",
    ],
    [
      "provider-permit-observations",
      "provider-permit-observations.parquet",
      "PRISM_PRIVATE_PROVIDER_OBSERVATIONS",
    ],
    [
      "recorded-transfer-observations",
      "recorded-transfer-observations.parquet",
      "PRISM_PRIVATE_TRANSFER_OBSERVATIONS",
    ],
    [
      "private-source-runs",
      "private-source-runs.json",
      "PRISM_PRIVATE_SOURCE_RUNS",
    ],
    [
      "official-parcel-profile",
      "official-parcel-profile.json",
      "PRISM_OFFICIAL_PARCEL_PROFILE",
    ],
  ] as const;
  const full = Object.entries(FULL_SOURCE_DEFINITIONS).map(
    ([role, definition]) => ({
      role,
      name: definition.name,
      bytes: 1,
      sha256: sha256(role),
      sourceSchemaSha256: sha256("synthetic schema"),
      sourceRecordCount: 1,
      sourceValidationSha256: sha256("synthetic proof"),
      sourceValidatedOffline: true,
    }),
  );
  const files = [
    ...named.map(([role, name]) => ({
      role,
      name,
      bytes: 1,
      sha256: sha256(role),
    })),
    ...full,
  ];
  const manifest = {
    version: "9",
    publicSnapshotId: snapshot,
    snapshotId: snapshot,
    files,
    digest: sha256(
      stableJson([...files].sort((a, b) => a.name.localeCompare(b.name))),
    ),
  };
  validatePrivateManifest(manifest, snapshot);
  expect(manifest.files).toHaveLength(13);
  const before = stableJson(manifest),
    env = privateEmulationEnvironment(manifest, "/synthetic-isolated-mount");
  const expectedNames = ["PRISM_PRIVATE_FULL_SOURCES"];
  for (const [role, name, variable] of named) {
    expectedNames.push(variable, variable + "_SHA256");
    expect(env[variable]).toBe("/synthetic-isolated-mount/" + name);
    expect(env[variable + "_SHA256"]).toBe(sha256(role));
  }
  expect(Object.keys(env).sort()).toEqual(expectedNames.sort());
  const configs = JSON.parse(env.PRISM_PRIVATE_FULL_SOURCES!);
  expect(configs).toHaveLength(5);
  for (const expected of full)
    expect(configs).toContainEqual({
      role: expected.role,
      file: "/synthetic-isolated-mount/" + expected.name,
      sha256: expected.sha256,
      sourceSchemaSha256: expected.sourceSchemaSha256,
      sourceRecordCount: 1,
      sourceValidationSha256: expected.sourceValidationSha256,
      sourceValidatedOffline: true,
    });
  expect(stableJson(manifest)).toBe(before);
});
