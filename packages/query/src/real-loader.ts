import { lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import {
  sha256,
  PROPERTY_TABLE_SQL,
  OWNER_DERIVATION_VERSION,
} from "../../county/src/model.ts";
import {
  PRIVATE_PERMIT_LIMIT,
  validateProtectedPermitRow,
} from "../../county/src/private-permits.ts";
import {
  PRIVATE_SOURCE_INTAKE_LIMIT,
  SOURCE_INTAKE_COLUMNS,
  TROY_SOURCE_FIELDS,
  validatePrivateSourceIntakeRow,
} from "../../county/src/private-source-intake.ts";
import {
  parseFullSourceConfigs,
  type FullSourceAudit,
} from "../../county/src/private-full-source.ts";
import { quote, verifySnapshotDirectory } from "./real-utils.ts";
import { loadSourceObservations } from "./real-source-observations.ts";
import { loadFullSources } from "./real-full-sources.ts";
import {
  validateOfficialParcelProfile,
  parsePinnedOfficialParcelProfile,
  type OfficialParcelProfileEnvelope,
} from "../../county/src/official-parcel.ts";
import type {
  SnapshotOpenOptions,
  SnapshotConstructionArguments,
  ProtectedPermitProjection,
} from "./real-loader-types.ts";
/** Open a bounded native connection and dispose all resources if loading or construction fails. */
export async function loadRealSnapshot<T>(
  directory: string,
  options: SnapshotOpenOptions,
  construct: (...args: SnapshotConstructionArguments) => T,
): Promise<T> {
  const verified = await verifySnapshotDirectory(directory);
  const root = verified.directory;
  // Lambda's task directory is read-only. Spill files may contain protected
  // observations, so use an isolated owner-only directory in writable /tmp.
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "prism-duckdb-"),
  );
  let instance: DuckDBInstance;
  let db: DuckDBConnection;
  try {
    instance = await DuckDBInstance.create(":memory:", {
      threads: "2",
      memory_limit: "1024MB",
      temp_directory: temporaryDirectory,
      max_temp_directory_size: "512MB",
    });
    try {
      db = await instance.connect();
    } catch (error) {
      instance.closeSync();
      throw error;
    }
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
  const overlayDigests: string[] = [];
  let permitCount = 0;
  const permitSourceCounts: Record<string, number> = {};
  let sourceIntakeCount = 0;
  const fullSourceAudits: FullSourceAudit[] = [],
    allowedSourcePaths: string[] = [];
  const fullSources = parseFullSourceConfigs(
    options.protectedFullSources ?? [],
  );
  const checkPrivate = async (file: string, expected: string | undefined) => {
    const meta = await lstat(file);
    const resolved = await realpath(file);
    if (
      !meta.isFile() ||
      meta.isSymbolicLink() ||
      meta.nlink > 1 ||
      meta.size > 128 * 1024 ** 2 ||
      resolved.startsWith(root + path.sep)
    )
      throw new Error("Unsafe protected sidecar path/size");
    if (!expected || sha256(await readFile(file)) !== expected)
      throw new Error("Protected sidecar integrity required");
  };
  const insertProtectedPermits = async (
    input: readonly ProtectedPermitProjection[],
  ) => {
    const projected = input.map(({ row, permit, openDays }) => ({
      property_id: row.property_id,
      id: permit.id,
      status: permit.status,
      kind: permit.kind,
      opened_at: permit.openedAt,
      closed_at: permit.closedAt,
      open_days: openDays,
      reported_contractor: permit.contractor.reportedName,
      verified_company_id: permit.contractor.verifiedCompanyId,
      license: permit.contractor.license,
      rating: permit.contractor.rating,
      source_id: row.source_id,
      native_id: row.native_id,
      receipt_digest: row.record_digest,
      observed_at: row.observed_at,
      canonical_json: JSON.stringify(permit),
    }));
    for (let offset = 0; offset < projected.length; offset += 256) {
      const payload = JSON.stringify(projected.slice(offset, offset + 256));
      if (Buffer.byteLength(payload) > 16 * 1024 ** 2)
        throw new Error("Protected permit batch byte bound rejected");
      await db.run(
        `INSERT INTO permits(property_id,id,status,kind,opened_at,closed_at,open_days,reported_contractor,verified_company_id,license,rating,source_id,native_id,receipt_digest,observed_at,canonical_json)
        SELECT json_extract_string(value,'$.property_id'),json_extract_string(value,'$.id'),json_extract_string(value,'$.status'),json_extract_string(value,'$.kind'),json_extract_string(value,'$.opened_at'),json_extract_string(value,'$.closed_at'),CAST(json_extract(value,'$.open_days') AS INTEGER),json_extract_string(value,'$.reported_contractor'),json_extract_string(value,'$.verified_company_id'),json_extract_string(value,'$.license'),CAST(json_extract(value,'$.rating') AS DOUBLE),json_extract_string(value,'$.source_id'),json_extract_string(value,'$.native_id'),json_extract_string(value,'$.receipt_digest'),json_extract_string(value,'$.observed_at'),json_extract_string(value,'$.canonical_json') FROM json_each($rows)`,
        { rows: payload },
      );
    }
  };
  try {
    for (const [table, file] of [
      ["parcels", "parcels.parquet"],
      ["site_addresses", "site-addresses.parquet"],
      ["parcel_address_links", "parcel-address-links.parquet"],
      ["permits", "permits.parquet"],
    ] as const)
      await db.run(
        `CREATE TABLE ${table} AS SELECT * FROM read_parquet(${quote(path.join(root, file))})`,
      );
    await db.run(PROPERTY_TABLE_SQL);
    await db.run("CREATE INDEX property_identity ON properties(id)");
    await db.run("ALTER TABLE permits ADD COLUMN canonical_json VARCHAR");
    if (options.protectedDerivativeFile) {
      await checkPrivate(
        options.protectedDerivativeFile,
        options.protectedDerivativeSha256,
      );
      overlayDigests.push("owner:" + options.protectedDerivativeSha256);
      await db.run(
        `CREATE TABLE owner_derivatives AS SELECT property_id,owner_region,location_class,site_address_match,observed_at,evidence_class,public_snapshot_id,transform_version FROM read_parquet(${quote(options.protectedDerivativeFile)})`,
      );
      const binding = await (
        await db.run(
          "SELECT count(*) AS n FROM owner_derivatives WHERE public_snapshot_id IS NULL OR public_snapshot_id != $snapshot",
          { snapshot: verified.manifest.snapshotId },
        )
      ).getRowObjectsJson();
      if (Number(binding[0]!.n) > 0)
        throw new Error(
          "Protected owner sidecar belongs to a different public snapshot",
        );
      const transform = await (
        await db.run(
          "SELECT count(*) AS n FROM owner_derivatives WHERE transform_version IS NULL OR transform_version!=$version",
          { version: OWNER_DERIVATION_VERSION },
        )
      ).getRowObjectsJson();
      if (Number(transform[0]!.n) > 0)
        throw new Error(
          "Protected owner derivative transform version mismatch",
        );
      const invalid = await (
        await db.run(
          "SELECT count(*) AS n FROM owner_derivatives WHERE owner_region NOT IN ('regional','out_of_area','unknown') OR location_class NOT IN ('local','in_county','in_state','out_of_state','unknown') OR evidence_class NOT IN ('derived_deterministically','unknown')",
        )
      ).getRowObjectsJson();
      if (Number(invalid[0]!.n) > 0)
        throw new Error("Invalid protected derivative schema");
      const duplicate = await (
        await db.run(
          "SELECT count(*)-count(DISTINCT property_id) AS n FROM owner_derivatives",
        )
      ).getRowObjectsJson();
      if (Number(duplicate[0]!.n) > 0)
        throw new Error("Duplicate protected derivative identity");
    } else
      await db.run(
        "CREATE TABLE owner_derivatives(property_id VARCHAR,owner_region VARCHAR,location_class VARCHAR,site_address_match BOOLEAN,observed_at VARCHAR,evidence_class VARCHAR)",
      );
    // Preserve county-derived values before independent source precedence updates.
    // A view would follow the later Troy UPDATE and would not be a baseline.
    await db.run(
      "CREATE TEMP TABLE county_owner_derivative_baseline AS SELECT property_id,owner_region,location_class,site_address_match,evidence_class FROM owner_derivatives",
    );
    if (options.protectedEnrichmentFile) {
      await checkPrivate(
        options.protectedEnrichmentFile,
        options.protectedEnrichmentSha256,
      );
      overlayDigests.push("enrichment:" + options.protectedEnrichmentSha256);
      await db.run(
        `CREATE TABLE protected_enrichment AS SELECT property_id,source_id,native_id,built_year,sale_date,receipt_digest,observed_at,page,line,record_digest,public_snapshot_id FROM read_parquet(${quote(options.protectedEnrichmentFile)})`,
      );
      const invalid = await (
        await db.run(
          "SELECT count(*) AS n FROM protected_enrichment WHERE public_snapshot_id IS NULL OR public_snapshot_id != $snapshot OR (built_year IS NOT NULL AND (built_year<1600 OR built_year>2100)) OR source_id NOT IN ('official-novi-residential-sales-pdf','official-auburn-hills-residential-sales-pdf')",
          { snapshot: verified.manifest.snapshotId },
        )
      ).getRowObjectsJson();
      if (Number(invalid[0]!.n) > 0)
        throw new Error("Protected enrichment binding/schema mismatch");
    } else
      await db.run(
        "CREATE TABLE protected_enrichment(property_id VARCHAR,source_id VARCHAR,native_id VARCHAR,built_year INTEGER,sale_date VARCHAR,receipt_digest VARCHAR,observed_at VARCHAR,page INTEGER,line INTEGER,record_digest VARCHAR,public_snapshot_id VARCHAR)",
      );
    await db.run(
      "CREATE VIEW roof_evidence AS SELECT property_id,CASE WHEN count(DISTINCT built_year)=1 THEN max(built_year) ELSE NULL END AS built_year FROM protected_enrichment GROUP BY property_id",
    );
    await db.run(
      "CREATE VIEW latest_reported_sales AS SELECT property_id,max(try_cast(sale_date AS DATE)) AS sale_date FROM protected_enrichment GROUP BY property_id",
    );
    if (options.protectedPermitsFile) {
      await checkPrivate(
        options.protectedPermitsFile,
        options.protectedPermitsSha256,
      );
      await db.run(
        `CREATE TABLE protected_permit_rows AS SELECT * FROM read_parquet(${quote(options.protectedPermitsFile)})`,
      );
      const columns = await (
        await db.run("PRAGMA table_info('protected_permit_rows')")
      ).getRowObjectsJson();
      const expectedColumns = [
        "property_id",
        "permit_json",
        "public_snapshot_id",
        "source_id",
        "native_id",
        "record_digest",
        "observed_at",
      ];
      if (
        columns.length !== expectedColumns.length ||
        columns.some(
          (x, i) => x.name !== expectedColumns[i] || x.type !== "VARCHAR",
        )
      )
        throw new Error("Protected permit outer columns rejected");
      const total = await (
        await db.run("SELECT count(*) AS n FROM protected_permit_rows")
      ).getRowObjectsJson();
      if (Number(total[0]!.n) > PRIVATE_PERMIT_LIMIT)
        throw new Error("Protected permit cohort bound rejected");
      const rows = await (
        await db.run("SELECT * FROM protected_permit_rows")
      ).getRowObjectsJson();
      const ids = new Set<string>();
      const validated = rows.map((candidate) =>
        validateProtectedPermitRow(candidate, verified.manifest.snapshotId),
      );
      for (const { permit } of validated) {
        if (ids.has(permit.id))
          throw new Error("Duplicate protected permit identity");
        ids.add(permit.id);
      }
      // Validate the full finite cohort once, rather than scan the county view per permit.
      // JSON extraction happens only after every canonical payload passed the strict boundary.
      const binding = await (
        await db.run(
          "WITH canonical AS (SELECT id,count(*) AS n FROM properties GROUP BY id) SELECT (SELECT count(*) FROM protected_permit_rows r LEFT JOIN canonical p ON p.id=r.property_id WHERE coalesce(p.n,0)!=1) AS invalid_properties,(SELECT count(*) FROM protected_permit_rows r JOIN permits p ON p.id=json_extract_string(r.permit_json,'$.id')) AS collisions",
        )
      ).getRowObjectsJson();
      if (
        Number(binding[0]!.invalid_properties) !== 0 ||
        Number(binding[0]!.collisions) !== 0
      )
        throw new Error(
          "Protected permit canonical property/identity binding rejected",
        );
      await insertProtectedPermits(validated);
      permitCount = rows.length;
      for (const { row } of validated)
        permitSourceCounts[row.source_id] =
          (permitSourceCounts[row.source_id] ?? 0) + 1;
      overlayDigests.push("permits:" + options.protectedPermitsSha256);
      await db.run("DROP TABLE protected_permit_rows");
    }
    if (options.protectedSourceIntakeFile) {
      await checkPrivate(
        options.protectedSourceIntakeFile,
        options.protectedSourceIntakeSha256,
      );
      await db.run(
        `CREATE TABLE private_source_intake AS SELECT * FROM read_parquet(${quote(options.protectedSourceIntakeFile)})`,
      );
      const columns = await (
        await db.run("PRAGMA table_info('private_source_intake')")
      ).getRowObjectsJson();
      if (
        columns.length !== SOURCE_INTAKE_COLUMNS.length ||
        columns.some(
          (x, i) => x.name !== SOURCE_INTAKE_COLUMNS[i] || x.type !== "VARCHAR",
        )
      )
        throw new Error("Protected source intake columns rejected");
      const count = await (
        await db.run("SELECT count(*) AS n FROM private_source_intake")
      ).getRowObjectsJson();
      if (Number(count[0]!.n) > PRIVATE_SOURCE_INTAKE_LIMIT)
        throw new Error("Protected source intake row bound rejected");
      const rows = await (
          await db.run("SELECT * FROM private_source_intake")
        ).getRowObjectsJson(),
        ids = new Set<string>();
      for (const candidate of rows) {
        const { row } = validatePrivateSourceIntakeRow(
          candidate,
          verified.manifest.snapshotId,
        );
        if (ids.has(row.native_id))
          throw new Error("Duplicate protected source intake native identity");
        ids.add(row.native_id);
      }
      const invalid = await (
        await db.run(
          "WITH canonical AS (SELECT id,count(*) AS n FROM properties GROUP BY id) SELECT count(*) AS n FROM private_source_intake r LEFT JOIN canonical p ON p.id=r.matched_property_id WHERE r.matched_property_id IS NOT NULL AND coalesce(p.n,0)!=1",
        )
      ).getRowObjectsJson();
      if (Number(invalid[0]!.n))
        throw new Error(
          "Protected source intake canonical property binding rejected",
        );
      if (options.protectedPermitsFile) {
        const alignment = await (
          await db.run(
            "SELECT (SELECT count(*) FROM private_source_intake r LEFT JOIN permits p ON p.native_id=r.native_id AND p.property_id=r.matched_property_id AND p.source_id=r.source_id WHERE r.matched_property_id IS NOT NULL AND p.id IS NULL) AS missing_permit,(SELECT count(*) FROM permits p LEFT JOIN private_source_intake r ON r.native_id=p.native_id AND r.matched_property_id=p.property_id AND r.source_id=p.source_id WHERE p.source_id='official-troy-issued-permits' AND r.native_id IS NULL) AS missing_intake",
          )
        ).getRowObjectsJson();
        if (
          Number(alignment[0]!.missing_permit) ||
          Number(alignment[0]!.missing_intake)
        )
          throw new Error(
            "Protected source intake/minimized permit alignment rejected",
          );
      }
      sourceIntakeCount = rows.length;
      overlayDigests.push(
        "source-intake:" + options.protectedSourceIntakeSha256,
      );
    } else
      await db.run(
        "CREATE TABLE private_source_intake(source_id VARCHAR,native_id VARCHAR,source_record_digest VARCHAR,observed_at VARCHAR,public_snapshot_id VARCHAR,source_fields_json VARCHAR,matched_property_id VARCHAR,join_status VARCHAR,source_receipt_digest VARCHAR)",
      );
    const sourceAliases = [
      "permit_type",
      "permit_number",
      "date_issued",
      "address",
      "applicant",
      "applicant_address",
      "applicant_city_state_zip",
      "parcel_number",
      "lot",
      "subdivision",
      "work_description",
      "value",
    ];
    await db.run(
      "CREATE VIEW private_troy_source_fields AS SELECT source_id,native_id,source_record_digest,observed_at,public_snapshot_id,matched_property_id,join_status,source_receipt_digest," +
        TROY_SOURCE_FIELDS.map(
          (field, i) =>
            `json_extract_string(source_fields_json,'$."${field}"') AS ${sourceAliases[i]}`,
        ).join(",") +
        " FROM private_source_intake",
    );
    // Full source JSON remains in hash-verified local Parquet. Only narrow metadata
    // columns are scanned at boot; producer/schema validation is pinned separately.
    await db.run(
      "CREATE TABLE private_reported_owner_observations(property_id VARCHAR,source_id VARCHAR,native_id VARCHAR,canonical_json VARCHAR)",
    );
    await db.run(
      "CREATE TABLE private_owner_location_provenance(property_id VARCHAR,canonical_json VARCHAR)",
    );
    await db.run(
      "CREATE TABLE private_assessment_match(property_id VARCHAR,caveat VARCHAR)",
    );
    permitCount = await loadFullSources({
      db,
      fullSources,
      snapshotId: verified.manifest.snapshotId,
      checkPrivate,
      insertProtectedPermits,
      permitCount,
      permitSourceCounts,
      fullSourceAudits,
      allowedSourcePaths,
      overlayDigests,
    });
    let officialParcelProfile: OfficialParcelProfileEnvelope | undefined;
    if (options.officialParcelProfileFile) {
      await checkPrivate(
        options.officialParcelProfileFile,
        options.officialParcelProfileSha256,
      );
      officialParcelProfile = parsePinnedOfficialParcelProfile(
        await readFile(options.officialParcelProfileFile),
        options.officialParcelProfileSha256,
      );
      const county = fullSources.find(
        (source) => source.role === "county-parcels",
      );
      if (!county)
        throw new Error(
          "Official parcel observations require the pinned retained county source",
        );
      validateOfficialParcelProfile(
        officialParcelProfile,
        county,
        verified.manifest.snapshotId,
      );
      overlayDigests.push(
        "official-public-profile:" + options.officialParcelProfileSha256,
      );
      await db.run(
        "CREATE VIEW official_parcel_observations AS SELECT property_id,native_id,source_record_json,record_digest,observed_at FROM private_county_parcels WHERE property_id IS NOT NULL",
      );
    } else {
      await db.run(
        "CREATE TABLE official_parcel_observations(property_id VARCHAR,native_id VARCHAR,source_record_json VARCHAR,record_digest VARCHAR,observed_at VARCHAR)",
      );
    }
    if (
      sourceIntakeCount +
        fullSourceAudits
          .filter((audit) =>
            [
              "municipal-source",
              "rochester-source",
              "assessment-source",
            ].includes(audit.role),
          )
          .reduce((sum, audit) => sum + audit.records, 0) >
      PRIVATE_SOURCE_INTAKE_LIMIT
    )
      throw new Error(
        "Combined municipal full-source intake exceeds the versioned 50000-record envelope",
      );
    const sourceObservationAudit = await loadSourceObservations({
      db,
      options,
      publicSnapshotId: verified.manifest.snapshotId,
      checkPrivate,
      overlayDigests,
    });
    await db.run("CREATE INDEX address_location ON site_addresses(lat,lng)");
    await db.run(
      "CREATE INDEX link_property ON parcel_address_links(property_id)",
    );
    await db.run(
      "CREATE INDEX link_address ON parcel_address_links(address_id)",
    );
    await db.run("CREATE INDEX parcel_id ON parcels(id)");
    const count = await (
      await db.run(
        "SELECT (SELECT count(*) FROM properties) AS n,(SELECT count(*) FROM parcels) AS parcels,(SELECT count(*) FROM site_addresses) AS addresses",
      )
    ).getRowObjectsJson();
    if (
      Number(count[0]!.n) !== verified.manifest.count ||
      Number(count[0]!.parcels) !== verified.manifest.parcelCount ||
      Number(count[0]!.addresses) !== verified.manifest.addressCount
    )
      throw new Error("Snapshot count reconciliation failed");
    if (allowedSourcePaths.length)
      await db.run(
        "SET allowed_paths=[" + allowedSourcePaths.map(quote).join(",") + "]",
      );
    await db.run("SET enable_external_access=false");
    await db.run("SET lock_configuration=true");
    return construct(
      verified.manifest,
      db,
      instance,
      JSON.parse(
        await readFile(path.join(root, "coverage.json"), "utf8"),
      ) as unknown,
      JSON.parse(
        await readFile(path.join(root, "runs.json"), "utf8"),
      ) as unknown[],
      Boolean(
        options.protectedDerivativeFile ||
        fullSources.some(
          (c) => c.role === "assessment-source" && c.sourceRecordCount > 0,
        ),
      ),
      overlayDigests,
      permitCount,
      permitSourceCounts,
      sourceIntakeCount,
      fullSourceAudits,
      sourceObservationAudit,
      temporaryDirectory,
      officialParcelProfile,
    );
  } catch (error) {
    db.closeSync();
    instance.closeSync();
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}
