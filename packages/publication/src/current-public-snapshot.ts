/** Source-qualified official projection. No network, provider or publication effects. */
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CID } from "multiformats/cid";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { CONTRACT_VERSION, PermitSchema } from "../../contracts/src/index.ts";
import { qualifyingPermitObservationSignals } from "../../contracts/src/query-predicates.ts";
import { FULL_SOURCE_DEFINITIONS } from "../../county/src/private-full-source.ts";
import { deriveIndependenceInlineEvidence } from "../../county/src/independence-inline-evidence.ts";
import {
  PROPERTY_VIEW_SQL,
  sha256,
  stableJson,
} from "../../county/src/model.ts";
import { loadRealSnapshot } from "../../query/src/real-loader.ts";
import type { SnapshotOpenOptions } from "../../query/src/real-loader-types.ts";
import { quote } from "../../query/src/real-utils.ts";
import {
  packCurrentPublicDirectory,
  publicFileDigest,
} from "./current-public-car.ts";

export const CURRENT_PUBLIC_PROFILE = "p13-current-official-public-v1";
const EMPTY_SEED = new URL("../assets/duckdb-v2-empty.seed", import.meta.url);
const EMPTY_SEED_SHA256 =
  "f8e87eed513f1d5b63d01d8838f8c2322006b0cd478f2b66bd4788515693b1b6";
