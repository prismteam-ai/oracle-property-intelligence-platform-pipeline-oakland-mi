import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import type { OfficialParcelObservation } from "../../contracts/src/index.ts";
import type { FullSourceConfig } from "./private-full-source.ts";
import {
  deriveOwnerLocation,
  OWNER_DERIVATION_VERSION,
  sha256,
} from "./model.ts";

export function assertOfficialOwnerDerivativeCompatible(
  observation: OfficialParcelObservation,
  legacy: Record<string, unknown> | undefined,
): void {
  const derived = observation.ownerLocation;
  if (
    !legacy ||
    derived.ownerRegion !== legacy.owner_region ||
    derived.locationClass !== legacy.location_class ||
    derived.siteAddressMatch !== legacy.site_address_match ||
    derived.evidenceClass !== legacy.evidence_class
  )
    throw new Error(
      "Official retained postal observation contradicts the configured owner derivative; reconcile before serving",
    );
}
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
async function pinnedFile(file: string, expected: string) {
  const s = await lstat(file);
  if (
    !/^[a-f0-9]{64}$/.test(expected) ||
    !s.isFile() ||
    s.isSymbolicLink() ||
    s.nlink !== 1 ||
    s.size > 128 * 1024 ** 2 ||
    sha256(await readFile(file)) !== expected
  )
    throw new Error("Exact bounded derivative/source file required");
}
/** Root-run full comparison, bounded native chunks; never emits rows or postal values. */
export async function compareOfficialOwnerDerivatives(options: {
  source: FullSourceConfig;
  ownerFile: string;
  ownerSha256: string;
  publicSnapshotId: string;
}) {
  const { source } = options;
  if (
    source.role !== "county-parcels" ||
    !source.sourceValidatedOffline ||
    !Number.isSafeInteger(source.sourceRecordCount) ||
    source.sourceRecordCount < 1 ||
    source.sourceRecordCount > 1_200_000
  )
    throw new Error("Bounded retained county source required");
  await pinnedFile(source.file, source.sha256);
  await pinnedFile(options.ownerFile, options.ownerSha256);
  const scratch = await mkdtemp(path.join(tmpdir(), "prism-owner-compare-"));
  const instance = await DuckDBInstance.create(":memory:", {
    threads: "1",
    memory_limit: "512MB",
    temp_directory: scratch,
    max_temp_directory_size: "512MB",
  });
  const db = await instance.connect();
  try {
    await db.run(
      `CREATE VIEW source AS SELECT * FROM read_parquet(${quote(source.file)})`,
    );
    await db.run(
      `CREATE VIEW legacy AS SELECT * FROM read_parquet(${quote(options.ownerFile)})`,
    );
    const meta = (
      await (
        await db.runAndReadAll(
          "SELECT (SELECT count(*) FROM source)::INTEGER AS source_rows,(SELECT count(DISTINCT native_id) FROM source)::INTEGER AS native_ids,(SELECT count(DISTINCT property_id) FROM source)::INTEGER AS source_properties,(SELECT count(*) FROM legacy)::INTEGER AS legacy_rows,(SELECT count(DISTINCT property_id) FROM legacy)::INTEGER AS legacy_properties,(SELECT count(*) FROM source WHERE sha256(source_record_json) IS DISTINCT FROM record_digest OR source_id IS DISTINCT FROM 'official-oakland-tax-parcel-full-attributes' OR version IS DISTINCT FROM 'county-full-attributes-v1' OR public_snapshot_id IS DISTINCT FROM $snapshot OR source_schema_sha256 IS DISTINCT FROM $schema)::INTEGER AS invalid_source,(SELECT count(*) FROM legacy WHERE public_snapshot_id IS DISTINCT FROM $snapshot OR transform_version IS DISTINCT FROM $transform)::INTEGER AS invalid_legacy",
          {
            snapshot: options.publicSnapshotId,
            schema: source.sourceSchemaSha256,
            transform: OWNER_DERIVATION_VERSION,
          },
        )
      ).getRowObjectsJson()
    )[0]!;
    if (
      Number(meta.source_rows) !== source.sourceRecordCount ||
      Number(meta.native_ids) !== source.sourceRecordCount ||
      Number(meta.source_properties) !== source.sourceRecordCount ||
      Number(meta.legacy_rows) !== Number(meta.legacy_properties) ||
      Number(meta.invalid_source) ||
      Number(meta.invalid_legacy)
    )
      throw new Error(
        "Derivative comparison count/hash/schema/snapshot/transform mismatch",
      );
    const fields = {
      ownerRegion: 0,
      locationClass: 0,
      siteAddressMatch: 0,
      evidenceClass: 0,
    };
    let comparedRows = 0,
      missingLegacyRows = 0,
      extraLegacyRows = 0,
      mismatchedRows = 0;
    const stream = await db.stream(
      "SELECT s.property_id,s.native_id,coalesce(json_extract_string(s.source_record_json,'$.OBJECTID_12'),json_extract_string(s.source_record_json,'$.OBJECTID')) AS record_native_id,json_extract_string(s.source_record_json,'$.POSTALADDRESS') AS postal,json_extract_string(s.source_record_json,'$.SITEADDRESS') AS site,json_extract_string(s.source_record_json,'$.SITECITY') AS city,o.property_id AS legacy_property,o.owner_region,o.location_class,o.site_address_match,o.evidence_class FROM source s FULL OUTER JOIN legacy o ON o.property_id=s.property_id",
    );
    try {
      for await (const rows of stream.yieldRowObjectJson()) {
        for (const row of rows) {
          if (row.property_id === null) {
            extraLegacyRows++;
            continue;
          }
          if (row.legacy_property === null) {
            missingLegacyRows++;
            continue;
          }
          if (
            row.record_native_id !== row.native_id ||
            row.property_id !== `oakland-parcel-${String(row.native_id)}`
          )
            throw new Error("Retained canonical/native association mismatch");
          const derived = deriveOwnerLocation(row.postal, row.site, row.city);
          const legacy = {
            ownerRegion: row.owner_region,
            locationClass: row.location_class,
            siteAddressMatch: row.site_address_match,
            evidenceClass: row.evidence_class,
          };
          let mismatch = false;
          for (const key of Object.keys(fields) as (keyof typeof fields)[])
            if (derived[key] !== legacy[key]) {
              fields[key]++;
              mismatch = true;
            }
          mismatchedRows += Number(mismatch);
          comparedRows++;
        }
      }
    } finally {
      stream.closeSync();
    }
    const passed =
      comparedRows === source.sourceRecordCount &&
      missingLegacyRows === 0 &&
      extraLegacyRows === 0 &&
      mismatchedRows === 0;
    return {
      version: "official-parcel-derivative-comparison-v1",
      status: passed
        ? "PASS_ALL_RETAINED_POSTAL_DERIVATIVES_MATCH"
        : "STOP_DERIVATIVE_MISMATCH_REQUIRES_RECONCILIATION",
      publicSnapshotId: options.publicSnapshotId,
      sourceFileSha256: source.sha256,
      ownerDerivativeFileSha256: options.ownerSha256,
      derivationVersion: OWNER_DERIVATION_VERSION,
      expectedSourceRows: source.sourceRecordCount,
      comparedRows,
      missingLegacyRows,
      extraLegacyRows,
      mismatchedRows,
      fieldMismatches: fields,
      fullCorpusCompared: true,
      unboundedJsArrayUsed: false,
      rowsOrPostalValuesEmitted: false,
      sourceOrDerivativeFilesChanged: false,
    };
  } finally {
    db.closeSync();
    instance.closeSync();
    await rm(scratch, { recursive: true, force: true });
  }
}
