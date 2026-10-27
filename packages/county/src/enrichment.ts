import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { verifySnapshotDirectory } from "../../query/src/real.ts";
import { assertPrivateDestination } from "../../receipts/src/private-paths.ts";
import { sha256 } from "./model.ts";
interface Observation {
  nativeId: string;
  sourcePin: string;
  normalizedPin: string;
  builtYear: number | null;
  saleDate: string | null;
  page: number;
  line: number;
  recordDigest: string;
}
interface OfficialSource {
  sourceId: string;
  url: string;
  bodySha256: string;
  observedAt: string;
  rights: string;
  observations: Observation[];
}
interface EnrichmentInput {
  observedAt: string;
  sources: OfficialSource[];
}
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
export async function buildProtectedEnrichment(options: {
  snapshotDirectory: string;
  inputFile: string;
  outputDirectory: string;
  protectedRoots: readonly string[];
}): Promise<Record<string, unknown>> {
  const snapshot = await verifySnapshotDirectory(options.snapshotDirectory);
  await assertPrivateDestination(options.inputFile, [
    snapshot.directory,
    ...options.protectedRoots,
  ]);
  const out = await assertPrivateDestination(options.outputDirectory, [
    snapshot.directory,
    ...options.protectedRoots,
  ]);
  await mkdir(out, { recursive: true, mode: 0o700 });
  const input = JSON.parse(
    await readFile(options.inputFile, "utf8"),
  ) as EnrichmentInput;
  const instance = await DuckDBInstance.create(":memory:", {
    threads: "1",
    memory_limit: "1GB",
  });
  const db = await instance.connect();
  try {
    await db.run(
      `CREATE TABLE parcels AS SELECT id,pin FROM read_parquet(${quote(path.join(snapshot.directory, "parcels.parquet"))})`,
    );
    await db.run(
      "CREATE TABLE source_observations(source_id VARCHAR,native_id VARCHAR,normalized_pin VARCHAR,built_year INTEGER,sale_date VARCHAR,source_url VARCHAR,receipt_digest VARCHAR,observed_at VARCHAR,page INTEGER,line INTEGER,record_digest VARCHAR,rights VARCHAR,PRIMARY KEY(source_id,native_id))",
    );
    const appender = await db.createAppender("source_observations");
    let records = 0;
    for (const source of input.sources) {
      const expectedHost =
        source.sourceId === "official-novi-residential-sales-pdf"
          ? "www.cityofnovi.org"
          : source.sourceId === "official-auburn-hills-residential-sales-pdf"
            ? "www.auburnhills.org"
            : null;
      const url = new URL(source.url);
      if (
        !expectedHost ||
        url.hostname !== expectedHost ||
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        source.rights !== "private_pending_redistribution" ||
        !/^[a-f0-9]{64}$/.test(source.bodySha256)
      )
        throw new Error("Unapproved private observation source/rights");
      const observedAt = new Date(source.observedAt).toISOString();
      for (const row of source.observations) {
        if (++records > 100000)
          throw new Error("Private observation cap exceeded");
        const normalized =
          source.sourceId === "official-novi-residential-sales-pdf"
            ? row.sourcePin.replace(/^50-/, "").replaceAll("-", "")
            : row.sourcePin.replaceAll("-", "");
        if (
          !/^\d{10}$/.test(normalized) ||
          normalized !== row.normalizedPin ||
          !row.nativeId ||
          row.nativeId.length > 300 ||
          !/^[a-f0-9]{64}$/.test(row.recordDigest)
        )
          throw new Error("Invalid source record/explicit PIN normalization");
        if (
          row.builtYear !== null &&
          (!Number.isInteger(row.builtYear) ||
            row.builtYear < 1600 ||
            row.builtYear > Number(observedAt.slice(0, 4)))
        )
          throw new Error("Invalid source-reported built year");
        if (
          row.saleDate !== null &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(row.saleDate) ||
            new Date(row.saleDate).toISOString().slice(0, 10) !==
              row.saleDate ||
            row.saleDate > observedAt.slice(0, 10))
        )
          throw new Error("Invalid reported sale date");
        const values = [
          source.sourceId,
          row.nativeId,
          row.normalizedPin,
          row.builtYear,
          row.saleDate,
          source.url,
          source.bodySha256,
          observedAt,
          row.page,
          row.line,
          row.recordDigest,
          source.rights,
        ];
        for (const v of values) {
          if (v === null) appender.appendNull();
          else if (typeof v === "number") appender.appendInteger(v);
          else appender.appendVarchar(v);
        }
        appender.endRow();
      }
    }
    appender.closeSync();
    await db.run(
      "CREATE TABLE protected_enrichment AS SELECT p.id AS property_id,s.*,$snapshotId AS public_snapshot_id FROM source_observations s JOIN parcels p ON p.pin=s.normalized_pin",
      { snapshotId: snapshot.manifest.snapshotId },
    );
    const result = (
      await (
        await db.run(
          "SELECT (SELECT count(*) FROM source_observations)::INTEGER AS observations,(SELECT count(*) FROM protected_enrichment)::INTEGER AS matched_associations,(SELECT count(DISTINCT property_id) FROM protected_enrichment)::INTEGER AS matched_properties,(SELECT count(*) FROM source_observations s WHERE NOT EXISTS(SELECT 1 FROM parcels p WHERE p.pin=s.normalized_pin))::INTEGER AS unmatched_observations,(SELECT count(*) FROM source_observations WHERE built_year IS NOT NULL)::INTEGER AS known_built_year_observations,(SELECT count(*) FROM source_observations WHERE sale_date IS NOT NULL)::INTEGER AS reported_sale_observations,(SELECT count(*) FROM (SELECT property_id FROM protected_enrichment WHERE built_year IS NOT NULL GROUP BY property_id HAVING count(DISTINCT built_year)>1))::INTEGER AS conflicting_built_year_properties",
        )
      ).getRowObjectsJson()
    )[0]!;
    const files = [];
    for (const [table, name, order] of [
      [
        "source_observations",
        "source-observations.parquet",
        "source_id,native_id",
      ],
      [
        "protected_enrichment",
        "protected-enrichment.parquet",
        "property_id,source_id,native_id",
      ],
    ] as const) {
      const p = path.join(out, name);
      await db.run(
        `COPY (SELECT * FROM ${table} ORDER BY ${order}) TO ${quote(p)} (FORMAT PARQUET,COMPRESSION ZSTD)`,
      );
      files.push({
        name,
        bytes: (await stat(p)).size,
        sha256: sha256(await readFile(p)),
      });
    }
    const summary = {
      kind: "protected-official-sales-observations",
      publicSnapshotId: snapshot.manifest.snapshotId,
      counts: result,
      files,
      sourceDigests: input.sources.map((s) => ({
        sourceId: s.sourceId,
        bodySha256: s.bodySha256,
        rights: s.rights,
      })),
      rawObservationsReturned: false,
      ownerNamePostalContactIncluded: false,
      tenureProof: false,
      limitations: [
        "Source-reported year built is only a low-confidence roof-age proxy; unobserved replacements may exist.",
        "Partial assessor sales-study cohorts are reported_sale events, not complete/latest deed history or ten-year ownership proof.",
        "Municipal redistribution rights remain unverified; all observations and parquet rows stay private.",
        "All source observations are retained, including unmatched PINs. Exact PIN matches retain all parcel associations.",
      ],
    };
    await writeFile(
      path.join(out, "summary.json"),
      JSON.stringify(summary, null, 2) + "\n",
      { mode: 0o600 },
    );
    return summary;
  } finally {
    db.closeSync();
    instance.closeSync();
  }
}
