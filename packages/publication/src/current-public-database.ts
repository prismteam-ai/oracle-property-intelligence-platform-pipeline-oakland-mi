/** Rebuild an ordinary offline DB from already hash-verified public Parquets only. */
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  access,
} from "node:fs/promises";
import { createConnection } from "node:net";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import {
  PROPERTY_VIEW_SQL,
  sha256,
  stableJson,
} from "../../county/src/model.ts";
import { quote } from "../../query/src/real-utils.ts";
import { publicFileDigest } from "./current-public-car.ts";
import { PORTABLE_QUERY_SQL } from "./current-public-snapshot.ts";
const seed = new URL("../assets/duckdb-v2-empty.seed", import.meta.url);
const seedSha256 =
  "f8e87eed513f1d5b63d01d8838f8c2322006b0cd478f2b66bd4788515693b1b6";
const physicalRelations = [
  "parcels",
  "site_addresses",
  "parcel_address_links",
  "permits",
  "assessor_observations",
  "owner_derivatives",
  "official_parcel_observations",
  "reported_owner_observations",
  "owner_location_provenance",
  "recorded_deed_observations",
  "official_inline_observations",
  "permit_signals",
  "official_source_intake_dispositions",
];
export const PUBLIC_DATABASE_RELATIONS = [
  ...physicalRelations,
  "source_row_dispositions",
  "properties",
];
const allowedEnvironment = new Set([
  "PATH",
  "LANG",
  "LC_ALL",
  "TZ",
  "TMPDIR",
  "MALLOC_PERTURB_",
  "PWD",
]);
export async function rebuildCurrentPublicDatabase(options: {
  directory: string;
  indexSha256: string;
  outputDirectory: string;
  requireIsolation?: boolean;
}) {
  if (Object.keys(process.env).some((key) => !allowedEnvironment.has(key)))
    throw new Error(
      "Standalone build requires the documented clean allowlisted process environment",
    );
  if (!/^[a-f0-9]{64}$/.test(options.indexSha256))
    throw new Error("Expected public artifact index digest required");
  let isolation:
    | {
        networkNamespace: string;
        directNetworkDenied: string;
        absentInputs: string[];
      }
    | undefined;
  if (options.requireIsolation) {
    if (process.env.PWD !== "/app")
      throw new Error("Unexpected isolated working directory");
    const forbidden = [
      "/home/al",
      "/root",
      "/repos",
      "/mnt",
      "/app/.git",
      "/app/data",
      "/app/private",
      "/app/.env",
    ];
    for (const file of forbidden) {
      try {
        await access(file);
        throw new Error("Public worker can access an excluded input root");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const directNetworkDenied = await new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: "1.1.1.1", port: 443 });
      socket.setTimeout(1000);
      socket.once("connect", () => {
        socket.destroy();
        reject(new Error("Public worker network is not isolated"));
      });
      socket.once("timeout", () => {
        socket.destroy();
        reject(new Error("Network isolation proof timed out"));
      });
      socket.once("error", (error: NodeJS.ErrnoException) => {
        socket.destroy();
        if (error.code !== "ENETUNREACH")
          reject(new Error("Network namespace denial not proven"));
        else resolve(error.code);
      });
    });
    isolation = {
      networkNamespace: await readlink("/proc/self/ns/net"),
      directNetworkDenied,
      absentInputs: forbidden,
    };
  }
  const indexBytes = await readFile(
    path.join(options.directory, "artifact-index.json"),
  );
  if (sha256(indexBytes) !== options.indexSha256)
    throw new Error("Public index hash mismatch");
  const index = JSON.parse(indexBytes.toString()) as {
    version: string;
    files: { name: string; sha256: string; bytes: number }[];
  };
  if (
    ![
      "p13-public-payload-index-v1",
      "p13-public-build-input-index-v1",
    ].includes(index.version) ||
    !Array.isArray(index.files) ||
    index.files.length > 64
  )
    throw new Error("Bounded public index required");
  const inputs: { name: string; sha256: string; bytes: number }[] = [];
  for (const relation of PUBLIC_DATABASE_RELATIONS) {
    const name = relation.replaceAll("_", "-") + ".parquet";
    const expected = index.files.filter((file) => file.name === name);
    if (
      expected.length !== 1 ||
      !/^[a-f0-9]{64}$/.test(expected[0]!.sha256) ||
      !Number.isSafeInteger(expected[0]!.bytes) ||
      expected[0]!.bytes < 0 ||
      expected[0]!.bytes > 1024 ** 3
    )
      throw new Error("Required public relation absent or invalid");
    const actual = await publicFileDigest(path.join(options.directory, name));
    if (
      actual.sha256 !== expected[0]!.sha256 ||
      actual.bytes !== expected[0]!.bytes
    )
      throw new Error("Public relation hash/size mismatch");
    inputs.push({ name, ...actual });
  }
  if (sha256(await readFile(seed)) !== seedSha256)
    throw new Error("Empty seed hash mismatch");
  await mkdir(options.outputDirectory, { mode: 0o700 });
  const target = path.join(options.outputDirectory, "oakland-public.duckdb");
  await copyFile(seed, target, constants.COPYFILE_EXCL);
  const instance = await DuckDBInstance.create(target, {
    threads: "1",
    memory_limit: "2GB",
    force_compression: "uncompressed",
    checkpoint_threshold: "4GB",
    temp_directory: options.outputDirectory,
  });
  const connection = await instance.connect();
  const verificationDirectory = await mkdtemp(
    path.join(options.outputDirectory, "relation-check-"),
  );
  const verified: {
    name: string;
    sha256: string;
    bytes: number;
    rows: string;
  }[] = [];
  let catalogProof: Record<string, unknown>;
  try {
    const version = (
      await (
        await connection.run(
          "SELECT version() AS version,(SELECT count(*) FROM duckdb_tables() WHERE NOT internal) AS tables,(SELECT count(*) FROM duckdb_views() WHERE NOT internal) AS views,(SELECT count(*) FROM duckdb_functions() WHERE NOT internal AND function_type IN ('macro','table_macro')) AS macros",
        )
      ).getRowObjectsJson()
    )[0]!;
    if (
      version.version !== "v2.0.0" ||
      Number(version.tables) ||
      Number(version.views) ||
      Number(version.macros)
    )
      throw new Error("Pinned empty database required");
    for (const relation of physicalRelations)
      await connection.run(
        `CREATE TABLE ${relation} AS SELECT * FROM read_parquet(${quote(path.join(options.directory, relation.replaceAll("_", "-") + ".parquet"))}) ORDER BY ALL`,
      );
    const dispositions = `read_parquet(${quote(path.join(options.directory, "source-row-dispositions.parquet"))})`;
    await connection.run(
      `CREATE TABLE source_row_profiles AS SELECT CAST(row_number() OVER(ORDER BY source_id,observed_at,source_schema_sha256) AS INTEGER) AS profile_id,* FROM (SELECT DISTINCT source_id,observed_at,source_schema_sha256 FROM ${dispositions}) ORDER BY profile_id`,
    );
    await connection.run(
      `CREATE TABLE source_row_entities AS SELECT p.profile_id,e.native_id,e.property_id,e.record_digest FROM ${dispositions} e JOIN source_row_profiles p ON p.source_id=e.source_id AND p.observed_at=e.observed_at AND p.source_schema_sha256 IS NOT DISTINCT FROM e.source_schema_sha256 ORDER BY p.profile_id,e.native_id`,
    );
    await connection.run(
      "CREATE VIEW source_row_dispositions AS SELECT p.source_id,e.native_id,e.property_id,e.record_digest,p.observed_at,p.source_schema_sha256 FROM source_row_entities e JOIN source_row_profiles p USING(profile_id)",
    );
    await connection.run(PROPERTY_VIEW_SQL);
    await connection.run(PORTABLE_QUERY_SQL);
    for (const relation of PUBLIC_DATABASE_RELATIONS) {
      const name = relation.replaceAll("_", "-") + ".parquet";
      const output = path.join(verificationDirectory, name);
      await connection.run(
        `COPY (SELECT * FROM ${relation} ORDER BY ALL) TO ${quote(output)} (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 122880)`,
      );
      const actual = await publicFileDigest(output);
      const expected = inputs.find((file) => file.name === name)!;
      if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes)
        throw new Error(
          "Standalone database logical relation differs from public source Parquet: " +
            relation,
        );
      const count = (
        await (
          await connection.run(`SELECT count(*) AS rows FROM ${relation}`)
        ).getRowObjectsJson()
      )[0]!.rows;
      verified.push({ name, ...actual, rows: String(count) });
      await rm(output);
    }
    const catalogTables = await (
      await connection.run(
        "SELECT table_name,sql FROM duckdb_tables() WHERE NOT internal ORDER BY table_name",
      )
    ).getRowObjectsJson();
    const catalogViews = await (
      await connection.run(
        "SELECT view_name,sql FROM duckdb_views() WHERE NOT internal ORDER BY view_name",
      )
    ).getRowObjectsJson();
    const catalogMacros = await (
      await connection.run(
        "SELECT function_name,function_type,parameters,macro_definition FROM duckdb_functions() WHERE database_name=current_database() AND function_type IN ('macro','table_macro') ORDER BY function_name",
      )
    ).getRowObjectsJson();
    const columns = await (
      await connection.run(
        "SELECT table_name,column_name,column_index,data_type,is_nullable FROM duckdb_columns() WHERE NOT internal ORDER BY table_name,column_index",
      )
    ).getRowObjectsJson();
    if (
      stableJson(catalogTables.map((row) => row.table_name)) !==
        stableJson(
          [
            ...physicalRelations,
            "source_row_entities",
            "source_row_profiles",
          ].sort(),
        ) ||
      stableJson(catalogViews.map((row) => row.view_name)) !==
        stableJson([
          "latest_reported_sales",
          "properties",
          "roof_evidence",
          "source_row_dispositions",
        ]) ||
      stableJson(catalogMacros.map((row) => row.function_name)) !==
        stableJson([
          "deed_gaps_within",
          "owners_within",
          "permits_within",
          "properties_within",
          "roofs_within",
        ])
    )
      throw new Error("Standalone public schema/catalog whitelist mismatch");
    catalogProof = {
      tables: catalogTables,
      views: catalogViews,
      macros: catalogMacros,
      columns,
    };
    await connection.run("CHECKPOINT");
  } finally {
    connection.closeSync();
    instance.closeSync();
    await rm(verificationDirectory, { recursive: true, force: true });
  }
  return {
    version: "p13-public-parquet-only-database-build-v1",
    database: await publicFileDigest(target),
    sourceIndexSha256: options.indexSha256,
    seedSha256,
    seedSource: fileURLToPath(seed),
    physicalDatabaseRecomputeDeterminismClaimed: false,
    cleanEnvironmentKeys: Object.keys(process.env).sort(),
    isolation,
    inputData:
      "Only hash-verified public Parquets; no original provider/private/AWS source files",
    logicalRelationParity: verified,
    fullCatalog: catalogProof,
    fullCatalogSha256: sha256(stableJson(catalogProof)),
    coreQueriesRequireExternalFiles: false,
    sourceNetworkRequests: 0,
    publicationEffects: 0,
  };
}
