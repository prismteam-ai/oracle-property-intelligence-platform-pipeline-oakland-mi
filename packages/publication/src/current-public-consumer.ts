import { mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { DuckDBInstance } from "@duckdb/node-api";
import { CID } from "multiformats/cid";
import { publicFileDigest } from "./current-public-car.ts";

type PublicIndex = {
  version: string;
  files: { name: string; cid: string; bytes: number; sha256: string }[];
};
function indexFromBytes(raw: Uint8Array): PublicIndex {
  const value = JSON.parse(Buffer.from(raw).toString()) as PublicIndex;
  if (
    value.version !== "p13-public-payload-index-v1" ||
    !Array.isArray(value.files) ||
    value.files.length > 64 ||
    new Set(value.files.map((file) => file.name)).size !== value.files.length ||
    value.files.some(
      (file) =>
        !/^[a-z0-9][a-z0-9.-]+$/.test(file.name) ||
        !/^[a-f0-9]{64}$/.test(file.sha256) ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 0 ||
        file.bytes > 1024 ** 3,
    )
  )
    throw new Error("Current public index rejected");
  for (const file of value.files)
    if (CID.parse(file.cid).version !== 1) throw new Error("CIDv1 required");
  return value;
}
async function boundedBytes(response: Response, maximum: number) {
  if (!response.body) throw new Error("Public response body missing");
  const parts: Uint8Array[] = [];
  let bytes = 0;
  for await (const part of response.body) {
    bytes += part.length;
    if (bytes > maximum) throw new Error("Public index exceeds byte bound");
    parts.push(part);
  }
  return Buffer.concat(parts);
}
/** Public GETs only; no auth, cookies, cloud SDKs, retries or Oracle API. */
export async function fetchCurrentPublicDatabase(options: {
  indexUrl: string;
  indexSha256: string;
  outputDirectory: string;
  fetchImpl?: typeof fetch;
}) {
  const url = new URL(options.indexUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.pathname.endsWith("/artifact-index.json") ||
    !/^[a-f0-9]{64}$/.test(options.indexSha256)
  )
    throw new Error("Pinned public index URL/digest required");
  const request = options.fetchImpl ?? fetch;
  const response = await request(url, {
    signal: AbortSignal.timeout(60000),
    credentials: "omit",
    redirect: "error",
  });
  if (!response.ok) throw new Error("Public index fetch failed");
  const indexBytes = await boundedBytes(response, 1024 ** 2);
  if (
    indexBytes.length > 1024 ** 2 ||
    createHash("sha256").update(indexBytes).digest("hex") !==
      options.indexSha256
  )
    throw new Error("Public index digest mismatch");
  const index = indexFromBytes(indexBytes);
  const file = index.files.find(
    (entry) => entry.name === "oakland-public.duckdb",
  );
  if (!file) throw new Error("Standalone database absent from index");
  await mkdir(options.outputDirectory, { mode: 0o700 });
  let actualBytes = 0;
  const hash = createHash("sha256");
  const fileUrl = new URL(file.name, response.url || url);
  try {
    const target = await open(
      path.join(options.outputDirectory, file.name),
      "wx",
      0o600,
    );
    try {
      const result = await request(fileUrl, {
        signal: AbortSignal.timeout(180000),
        credentials: "omit",
        redirect: "error",
      });
      if (!result.ok || !result.body)
        throw new Error("Public database fetch failed");
      for await (const part of result.body) {
        actualBytes += part.length;
        if (actualBytes > file.bytes)
          throw new Error("Public database exceeds declared bytes");
        hash.update(part);
        await target.writeFile(part);
      }
    } finally {
      await target.close();
    }
    const actualSha256 = hash.digest("hex");
    if (actualBytes !== file.bytes || actualSha256 !== file.sha256)
      throw new Error("Public database digest/size mismatch");
    const indexFile = await open(
      path.join(options.outputDirectory, "artifact-index.json"),
      "wx",
      0o600,
    );
    try {
      await indexFile.writeFile(indexBytes);
    } finally {
      await indexFile.close();
    }
    return {
      indexUrl: url.toString(),
      indexSha256: options.indexSha256,
      databaseUrl: fileUrl.toString(),
      bytes: actualBytes,
      sha256: actualSha256,
      authenticated: false,
      automaticRetry: false,
    };
  } catch (error) {
    await rm(options.outputDirectory, { recursive: true, force: true });
    throw error;
  }
}
/** An ordinary analytical client, not a locally hosted candidate application. */
export async function queryCurrentPublicDatabase(directory: string) {
  const index = indexFromBytes(
    await readFile(path.join(directory, "artifact-index.json")),
  );
  const file = index.files.find(
    (entry) => entry.name === "oakland-public.duckdb",
  );
  if (!file) throw new Error("Standalone database absent");
  const actual = await publicFileDigest(path.join(directory, file.name));
  if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256)
    throw new Error("Local public database identity mismatch");
  const instance = await DuckDBInstance.create(
    path.join(directory, file.name),
    {
      access_mode: "READ_ONLY",
      enable_external_access: "false",
      threads: "1",
      memory_limit: "512MB",
    },
  );
  const connection = await instance.connect();
  try {
    await connection.run("SET lock_configuration=true");
    const queries = {
      noviRoofs:
        "SELECT count(*) AS matches FROM roofs_within(42.4806,-83.4755,8046.72,15)",
      noviOfficialCityRoofs:
        "SELECT count(*) AS matches FROM roofs_within(42.4810994939,-83.4950218553,8046.72,15)",
      noviRows:
        "SELECT id,pin,built_year,roof_proxy_age_years,roof_age_basis,distance_meters FROM roofs_within(42.4806,-83.4755,8046.72,15) ORDER BY distance_meters,id LIMIT 5",
      strictTroyOpen:
        "SELECT count(*) AS matches FROM permits_within(42.5790196146,-83.1483459216,8046.72,'confirmed_open',5,0)",
      troyVerification:
        "SELECT count(*) AS matches FROM permits_within(42.5790196146,-83.1483459216,8046.72,'status_verification_needed',5,0)",
      outOfAreaOwners:
        "SELECT count(*) AS matches FROM owners_within(42.4806,-83.4755,8046.72,'out_of_area')",
      troyRegionalOwners:
        "SELECT count(*) AS matches FROM owners_within(42.5790196146,-83.1483459216,8046.72,'regional')",
      qualifiedDeedGaps:
        "SELECT count(*) AS matches FROM deed_gaps_within(42.4806,-83.4755,8046.72,10)",
      qualifiedTroyDeedGaps:
        "SELECT count(*) AS matches FROM deed_gaps_within(42.5790196146,-83.1483459216,8046.72,10)",
      officialSourceCounts:
        "SELECT source_id,count(*) AS rows FROM source_row_dispositions GROUP BY source_id ORDER BY source_id",
      reviewedInlineObservations:
        "SELECT property_id,source_id,native_id,record_digest,observation_json FROM official_inline_observations ORDER BY native_id",
      sourceBacking:
        "SELECT source_id,native_id,record_digest,observed_at FROM source_row_dispositions ORDER BY source_id,native_id LIMIT 5",
    };
    const results: Record<string, unknown> = {};
    for (const [name, sql] of Object.entries(queries))
      results[name] = {
        sql,
        rows: await (await connection.run(sql)).getRowObjectsJson(),
      };
    return {
      version: "p13-clean-public-duckdb-consumer-v1",
      database: actual,
      databaseVersion: await (
        await connection.run("SELECT version() AS version")
      ).getRowObjectsJson(),
      sourceNetworkRequiredDuringQueries: false,
      oracleApiRequired: false,
      awsCredentialsRequired: false,
      readOnly: true,
      results,
    };
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}