async function prepareEmptyDatabase(target: string) {
  if (sha256(await readFile(EMPTY_SEED)) !== EMPTY_SEED_SHA256)
    throw new Error("Empty reproducibility seed digest mismatch");
  const instance = await DuckDBInstance.create(fileURLToPath(EMPTY_SEED), {
    access_mode: "READ_ONLY",
    enable_external_access: "false",
  });
  const connection = await instance.connect();
  try {
    const state = (
      await rows(
        connection,
        "SELECT version() AS version,(SELECT count(*) FROM duckdb_tables() WHERE NOT internal) AS tables,(SELECT count(*) FROM duckdb_views() WHERE NOT internal) AS views,(SELECT count(*) FROM duckdb_functions() WHERE NOT internal AND function_type IN ('macro','table_macro')) AS macros",
      )
    )[0]!;
    if (
      state.version !== "v2.0.0" ||
      Number(state.tables) ||
      Number(state.views) ||
      Number(state.macros)
    )
      throw new Error("Seed is not an empty pinned-engine database");
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
  await copyFile(EMPTY_SEED, target, constants.COPYFILE_EXCL);
}
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const PublicSourcePolicySchema = z
  .object({
    sourceId: z.string().regex(/^[a-z0-9-]{1,100}$/),
    sourceUrl: z.url().refine((value) => {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    }),
    rightsBasis: z.string().min(10).max(2000),
    termsSha256: Hash.nullable(),
    evidenceSha256: Hash,
    factualFields: z.array(z.string().min(1).max(100)).min(1).max(64),
    classification: z.enum([
      "official_public_factual_projection",
      "synthetic_fixture",
    ]),
  })
  .strict();
export type PublicSourcePolicy = z.infer<typeof PublicSourcePolicySchema>;
export interface CurrentPublicBuildOptions {
  baseDirectory: string;
  snapshotOptions: SnapshotOpenOptions;
  outputDirectory: string;
  sourcePolicies: readonly PublicSourcePolicy[];
  run: {
    id: string;
    startedAt: string;
    completedAt: string;
    description: string;
  };
  priorPublications: readonly {
    runId: string;
    rootCid: string;
    snapshotId: string;
  }[];
  sourceRevalidation?: readonly {
    sourceId: string;
    observedAt: string;
    rows: number;
    added: number;
    changed: number;
    deleted: number;
    receiptSha256: string;
  }[];
  dataKind?: "real-official" | "synthetic-fixture";
}
type Projection = { name: string; select: string; order: string };
const projections: readonly Projection[] = [
  { name: "parcels", select: "SELECT * FROM parcels", order: "id" },
  {
    name: "site_addresses",
    select: "SELECT * FROM site_addresses",
    order: "id",
  },
  {
    name: "parcel_address_links",
    select: "SELECT * FROM parcel_address_links",
    order: "property_id,address_id",
  },
  { name: "permits", select: "SELECT * FROM permits", order: "property_id,id" },
  {
    name: "assessor_observations",
    select: "SELECT * FROM protected_enrichment",
    order: "property_id,source_id,native_id,record_digest",
  },
  {
    name: "owner_derivatives",
    select:
      "SELECT property_id,owner_region,location_class,site_address_match,observed_at,evidence_class FROM owner_derivatives",
    order: "property_id",
  },
  {
    name: "official_parcel_observations",
    select:
      "SELECT property_id,native_id,json_extract_string(source_record_json,'$.NAME1') AS name1,json_extract_string(source_record_json,'$.NAME2') AS name2,json_extract_string(source_record_json,'$.POSTALADDRESS') AS postal_address,record_digest,observed_at FROM official_parcel_observations",
    order: "property_id,native_id",
  },
  {
    name: "reported_owner_observations",
    select: "SELECT * FROM private_reported_owner_observations",
    order: "property_id,source_id,native_id",
  },
  {
    name: "owner_location_provenance",
    select: "SELECT * FROM private_owner_location_provenance",
    order: "property_id,canonical_json",
  },
  {
    name: "recorded_deed_observations",
    select:
      "SELECT property_id,CAST(claim_window_start AS VARCHAR) AS claim_window_start,CAST(observed_through AS VARCHAR) AS observed_through,CAST(last_deed_date AS VARCHAR) AS last_deed_date,canonical_json FROM private_transfer_observations",
    order: "property_id,observed_through,claim_window_start",
  },
];
const distance =
  "12742017.6*asin(sqrt(least(1.0,pow(sin(radians(a.lat-center_lat)/2),2)+cos(radians(center_lat))*cos(radians(a.lat))*pow(sin(radians(a.lng-center_lng)/2),2))))";
/** These relations use materialized public tables only; no paths, HTTP or extensions. */
export const PORTABLE_QUERY_SQL = `
CREATE VIEW roof_evidence AS SELECT property_id,CASE WHEN count(DISTINCT built_year)=1 THEN max(built_year) ELSE NULL END AS built_year FROM assessor_observations GROUP BY property_id;
CREATE VIEW latest_reported_sales AS SELECT property_id,max(try_cast(sale_date AS DATE)) AS sale_date FROM assessor_observations GROUP BY property_id;
CREATE MACRO properties_within(center_lat,center_lng,radius_meters) AS TABLE
 WITH points AS(SELECT a.id,a.lat,a.lng,${distance} AS distance_meters FROM site_addresses a WHERE a.lat IS NOT NULL AND a.lng IS NOT NULL), ranked AS(SELECT l.property_id,p.*,row_number() OVER(PARTITION BY l.property_id ORDER BY p.distance_meters,p.id) AS rank FROM points p JOIN parcel_address_links l ON l.address_id=p.id WHERE p.distance_meters<=radius_meters)
 SELECT p.*,r.lat AS matched_lat,r.lng AS matched_lng,r.distance_meters FROM properties p JOIN ranked r ON r.property_id=p.id AND r.rank=1;
CREATE MACRO roofs_within(center_lat,center_lng,radius_meters,minimum_age_years) AS TABLE
 SELECT p.*,r.built_year,CAST(substr(p.observed_at,1,4) AS INTEGER)-r.built_year AS roof_proxy_age_years,'reported_building_year_not_roof_inspection' AS roof_age_basis FROM properties_within(center_lat,center_lng,radius_meters) p JOIN roof_evidence r ON r.property_id=p.id WHERE CAST(substr(p.observed_at,1,4) AS INTEGER)-r.built_year>minimum_age_years;
CREATE MACRO permits_within(center_lat,center_lng,radius_meters,opportunity_mode,minimum_age_years,minimum_open_days) AS TABLE
 SELECT p.*,count(DISTINCT s.permit_id) AS qualifying_permit_count,max(s.age_days) AS maximum_issue_age_days,max(s.open_days) AS maximum_documented_open_days FROM properties_within(center_lat,center_lng,radius_meters) p JOIN permit_signals s ON s.property_id=p.id WHERE s.mode=opportunity_mode AND (minimum_age_years=0 OR (try_cast(s.observation_date AS DATE)<try_cast(s.assessment_date AS DATE)-CAST(minimum_age_years AS INTEGER)*INTERVAL 1 YEAR)) AND (minimum_open_days=0 OR (s.mode='confirmed_open' AND s.open_days>=minimum_open_days)) GROUP BY ALL;
CREATE MACRO owners_within(center_lat,center_lng,radius_meters,region) AS TABLE
 SELECT p.*,o.owner_region,o.location_class,o.evidence_class FROM properties_within(center_lat,center_lng,radius_meters) p JOIN owner_derivatives o ON o.property_id=p.id WHERE o.owner_region=region;
CREATE MACRO deed_gaps_within(center_lat,center_lng,radius_meters,minimum_years) AS TABLE
 SELECT DISTINCT p.*,'qualified_recorded_index_gap_not_legal_ownership_continuity' AS claim_basis FROM properties_within(center_lat,center_lng,radius_meters) p JOIN recorded_deed_observations d ON d.property_id=p.id WHERE try_cast(d.claim_window_start AS DATE)<try_cast(d.observed_through AS DATE)-CAST(minimum_years AS INTEGER)*INTERVAL 1 YEAR AND (d.last_deed_date IS NULL OR try_cast(d.last_deed_date AS DATE)<try_cast(d.observed_through AS DATE)-CAST(minimum_years AS INTEGER)*INTERVAL 1 YEAR);
`;
const identifier = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const canonicalWrite = (directory: string, name: string, value: unknown) =>
  writeFile(path.join(directory, name), stableJson(value) + "\n", {
    flag: "wx",
  });
async function rows(db: DuckDBConnection, sql: string) {
  return (await db.run(sql)).getRowObjectsJson();
}
async function validateSources(
  db: DuckDBConnection,
  policies: readonly PublicSourcePolicy[],
) {
  const allowed = new Set(policies.map((policy) => policy.sourceId));
  for (const table of [
    "parcels",
    "site_addresses",
    "permits",
    "protected_enrichment",
    "private_reported_owner_observations",
  ]) {
    for (const row of await rows(db, `SELECT DISTINCT source_id FROM ${table}`))
      if (!allowed.has(String(row.source_id)))
        throw new Error("Public projection contains an unapproved source ID");
  }
  for (const row of await rows(
    db,
    "SELECT DISTINCT json_extract_string(canonical_json,'$.reference.sourceId') AS source_id FROM private_transfer_observations",
  ))
    if (!allowed.has(String(row.source_id)))
      throw new Error(
        "Public deed projection contains an unapproved source ID",
      );
  const providers = await rows(
    db,
    "SELECT count(*) AS n FROM private_provider_observations",
  );
  if (Number(providers[0]!.n))
    throw new Error(
      "Restricted provider observations cannot enter public projection",
    );
}
async function materializeSignals(db: DuckDBConnection, catalog: string) {
  await db.run(
    `CREATE TABLE ${catalog}.main.permit_signals(property_id VARCHAR,permit_id VARCHAR,mode VARCHAR,source_id VARCHAR,native_id VARCHAR,record_digest VARCHAR,observation_date VARCHAR,assessment_date VARCHAR,age_days INTEGER,open_days INTEGER,signal_json VARCHAR)`,
  );
  const permits = await rows(
    db,
    "SELECT * FROM permits ORDER BY property_id,id",
  );
  if (permits.length > 200000) throw new Error("Public permit cohort bound");
  const signalRows: Record<string, unknown>[] = [];
  for (const row of permits) {
    const permit = PermitSchema.parse(
      row.canonical_json
        ? JSON.parse(String(row.canonical_json))
        : {
            id: row.id,
            status: row.status,
            kind: row.kind,
            openedAt: row.opened_at,
            closedAt: row.closed_at,
            contractor: {
              reportedName: row.reported_contractor,
              verifiedCompanyId: row.verified_company_id,
              license: row.license,
              rating: row.rating,
            },
            provenance: [
              {
                sourceId: row.source_id,
                recordId: row.native_id,
                observedAt: row.observed_at,
                digest: row.receipt_digest,
                kind: "real-public",
              },
            ],
          },
    );
    if (permit.sourceObservations?.length)
      throw new Error(
        "Provider-enriched canonical permit rejected from public projection",
      );
    for (const mode of [
      "confirmed_open",
      "confirmed_closed",
      "lifecycle_unknown",
      "status_verification_needed",
    ] as const) {
      const query = {
        snapshotId: "p13-public-projection-signal-derivation",
        lat: 42.48,
        lng: -83.48,
        radiusMeters: 8046.72,
        permitOpportunityMode: mode,
        ...(mode === "status_verification_needed"
          ? { minPermitObservationAgeYears: 0 }
          : {}),
      };
      for (const signal of qualifyingPermitObservationSignals(
        permit,
        query,
        String(row.observed_at).slice(0, 10),
      ))
        signalRows.push({
          property_id: row.property_id,
          permit_id: permit.id,
          mode,
          source_id: signal.sourceId,
          native_id: signal.provenance.recordId,
          record_digest: signal.provenance.recordDigest,
          observation_date: signal.observationDate,
          assessment_date: signal.assessmentAt?.slice(0, 10) ?? null,
          age_days: signal.ageDays,
          open_days: signal.openDays,
          signal_json: stableJson(signal),
        });
    }
  }
  for (let offset = 0; offset < signalRows.length; offset += 256)
    await db.run(
      `INSERT INTO ${catalog}.main.permit_signals SELECT json_extract_string(value,'$.property_id'),json_extract_string(value,'$.permit_id'),json_extract_string(value,'$.mode'),json_extract_string(value,'$.source_id'),json_extract_string(value,'$.native_id'),json_extract_string(value,'$.record_digest'),json_extract_string(value,'$.observation_date'),json_extract_string(value,'$.assessment_date'),CAST(json_extract(value,'$.age_days') AS INTEGER),CAST(json_extract(value,'$.open_days') AS INTEGER),json_extract_string(value,'$.signal_json') FROM json_each($rows)`,
      { rows: JSON.stringify(signalRows.slice(offset, offset + 256)) },
    );
}
async function materializeInlineEvidence(
  db: DuckDBConnection,
  catalog: string,
  sourceRecordsSql: string | undefined,
) {
  await db.run(
    `CREATE TABLE ${catalog}.main.official_inline_observations(property_id VARCHAR,source_id VARCHAR,native_id VARCHAR,record_digest VARCHAR,observed_at VARCHAR,observation_json VARCHAR)`,
  );
  const observations = sourceRecordsSql
    ? await rows(
        db,
        `SELECT * FROM (${sourceRecordsSql}) WHERE source_id='official-independence-public-permits' AND native_id IN ('2623310','2622164') ORDER BY native_id`,
      )
    : [];
  for (const sourceRow of observations) {
    const observation = deriveIndependenceInlineEvidence(sourceRow);
    if (!observation)
      throw new Error("Reviewed inline source observation missing");
    await db.run(
      `INSERT INTO ${catalog}.main.official_inline_observations VALUES ($property,$source,$native,$digest,$observed,$json)`,
      {
        property: observation.propertyId,
        source: observation.sourceId,
        native: observation.recordId,
        digest: observation.recordDigest,
        observed: observation.observedAt,
        json: stableJson(observation),
      },
    );
  }
}
function checkOptions(options: CurrentPublicBuildOptions) {
  if (
    options.snapshotOptions.protectedProviderObservationsFile ||
    options.snapshotOptions.protectedProviderObservationsSha256 ||
    options.snapshotOptions.protectedSourceRunsFile
  )
    throw new Error(
      "Restricted provider/operational run options excluded from public builder",
    );
  const policies = z
    .array(PublicSourcePolicySchema)
    .min(1)
    .max(32)
    .parse(options.sourcePolicies);
  if (
    new Set(policies.map((policy) => policy.sourceId)).size !==
      policies.length ||
    policies.some((policy) =>
      /provider|permitstack|shovels/i.test(policy.sourceId),
    )
  )
    throw new Error("Unique official source policies required");
  if (
    (options.dataKind ?? "real-official") === "real-official" &&
    policies.some(
      (policy) =>
        policy.classification !== "official_public_factual_projection",
    )
  )
    throw new Error(
      "Real public export requires official factual source decisions",
    );
  if (
    !/^[a-z0-9-]{1,100}$/.test(options.run.id) ||
    !Number.isFinite(Date.parse(options.run.startedAt)) ||
    !Number.isFinite(Date.parse(options.run.completedAt)) ||
    Date.parse(options.run.completedAt) < Date.parse(options.run.startedAt) ||
    Date.parse(options.run.completedAt) > Date.now()
  )
    throw new Error("Actual fixed run identity/time required");
  if (options.priorPublications.length > 64)
    throw new Error("Public predecessor bound");
  for (const prior of options.priorPublications) {
    if (
      !/^[a-z0-9-]{1,120}$/.test(prior.runId) ||
      !/^oakland-(?:real|public)-[a-f0-9]{20}$/.test(prior.snapshotId) ||
      CID.parse(prior.rootCid).version !== 1
    )
      throw new Error("Public predecessor identity rejected");
  }
  for (const revalidation of options.sourceRevalidation ?? []) {
    if (
      !policies.some((policy) => policy.sourceId === revalidation.sourceId) ||
      !Number.isFinite(Date.parse(revalidation.observedAt)) ||
      Date.parse(revalidation.observedAt) > Date.now() ||
      !Hash.safeParse(revalidation.receiptSha256).success ||
      [
        revalidation.rows,
        revalidation.added,
        revalidation.changed,
        revalidation.deleted,
      ].some(
        (count) =>
          !Number.isSafeInteger(count) || count < 0 || count > 2_000_000,
      )
    )
      throw new Error("Source revalidation identity/count rejected");
  }
  return policies;
}
export async function buildCurrentPublicSnapshot(
  options: CurrentPublicBuildOptions,
) {
  const policies = checkOptions(options);
  const output = path.resolve(options.outputDirectory);
  await mkdir(output, { mode: 0o700 });
  await prepareEmptyDatabase(path.join(output, "oakland-public.duckdb"));
  const metadata: Record<string, unknown> = {};
  const tableNames: string[] = [];
  const loaded = await loadRealSnapshot(
    options.baseDirectory,
    options.snapshotOptions,
    (
      manifest,
      connection,
      instance,
      coverage,
      runs,
      _owners,
      _digests,
      _permits,
      _counts,
      _intake,
      fullSources,
      observationAudit,
      temporaryDirectory,
    ) => ({
      manifest,
      connection,
      instance,
      coverage,
      runs,
      fullSources,
      observationAudit,
      temporaryDirectory,
    }),
    async (db) => {
      await validateSources(db, policies);
      const sourceCatalog = String(
        (await rows(db, "SELECT current_database() AS name"))[0]!.name,
      );
      const source = identifier(sourceCatalog);
      const target = "public_projection";
      await db.run(
        "SET threads=1; SET memory_limit='2GB'; SET force_compression='uncompressed'; SET checkpoint_threshold='4GB'",
      );
      await db.run(
        `ATTACH ${quote(path.join(output, "oakland-public.duckdb"))} AS ${target}`,
      );
      try {
        for (const projection of projections) {
          await db.run(
            `CREATE TABLE ${target}.main.${projection.name} AS ${projection.select} ORDER BY ${projection.order}`,
          );
          tableNames.push(projection.name);
        }
        const full = options.snapshotOptions.protectedFullSources ?? [];
        for (const item of full)
          if (
            !policies.some(
              (policy) =>
                policy.sourceId === FULL_SOURCE_DEFINITIONS[item.role].sourceId,
            )
          )
            throw new Error("Full-source eligibility decision missing");
        const dispositions = full.map(
          (item) =>
            `SELECT source_id,native_id,property_id,record_digest,observed_at,source_schema_sha256 FROM ${source}.main.${FULL_SOURCE_DEFINITIONS[item.role].table}`,
        );
        const dispositionSql = dispositions.length
          ? dispositions.join(" UNION ALL ")
          : "SELECT CAST(NULL AS VARCHAR) source_id,CAST(NULL AS VARCHAR) native_id,CAST(NULL AS VARCHAR) property_id,CAST(NULL AS VARCHAR) record_digest,CAST(NULL AS VARCHAR) observed_at,CAST(NULL AS VARCHAR) source_schema_sha256 WHERE false";
        await db.run(
          `CREATE TABLE ${target}.main.source_row_profiles AS SELECT CAST(row_number() OVER(ORDER BY source_id,observed_at,source_schema_sha256) AS INTEGER) AS profile_id,* FROM (SELECT DISTINCT source_id,observed_at,source_schema_sha256 FROM (${dispositionSql})) ORDER BY profile_id`,
        );
        await db.run(
          `CREATE TABLE ${target}.main.source_row_entities AS SELECT p.profile_id,e.native_id,e.property_id,e.record_digest FROM (${dispositionSql}) e JOIN ${target}.main.source_row_profiles p USING(source_id,observed_at,source_schema_sha256) ORDER BY p.profile_id,e.native_id`,
        );
        tableNames.push("source_row_dispositions");
        const publicRecords = full
          .filter((item) =>
            ["county-parcels", "county-addresses", "municipal-source"].includes(
              item.role,
            ),
          )
          .map(
            (item) =>
              `SELECT source_id,native_id,property_id,source_record_json,record_digest,observed_at,source_schema_sha256 FROM ${source}.main.${FULL_SOURCE_DEFINITIONS[item.role].table}`,
          );
        const sourceRecordsSql = publicRecords.length
          ? publicRecords.join(" UNION ALL ")
          : "SELECT CAST(NULL AS VARCHAR) source_id,CAST(NULL AS VARCHAR) native_id,CAST(NULL AS VARCHAR) property_id,CAST(NULL AS VARCHAR) source_record_json,CAST(NULL AS VARCHAR) record_digest,CAST(NULL AS VARCHAR) observed_at,CAST(NULL AS VARCHAR) source_schema_sha256 WHERE false";
        await db.run(
          `COPY (${sourceRecordsSql} ORDER BY source_id,native_id) TO ${quote(path.join(output, "official-source-records.parquet"))} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 122880)`,
        );
        await materializeInlineEvidence(db, target, sourceRecordsSql);
        tableNames.push("official_inline_observations");
        await materializeSignals(db, target);
        tableNames.push("permit_signals");
        await db.run(`USE ${target}`);
        await db.run(
          "CREATE VIEW source_row_dispositions AS SELECT p.source_id,e.native_id,e.property_id,e.record_digest,p.observed_at,p.source_schema_sha256 FROM source_row_entities e JOIN source_row_profiles p USING(profile_id)",
        );
        await db.run(PROPERTY_VIEW_SQL);
        tableNames.push("properties");
        await db.run(PORTABLE_QUERY_SQL);
        const counts: Record<string, number> = {};
        for (const table of tableNames) {
          counts[table] = Number(
            (await rows(db, `SELECT count(*) AS n FROM ${table}`))[0]!.n,
          );
          await db.run(
            `COPY (SELECT * FROM ${table} ORDER BY ALL) TO ${quote(path.join(output, table.replaceAll("_", "-") + ".parquet"))} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 122880)`,
          );
        }
        metadata.counts = counts;
        metadata.reconciliation = {
          counts,
          nativeIdentity: await rows(
            db,
            "SELECT source_id,count(*) AS records,count(DISTINCT native_id) AS unique_native_ids,count(*) FILTER(WHERE property_id IS NOT NULL) AS matched,count(*) FILTER(WHERE property_id IS NULL) AS held_or_unmatched FROM source_row_dispositions GROUP BY source_id ORDER BY source_id",
          ),
          canonical: (
            await rows(
              db,
              "SELECT (SELECT count(*) FROM properties) AS canonical_properties,(SELECT count(*)-count(DISTINCT id) FROM properties) AS duplicate_canonical_ids,(SELECT count(*) FROM parcel_address_links) AS links,(SELECT count(*) FROM properties p WHERE NOT EXISTS(SELECT 1 FROM parcel_address_links l WHERE l.property_id=p.id)) AS properties_without_address,(SELECT count(*) FROM site_addresses WHERE lat IS NULL OR lng IS NULL) AS addresses_without_coordinates,(SELECT count(*) FROM (SELECT pin FROM parcels WHERE pin IS NOT NULL GROUP BY pin HAVING count(*)>1)) AS multi_parcel_pins",
            )
          )[0],
          representativeJoins: await rows(
            db,
            "SELECT p.id,p.source_id,p.native_id,p.pin,a.source_id AS address_source,a.native_id AS address_native_id,l.match_basis FROM properties p JOIN parcel_address_links l ON l.property_id=p.id JOIN site_addresses a ON a.id=l.address_id ORDER BY p.id,a.id LIMIT 5",
          ),
          roofConflicts: (
            await rows(
              db,
              "SELECT count(*) AS properties_with_conflicting_built_years FROM (SELECT property_id FROM assessor_observations GROUP BY property_id HAVING count(DISTINCT built_year)>1)",
            )
          )[0],
          duplicatePolicy:
            "Source-native entities are preserved; exact PIN creates associations, not a destructive entity collapse. Conflicting reported built years yield unknown roof proxy. Held/unassigned source identities remain in the disposition table.",
        };
        await db.run("CHECKPOINT");
      } finally {
        await db.run(`USE ${source}`);
        await db.run(`DETACH ${target}`);
      }
    },
  );
  try {
    if (loaded.observationAudit.providerObservations !== 0)
      throw new Error("Provider audit must be empty for public projection");
    const counts = metadata.counts as Record<string, number>;
    if (
      counts.properties !== loaded.manifest.count ||
      counts.parcels !== loaded.manifest.parcelCount ||
      counts.site_addresses !== loaded.manifest.addressCount
    )
      throw new Error("Public canonical totals changed");
    metadata.sourceLoadAudits = loaded.fullSources;
    metadata.sourceAudit = loaded.observationAudit;
    metadata.baseManifest = {
      snapshotId: loaded.manifest.snapshotId,
      digest: loaded.manifest.digest,
      contractVersion: loaded.manifest.contractVersion,
    };
    metadata.historicalRuns = loaded.runs;
  } finally {
    loaded.connection.closeSync();
    loaded.instance.closeSync();
    await rm(loaded.temporaryDirectory, { recursive: true, force: true });
  }
  await writeFile(
    path.join(output, "portable-queries.sql"),
    PORTABLE_QUERY_SQL,
  );
  const counts = metadata.counts as Record<string, number>;
  await canonicalWrite(output, "source-profiles.json", {
    version: CURRENT_PUBLIC_PROFILE,
    dataKind: options.dataKind ?? "real-official",
    policies,
    historicalStorageFlagsAreNotPublicationRightsDecisions: true,
    restrictedProviderRowsIncluded: false,
    rawPdfImagesLayoutOrNarrativeIncluded: false,
    operationalDataIncluded: false,
    sourceRevalidation: options.sourceRevalidation ?? [],
  });
  await canonicalWrite(output, "reconciliation-report.json", {
    version: CURRENT_PUBLIC_PROFILE,
    ...(metadata.reconciliation as object),
    fullSourceAudits: metadata.sourceLoadAudits,
  });
  await canonicalWrite(output, "coverage.json", {
    version: CURRENT_PUBLIC_PROFILE,
    counts,
    sourceCoverage:
      "Complete retained selected official inputs, not every municipality or complete permit/title history",
    roofBasis:
      "Reported building-year proxy; not roof installation or inspection",
    sourceConfirmedOpenIsNotIssued: true,
    sourceLoadAudits: metadata.sourceLoadAudits,
    limitations: [
      "Complete selected GIS parcel/address layers do not establish a verified assessed-property denominator.",
      "Official site-address points approximate parcel centers, may be stacked, and are not surveyed roof locations.",
      "Exact-PIN associations retain source-native records and unmatched address-only entities.",
      "Reported built year is a building-age proxy, not a roof installation or inspection date.",
      "Qualified recorded-index gaps do not prove legal ownership continuity or complete predecessor-parcel coverage.",
      "Issued, expired and unknown status observations are not source-confirmed open permits.",
      "Provider observations are excluded; official contractor mentions do not establish a verified job contractor, license or BBB rating.",
    ],
  });
  await canonicalWrite(output, "runs.json", {
    version: CURRENT_PUBLIC_PROFILE,
    historicalRuns: metadata.historicalRuns,
    priorPublications: options.priorPublications,
    current: options.run,
    sourceRevalidation: options.sourceRevalidation ?? [],
    qualification:
      "First publication of already-admitted official facts is not claimed as new source acquisition. Fresh identical source observations retain zero fact deltas.",
  });
  await canonicalWrite(output, "schema.json", {
    version: CURRENT_PUBLIC_PROFILE,
    contractVersion: CONTRACT_VERSION,
    tables: [
      ...tableNames.filter(
        (name) => !["properties", "source_row_dispositions"].includes(name),
      ),
      "source_row_profiles",
      "source_row_entities",
    ],
    views: [
      "properties",
      "source_row_dispositions",
      "roof_evidence",
      "latest_reported_sales",
    ],
    normalizedStorage:
      "Repeated source identity metadata is stored once per source/observed-at/schema profile and reconstructed losslessly by source_row_dispositions. properties is the existing exact source-derived parcel/address union view. All core query facts remain self-contained; public Parquets expose the full relations.",
    externalSourceArtifacts: ["official-source-records.parquet"],
    rawSourceArtifactsRequiredForCoreQueries: false,
    inlineEvidenceQualification:
      "Reviewed source notes are separate derived observations; canonical V9 permit dates remain unchanged, including legacy null closedAt.",
    queryMacros: [
      "properties_within",
      "roofs_within",
      "permits_within",
      "owners_within",
      "deed_gaps_within",
    ],
    permitModes: [
      "confirmed_open",
      "confirmed_closed",
      "lifecycle_unknown",
      "status_verification_needed",
    ],
    currentRootAndOwnCarExcludedFromOwnDag: true,
    reproducibility: {
      engine: "DuckDB v2.0.0",
      threads: 1,
      databaseCompression: "uncompressed",
      emptySeedSha256: EMPTY_SEED_SHA256,
      emptySeedBytes: 12288,
      emptySeedHasFactualTables: false,
      seedPath: "packages/publication/assets/duckdb-v2-empty.seed",
      qualification:
        "An explicit empty seed fixes the engine-generated random database identifier; every table, row, view and macro is recomputed from source inputs. No database headers or checksums are patched.",
    },
  });
  await canonicalWrite(output, "sample.json", {
    version: CURRENT_PUBLIC_PROFILE,
    records: (metadata.reconciliation as { representativeJoins: unknown })
      .representativeJoins,
  });
  const names = [
    ...tableNames.map((name) => name.replaceAll("_", "-") + ".parquet"),
    "official-source-records.parquet",
    "oakland-public.duckdb",
    "portable-queries.sql",
    "source-profiles.json",
    "reconciliation-report.json",
    "coverage.json",
    "runs.json",
    "schema.json",
    "sample.json",
  ];
  const artifacts = [];
  for (const name of names.sort())
    artifacts.push({
      name,
      ...(await publicFileDigest(path.join(output, name))),
    });
  const digest = sha256(stableJson(artifacts));
  const packed = await packCurrentPublicDirectory(output, names);
  const publication = {
    version: CURRENT_PUBLIC_PROFILE,
    state: "CURRENT_ROOT_LOCALLY_VERIFIED_NOT_YET_PUBLISHED",
    contractVersion: CONTRACT_VERSION,
    snapshotId: "oakland-public-" + digest.slice(0, 20),
    datasetDigest: digest,
    baseWorkingProjection: metadata.baseManifest,
    run: options.run,
    priorPublications: options.priorPublications,
    counts,
    ...packed,
    publicationEffects: 0,
    providerRestrictedRowsIncluded: false,
    publicManifestOutsideOwnDag: true,
    carAvailability:
      "Separate exact CAR download must be supplied by publication; the CAR cannot be inside its own DAG.",
  };
  await canonicalWrite(output, "publication-manifest.json", publication);
  return publication;
}
