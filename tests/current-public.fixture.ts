import { mkdtemp, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { CONTRACT_VERSION } from "../packages/contracts/src/index.ts";
import { sha256 } from "../packages/county/src/model.ts";
import type {
  CurrentPublicBuildOptions,
  PublicSourcePolicy,
} from "../packages/publication/src/current-public-snapshot.ts";

export async function currentPublicFixture() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "prism-current-public-fixture-"),
  );
  const base = path.join(root, "base");
  await mkdir(base);
  const snapshotId = "oakland-real-" + "a".repeat(20),
    digest = "b".repeat(64),
    stamp = "2026-10-28T08:00:00.000Z";
  const instance = await DuckDBInstance.create(":memory:", { threads: "1" });
  const db = await instance.connect();
  const literal = (text: string) => "'" + text.replaceAll("'", "''") + "'";
  try {
    await db.run(
      "CREATE TABLE parcels(id VARCHAR,source_id VARCHAR,native_id VARCHAR,pin VARCHAR,keypin VARCHAR,revision_date VARCHAR,jurisdiction_code VARCHAR,jurisdiction_name VARCHAR,class_code VARCHAR,address VARCHAR,city VARCHAR,state VARCHAR,postal_code VARCHAR,content_hash VARCHAR,observed_at VARCHAR)",
    );
    await db.run(
      `INSERT INTO parcels SELECT 'oakland-parcel-'||i,'oakland-tax-parcel-plus',CAST(i AS VARCHAR),'pin-'||i,NULL,NULL,'test','Synthetic town','residential','Synthetic street '||i,'Synthetic town','MI','00000','${digest}','${stamp}' FROM range(1,3) t(i)`,
    );
    await db.run(
      "CREATE TABLE site_addresses(id VARCHAR,source_id VARCHAR,native_id VARCHAR,pin VARCHAR,address VARCHAR,city VARCHAR,state VARCHAR,postal_code VARCHAR,lat DOUBLE,lng DOUBLE,content_hash VARCHAR,observed_at VARCHAR)",
    );
    await db.run(
      `INSERT INTO site_addresses SELECT 'address-'||i,'oakland-site-address',CAST(i AS VARCHAR),'pin-'||i,'Synthetic street '||i,'Synthetic town','MI','00000',42.4806,-83.4755,'${digest}','${stamp}' FROM range(1,3) t(i)`,
    );
    await db.run(
      "CREATE TABLE parcel_address_links AS SELECT 'oakland-parcel-'||i AS property_id,'address-'||i AS address_id,'exact_source_pin' AS match_basis FROM range(1,3) t(i)",
    );
    await db.run(
      "CREATE TABLE permits(property_id VARCHAR,id VARCHAR,status VARCHAR,kind VARCHAR,opened_at VARCHAR,closed_at VARCHAR,open_days INTEGER,reported_contractor VARCHAR,verified_company_id VARCHAR,license VARCHAR,rating DOUBLE,source_id VARCHAR,native_id VARCHAR,receipt_digest VARCHAR,observed_at VARCHAR)",
    );
    await db.run(
      `INSERT INTO permits VALUES('oakland-parcel-1','synthetic-closed','closed','roof_replacement',NULL,'2020-01-01',NULL,NULL,NULL,NULL,NULL,'official-troy-issued-permits','synthetic-closed','${digest}','${stamp}')`,
    );
    for (const [table, name] of [
      ["parcels", "parcels.parquet"],
      ["site_addresses", "site-addresses.parquet"],
      ["parcel_address_links", "parcel-address-links.parquet"],
      ["permits", "permits.parquet"],
    ])
      await db.run(
        `COPY ${table} TO ${literal(path.join(base, name!))} (FORMAT PARQUET,COMPRESSION ZSTD)`,
      );
    await db.run(
      "CREATE TABLE enrichment(property_id VARCHAR,source_id VARCHAR,native_id VARCHAR,built_year INTEGER,sale_date VARCHAR,receipt_digest VARCHAR,observed_at VARCHAR,page INTEGER,line INTEGER,record_digest VARCHAR,public_snapshot_id VARCHAR)",
    );
    await db.run(
      `INSERT INTO enrichment VALUES('oakland-parcel-1','official-novi-residential-sales-pdf','n1',1980,'2024-01-01','${digest}','${stamp}',1,1,'${digest}','${snapshotId}'),('oakland-parcel-2','official-novi-residential-sales-pdf','n2',2020,'2025-01-01','${digest}','${stamp}',1,2,'${digest}','${snapshotId}')`,
    );
    await db.run(
      `COPY enrichment TO ${literal(path.join(root, "enrichment.parquet"))} (FORMAT PARQUET)`,
    );
  } finally {
    db.closeSync();
    instance.closeSync();
  }
  await writeFile(
    path.join(base, "coverage.json"),
    JSON.stringify({ synthetic: true }),
  );
  await writeFile(
    path.join(base, "runs.json"),
    JSON.stringify([{ id: "synthetic-v1", state: "COMPLETE" }]),
  );
  await writeFile(
    path.join(base, "schema.json"),
    JSON.stringify({ version: CONTRACT_VERSION, synthetic: true }),
  );
  await writeFile(path.join(base, "sample.json"), "[]");
  await writeFile(
    path.join(base, "dataset-manifest.json"),
    JSON.stringify({ snapshotId, digest }),
  );
  const names = [
    "parcels.parquet",
    "site-addresses.parquet",
    "parcel-address-links.parquet",
    "permits.parquet",
    "coverage.json",
    "runs.json",
    "schema.json",
    "sample.json",
    "dataset-manifest.json",
  ];
  const files = [];
  for (const name of names)
    files.push({
      name,
      bytes: (await stat(path.join(base, name))).size,
      sha256: sha256(await readFile(path.join(base, name))),
    });
  await writeFile(
    path.join(base, "artifact-manifest.json"),
    JSON.stringify({
      version: "1",
      contractVersion: CONTRACT_VERSION,
      snapshotId,
      digest,
      count: 2,
      parcelCount: 2,
      addressCount: 2,
      files,
      limitations: ["Synthetic regression fixture, not county evidence"],
    }),
  );
  const policy = (sourceId: string): PublicSourcePolicy => ({
    sourceId,
    sourceUrl: "https://example.invalid/synthetic-fixture",
    rightsBasis: "Synthetic fixture with no real personal or provider data",
    termsSha256: null,
    evidenceSha256: digest,
    factualFields: ["synthetic"],
    classification: "synthetic_fixture",
  });
  const options: Omit<CurrentPublicBuildOptions, "outputDirectory"> = {
    baseDirectory: base,
    snapshotOptions: {
      protectedEnrichmentFile: path.join(root, "enrichment.parquet"),
      protectedEnrichmentSha256: sha256(
        await readFile(path.join(root, "enrichment.parquet")),
      ),
    },
    sourcePolicies: [
      "oakland-tax-parcel-plus",
      "oakland-site-address",
      "official-troy-issued-permits",
      "official-novi-residential-sales-pdf",
    ].map(policy),
    run: {
      id: "synthetic-public-v2",
      startedAt: stamp,
      completedAt: stamp,
      description: "Synthetic integration fixture",
    },
    priorPublications: [],
    dataKind: "synthetic-fixture",
  };
  return { root, base, options };
}
