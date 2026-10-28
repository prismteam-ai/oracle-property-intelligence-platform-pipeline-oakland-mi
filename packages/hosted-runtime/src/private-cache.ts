import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  S3ObjectReader,
  verifiedSnapshotCache,
  type ObjectReader,
} from "./snapshot-cache.ts";
import { stableJson, sha256 } from "../../county/src/model.ts";
import {
  FULL_SOURCE_DEFINITIONS,
  type FullSourceRole,
  type FullSourceConfig,
} from "../../county/src/private-full-source.ts";
export interface PrivateFile {
  name:
    | "owner-derivatives.parquet"
    | "protected-enrichment.parquet"
    | "protected-permits.parquet"
    | "private-source-intake.parquet"
    | "county-parcels.parquet"
    | "county-addresses.parquet"
    | "municipal-permit-source.parquet"
    | "rochester-hills-building-reports.parquet"
    | "troy-assessing-ui-source.parquet"
    | "provider-permit-observations.parquet"
    | "recorded-transfer-observations.parquet"
    | "private-source-runs.json";
  role:
    | "owner"
    | "enrichment"
    | "permits"
    | "source-intake"
    | FullSourceRole
    | "provider-permit-observations"
    | "recorded-transfer-observations"
    | "private-source-runs";
  bytes: number;
  sha256: string;
  sourceSchemaSha256?: string;
  sourceRecordCount?: number;
  sourceValidationSha256?: string;
  sourceValidatedOffline?: true;
}
export interface PrivateManifest {
  version: "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";
  publicSnapshotId: string;
  snapshotId: string;
  digest: string;
  files: PrivateFile[];
}
export function validatePrivateManifest(
  value: unknown,
  publicSnapshotId: string,
): asserts value is PrivateManifest {
  const m = value as PrivateManifest;
  if (
    !/^oakland-real-[a-f0-9]{20}$/.test(publicSnapshotId) ||
    !m ||
    Object.keys(m).some(
      (k) =>
        ![
          "version",
          "publicSnapshotId",
          "snapshotId",
          "digest",
          "files",
        ].includes(k),
    ) ||
    !["1", "2", "3", "4", "5", "6", "7", "8"].includes(m.version) ||
    m.publicSnapshotId !== publicSnapshotId ||
    m.snapshotId !== publicSnapshotId ||
    !Array.isArray(m.files) ||
    (m.version === "8"
      ? m.files.length !== 12
      : m.version === "7"
        ? m.files.length !== 9
        : m.version === "6"
          ? m.files.length !== 8
          : m.version === "5"
            ? m.files.length !== 7
            : m.version === "4"
              ? m.files.length !== 6
              : m.files.length !==
                (m.version === "3" ? 4 : m.version === "2" ? 3 : 2))
  )
    throw new Error("Protected manifest snapshot/shape rejected");
  const names = new Set<string>(),
    roles = new Set<string>();
  for (const f of m.files) {
    const full =
      f && Object.hasOwn(FULL_SOURCE_DEFINITIONS, f.role)
        ? FULL_SOURCE_DEFINITIONS[f.role as FullSourceRole]
        : null;
    if (
      !f ||
      Object.keys(f).some(
        (k) =>
          ![
            "name",
            "role",
            "bytes",
            "sha256",
            ...(full && ["4", "5", "6", "7", "8"].includes(m.version)
              ? [
                  "sourceSchemaSha256",
                  "sourceRecordCount",
                  "sourceValidationSha256",
                  "sourceValidatedOffline",
                ]
              : []),
          ].includes(k),
      ) ||
      (f.role === "owner"
        ? f.name !== "owner-derivatives.parquet"
        : f.role === "enrichment"
          ? f.name !== "protected-enrichment.parquet"
          : f.role === "permits" &&
              ["2", "3", "4", "5", "6", "7", "8"].includes(m.version)
            ? f.name !== "protected-permits.parquet"
            : f.role === "source-intake" &&
                ["3", "4", "5", "6", "7", "8"].includes(m.version)
              ? f.name !== "private-source-intake.parquet"
              : m.version === "8" &&
                  [
                    "provider-permit-observations",
                    "recorded-transfer-observations",
                    "private-source-runs",
                  ].includes(f.role)
                ? f.name !==
                  (
                    {
                      "provider-permit-observations":
                        "provider-permit-observations.parquet",
                      "recorded-transfer-observations":
                        "recorded-transfer-observations.parquet",
                      "private-source-runs": "private-source-runs.json",
                    } as Record<string, string>
                  )[f.role]
                : full && ["4", "5", "6", "7", "8"].includes(m.version)
                  ? f.name !== full.name
                  : true) ||
      names.has(f.name) ||
      roles.has(f.role) ||
      !Number.isSafeInteger(f.bytes) ||
      f.bytes < 0 ||
      f.bytes > 128 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(f.sha256) ||
      (full &&
        (!Number.isSafeInteger(f.sourceRecordCount) ||
          f.sourceRecordCount! < 0 ||
          f.sourceRecordCount! > full.maximum ||
          !/^[a-f0-9]{64}$/.test(f.sourceSchemaSha256 ?? "") ||
          !/^[a-f0-9]{64}$/.test(f.sourceValidationSha256 ?? "") ||
          f.sourceValidatedOffline !== true))
    )
      throw new Error("Protected file role/name/size rejected");
    names.add(f.name);
    roles.add(f.role);
  }
  if (
    ["4", "5", "6", "7", "8"].includes(m.version) &&
    (!roles.has("owner") ||
      !roles.has("enrichment") ||
      !roles.has("permits") ||
      !roles.has("source-intake") ||
      !roles.has("county-parcels") ||
      !roles.has("county-addresses") ||
      (["5", "6", "7", "8"].includes(m.version) &&
        !roles.has("municipal-source")) ||
      (["6", "7", "8"].includes(m.version) && !roles.has("rochester-source")) ||
      (["7", "8"].includes(m.version) && !roles.has("assessment-source")) ||
      (m.version === "8" &&
        [
          "provider-permit-observations",
          "recorded-transfer-observations",
          "private-source-runs",
        ].some((role) => !roles.has(role))) ||
      m.files
        .filter((f) => ["county-parcels", "county-addresses"].includes(f.role))
        .reduce((n, f) => n + f.sourceRecordCount!, 0) > 1_200_000)
  )
    throw new Error("Protected exact versioned role/count set rejected");
  const canonical = [...m.files].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  if (m.digest !== sha256(stableJson(canonical)))
    throw new Error("Protected canonical manifest digest rejected");
}
export async function loadPrivateCache(options: {
  publicSnapshotId: string;
  reader: ObjectReader;
  prefix: string;
  manifestDigest: string;
  cacheRoot: string;
}) {
  const directory = await verifiedSnapshotCache({
    ...options,
    manifestName: "private-operational-manifest.json",
    validateManifest: (value) =>
      validatePrivateManifest(value, options.publicSnapshotId),
  });
  const m = JSON.parse(
    await readFile(
      path.join(directory, "private-operational-manifest.json"),
      "utf8",
    ),
  ) as PrivateManifest;
  const owner = m.files.find((f) => f.role === "owner")!,
    enrichment = m.files.find((f) => f.role === "enrichment")!,
    permits = m.files.find((f) => f.role === "permits"),
    intake = m.files.find((f) => f.role === "source-intake");
  return {
    ownerFile: path.join(directory, owner.name),
    ownerSha256: owner.sha256,
    enrichmentFile: path.join(directory, enrichment.name),
    enrichmentSha256: enrichment.sha256,
    permitsFile: permits ? path.join(directory, permits.name) : undefined,
    permitsSha256: permits?.sha256,
    sourceIntakeFile: intake ? path.join(directory, intake.name) : undefined,
    sourceIntakeSha256: intake?.sha256,
    sourceObservations: Object.fromEntries(
      m.files
        .filter((f) =>
          [
            "provider-permit-observations",
            "recorded-transfer-observations",
            "private-source-runs",
          ].includes(f.role),
        )
        .map((f) => [
          f.role,
          { file: path.join(directory, f.name), sha256: f.sha256 },
        ]),
    ) as Record<string, { file: string; sha256: string }>,
    fullSources: m.files
      .filter((f) => Object.hasOwn(FULL_SOURCE_DEFINITIONS, f.role))
      .map(
        (f) =>
          ({
            role: f.role as FullSourceRole,
            file: path.join(directory, f.name),
            sha256: f.sha256,
            sourceSchemaSha256: f.sourceSchemaSha256!,
            sourceRecordCount: f.sourceRecordCount!,
            sourceValidationSha256: f.sourceValidationSha256!,
            sourceValidatedOffline: true,
          }) satisfies FullSourceConfig,
      ),
  };
}
export async function preparePrivateCache(publicSnapshotId: string) {
  if (process.env.PRISM_ENABLE_PROTECTED_VIEW !== "1") return;
  const bucket = process.env.PRISM_PRIVATE_SNAPSHOT_BUCKET,
    prefix = process.env.PRISM_PRIVATE_SNAPSHOT_PREFIX,
    manifestDigest = process.env.PRISM_PRIVATE_SNAPSHOT_MANIFEST_SHA256;
  if (
    !bucket ||
    !prefix ||
    !manifestDigest ||
    process.env.PRISM_REQUIRE_AUTH !== "1"
  )
    throw new Error(
      "Protected cache requires explicit authenticated configuration",
    );
  const prepared = await loadPrivateCache({
    publicSnapshotId,
    reader: new S3ObjectReader(bucket),
    prefix,
    manifestDigest,
    cacheRoot: "/tmp/prism-private-snapshots",
  });
  process.env.PRISM_OWNER_DERIVATIVES = prepared.ownerFile;
  process.env.PRISM_OWNER_DERIVATIVES_SHA256 = prepared.ownerSha256;
  process.env.PRISM_PRIVATE_ENRICHMENT = prepared.enrichmentFile;
  process.env.PRISM_PRIVATE_ENRICHMENT_SHA256 = prepared.enrichmentSha256;
  if (prepared.permitsFile) {
    process.env.PRISM_PRIVATE_PERMITS = prepared.permitsFile;
    process.env.PRISM_PRIVATE_PERMITS_SHA256 = prepared.permitsSha256;
  } else {
    delete process.env.PRISM_PRIVATE_PERMITS;
    delete process.env.PRISM_PRIVATE_PERMITS_SHA256;
  }
  if (prepared.sourceIntakeFile) {
    process.env.PRISM_PRIVATE_SOURCE_INTAKE = prepared.sourceIntakeFile;
    process.env.PRISM_PRIVATE_SOURCE_INTAKE_SHA256 =
      prepared.sourceIntakeSha256;
  } else {
    delete process.env.PRISM_PRIVATE_SOURCE_INTAKE;
    delete process.env.PRISM_PRIVATE_SOURCE_INTAKE_SHA256;
  }
  for (const [role, variable] of Object.entries({
    "provider-permit-observations": "PRISM_PRIVATE_PROVIDER_OBSERVATIONS",
    "recorded-transfer-observations": "PRISM_PRIVATE_TRANSFER_OBSERVATIONS",
    "private-source-runs": "PRISM_PRIVATE_SOURCE_RUNS",
  })) {
    const file = prepared.sourceObservations[role];
    if (file) {
      process.env[variable] = file.file;
      process.env[variable + "_SHA256"] = file.sha256;
    } else {
      delete process.env[variable];
      delete process.env[variable + "_SHA256"];
    }
  }
  process.env.PRISM_PRIVATE_FULL_SOURCES = JSON.stringify(prepared.fullSources);
}
