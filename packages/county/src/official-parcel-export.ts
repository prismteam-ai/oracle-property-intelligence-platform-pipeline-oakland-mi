import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import {
  validateOfficialParcelProfile,
  type OfficialParcelProfileEnvelope,
} from "./official-parcel.ts";
import type { FullSourceConfig } from "./private-full-source.ts";
import { sha256, stableJson } from "./model.ts";
import { eligiblePublicationFields } from "../../source-profiles/src/field-authority.ts";

const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
/** A deterministic local candidate; this module contains no uploader or network client. */
export async function exportOfficialParcelCandidate(options: {
  source: FullSourceConfig;
  profile: OfficialParcelProfileEnvelope;
  outputDir: string;
}) {
  const { source, profile } = options;
  validateOfficialParcelProfile(profile, source, profile.publicSnapshotId);
  const fields = eligiblePublicationFields(profile.profile);
  if (
    !["NAME1", "NAME2", "POSTALADDRESS"].every((field) =>
      fields.includes(field),
    )
  )
    throw new Error(
      "Owner fields require source-specific publication eligibility; restricted/provider rows are not candidates",
    );
  const stat = await lstat(source.file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > 128 * 1024 ** 2 ||
    sha256(await readFile(source.file)) !== source.sha256
  )
    throw new Error("Exact bounded retained source file required");
  const outputDir = path.resolve(options.outputDir);
  await mkdir(outputDir, { mode: 0o700 });
  const scratch = path.join(outputDir, "scratch");
  await mkdir(scratch, { mode: 0o700 });
  const instance = await DuckDBInstance.create(":memory:", {
    threads: "1",
    preserve_insertion_order: "false",
    memory_limit: "512MB",
    temp_directory: scratch,
    max_temp_directory_size: "1GB",
  });
  const db = await instance.connect();
  try {
    await db.run(
      `CREATE VIEW source AS SELECT * FROM read_parquet(${quote(source.file)})`,
    );
    const fieldCounts = ["NAME1", "NAME2", "POSTALADDRESS"]
      .flatMap((field) => [
        `count(*) FILTER(WHERE coalesce(json_exists(source_record_json,'$.${field}'),false))::INTEGER AS ${field.toLowerCase()}_present`,
        `count(*) FILTER(WHERE nullif(trim(json_extract_string(source_record_json,'$.${field}')),'') IS NOT NULL)::INTEGER AS ${field.toLowerCase()}_populated`,
      ])
      .join(",");
    const counts = (
      await (
        await db.runAndReadAll(
          `SELECT count(*)::INTEGER AS rows,count(DISTINCT native_id)::INTEGER AS unique_ids,count(DISTINCT property_id)::INTEGER AS properties,count(*) FILTER(WHERE sha256(source_record_json) IS DISTINCT FROM record_digest OR source_id IS DISTINCT FROM 'official-oakland-tax-parcel-full-attributes' OR version IS DISTINCT FROM 'county-full-attributes-v1' OR public_snapshot_id IS DISTINCT FROM $snapshot OR source_schema_sha256 IS DISTINCT FROM $schema OR coalesce(json_extract_string(source_record_json,'$.OBJECTID_12'),json_extract_string(source_record_json,'$.OBJECTID')) IS DISTINCT FROM native_id OR property_id IS DISTINCT FROM ('oakland-parcel-'||native_id))::INTEGER AS invalid,${fieldCounts} FROM source`,
          {
            snapshot: profile.publicSnapshotId,
            schema: source.sourceSchemaSha256,
          },
        )
      ).getRowObjectsJson()
    )[0]!;
    if (
      Number(counts.rows) !== source.sourceRecordCount ||
      Number(counts.unique_ids) !== source.sourceRecordCount ||
      Number(counts.properties) !== source.sourceRecordCount ||
      Number(counts.invalid) !== 0
    )
      throw new Error(
        "Retained candidate count/native/record/schema/snapshot integrity mismatch",
      );
    const observedFields = (
      await (
        await db.runAndReadAll(
          `SELECT DISTINCT key FROM source,json_each(source_record_json) WHERE key IN (${fields.map(quote).join(",")}) ORDER BY key`,
        )
      ).getRowObjectsJson()
    ).map((row) => String(row.key));
    const object = `(SELECT json_group_object(key,value) FROM (SELECT key,value FROM json_each(source_record_json) WHERE key IN (${fields.map(quote).join(",")}) ORDER BY key))`;
    const selected = path.join(
      outputDir,
      "official-parcel-observations.parquet",
    );
    await db.run(
      `COPY (SELECT property_id,native_id,${quote(profile.profile.sourceId)} AS source_id,record_digest,observed_at,${quote(profile.profile.termsSha256)} AS terms_sha256,${quote(profile.fieldClassificationDigest)} AS source_profile_sha256,${object} AS official_fields_json FROM source ORDER BY native_id) TO ${quote(selected)} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 122880)`,
    );
    const bytes = await readFile(selected);
    if (bytes.length > 128 * 1024 ** 2)
      throw new Error("Candidate file exceeds declared bound");
    const manifest = {
      version: "official-parcel-publication-candidate-v1",
      state:
        "LOCAL_EXACT_BYTES_CANDIDATE_REQUIRES_HUMAN_APPROVAL_BEFORE_UPLOAD",
      uploadAuthorized: false,
      publicSnapshotId: profile.publicSnapshotId,
      retainedSourceFileSha256: source.sha256,
      sourceMetadataSha256: profile.profile.sourceMetadataSha256,
      sourceTermsUrl: profile.profile.termsUrl,
      sourceTermsSha256: profile.profile.termsSha256,
      fieldClassificationDigest: profile.fieldClassificationDigest,
      rows: Number(counts.rows),
      uniqueNativeIds: Number(counts.unique_ids),
      associatedProperties: Number(counts.properties),
      fields: observedFields,
      metadataEligibleFields: fields,
      nameFieldsPreservedAsObserved: true,
      populatedNameValues:
        Number(counts.name1_populated) + Number(counts.name2_populated),
      observedFieldCounts: Object.fromEntries(
        ["NAME1", "NAME2", "POSTALADDRESS"].map((field) => {
          const present = Number(counts[field.toLowerCase() + "_present"]),
            populated = Number(counts[field.toLowerCase() + "_populated"]);
          return [
            field,
            {
              present,
              populatedTrimmedString: populated,
              observedNullOrEmpty: present - populated,
              notObserved: Number(counts.rows) - present,
            },
          ];
        }),
      ),
      mailingAddressIncludedAsObserved: true,
      providerRestrictedRowsIncluded: false,
      observationsNotVerifiedLegalOwnership: true,
      currentAvailabilityCensusDoesNotReplaceHistoricalData: true,
      files: [
        {
          name: "official-parcel-observations.parquet",
          bytes: bytes.length,
          sha256: sha256(bytes),
        },
      ],
      irreversiblePublicIpfsApproval:
        "PENDING_EXACT_CANDIDATE_BYTES_AND_CAR_ROOT_HUMAN_DECISION",
      cidAndCar:
        "Root combines these exact bytes with unchanged eligible base objects and computes the local CID/CAR; no upload performed by this exporter.",
    };
    await writeFile(
      path.join(outputDir, "field-decision.json"),
      stableJson(manifest) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    await writeFile(
      path.join(outputDir, "official-parcel-profile.json"),
      stableJson(profile) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    return manifest;
  } finally {
    db.closeSync();
    instance.closeSync();
  }
}
