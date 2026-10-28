import { realpath } from "node:fs/promises";
import type { DuckDBConnection } from "@duckdb/node-api";
import {
  FULL_SOURCE_COLUMNS,
  FULL_SOURCE_DEFINITIONS,
  type FullSourceConfig,
  type FullSourceAudit,
} from "../../county/src/private-full-source.ts";
import { PRIVATE_PERMIT_LIMIT } from "../../county/src/private-permits.ts";
import { projectAssessmentRow } from "../../county/src/private-assessment.ts";
import { projectRochesterReportRow } from "../../county/src/private-rochester.ts";
import { normalizeTroyAddress } from "../../county/src/troy.ts";
import { quote, text } from "./real-utils.ts";
import type { ProtectedPermitProjection } from "./real-loader-types.ts";
/** Validated full-source projections remain local to the protected DuckDB connection. */
export async function loadFullSources(args: {
  db: DuckDBConnection;
  fullSources: readonly FullSourceConfig[];
  snapshotId: string;
  checkPrivate: (file: string, expected: string | undefined) => Promise<void>;
  insertProtectedPermits: (
    input: readonly ProtectedPermitProjection[],
  ) => Promise<void>;
  permitCount: number;
  permitSourceCounts: Record<string, number>;
  fullSourceAudits: FullSourceAudit[];
  allowedSourcePaths: string[];
  overlayDigests: string[];
}) {
  const {
    db,
    fullSources,
    snapshotId,
    checkPrivate,
    insertProtectedPermits,
    permitSourceCounts,
    fullSourceAudits,
    allowedSourcePaths,
    overlayDigests,
  } = args;
  let permitCount = args.permitCount;
  for (const config of fullSources) {
    const definition = FULL_SOURCE_DEFINITIONS[config.role];
    let addressDisagreements = 0;
    await checkPrivate(config.file, config.sha256);
    const file = await realpath(config.file);
    await db.run(
      `CREATE VIEW ${definition.table} AS SELECT * FROM read_parquet(${quote(file)})`,
    );
    const columns = await (
      await db.run(`PRAGMA table_info('${definition.table}')`)
    ).getRowObjectsJson();
    if (
      columns.length !== FULL_SOURCE_COLUMNS.length ||
      columns.some(
        (c, i) => c.name !== FULL_SOURCE_COLUMNS[i] || c.type !== "VARCHAR",
      )
    )
      throw new Error("Protected full-source outer schema rejected");
    const summary = await (
      await db.run(
        `SELECT count(*) AS records,count(DISTINCT native_id) AS unique_ids,count(*) FILTER(WHERE property_id IS NOT NULL) AS matched,count(*) FILTER(WHERE property_id IS NULL) AS unassigned,count(*) FILTER(WHERE version IS NULL OR version!=$version OR source_id IS NULL OR source_id!=$source OR public_snapshot_id IS NULL OR public_snapshot_id!=$snapshot OR source_schema_sha256 IS NULL OR source_schema_sha256!=$schema OR native_id IS NULL OR NOT regexp_full_match(native_id,$nativePattern) OR record_digest IS NULL OR NOT regexp_full_match(record_digest,'[a-f0-9]{64}') OR observed_at IS NULL OR NOT regexp_full_match(observed_at,'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z')) AS invalid FROM ${definition.table}`,
        {
          nativePattern: definition.nativeIdPattern,
          version: definition.version,
          source: definition.sourceId,
          snapshot: snapshotId,
          schema: config.sourceSchemaSha256,
        },
      )
    ).getRowObjectsJson();
    const row = summary[0]!;
    if (
      Number(row.records) !== config.sourceRecordCount ||
      Number(row.records) > definition.maximum ||
      Number(row.unique_ids) !== Number(row.records) ||
      Number(row.invalid) !== 0
    )
      throw new Error(
        "Protected full-source metadata/native/count binding rejected",
      );
    const bindings = await (
      await db.run(
        `WITH canonical AS(SELECT id,count(*) AS n FROM properties GROUP BY id) SELECT count(*) AS invalid FROM ${definition.table} r LEFT JOIN canonical p ON p.id=r.property_id WHERE r.property_id IS NOT NULL AND coalesce(p.n,0)!=1`,
      )
    ).getRowObjectsJson();
    if (Number(bindings[0]!.invalid))
      throw new Error("Protected full-source property binding rejected");
    if (config.role === "municipal-source") {
      const alignment = await (
        await db.run(
          `
      SELECT count(*) AS invalid FROM ${definition.table} s
      FULL OUTER JOIN (SELECT * FROM permits WHERE source_id=$source) p
        ON s.native_id=p.native_id
      WHERE (s.property_id IS NOT NULL OR p.native_id IS NOT NULL) AND (
        s.native_id IS NULL OR p.native_id IS NULL OR
        s.property_id IS DISTINCT FROM p.property_id OR
        s.record_digest IS DISTINCT FROM p.receipt_digest OR
        s.observed_at IS DISTINCT FROM p.observed_at OR
        json_extract_string(s.source_record_json,'$.attributes.Status') IS DISTINCT FROM json_extract_string(p.canonical_json,'$.reportedStatus') OR
        json_extract_string(s.source_record_json,'$.attributes.Permit_Number') IS DISTINCT FROM json_extract_string(p.canonical_json,'$.permitNumber')
      )`,
          { source: definition.sourceId },
        )
      ).getRowObjectsJson();
      if (Number(alignment[0]!.invalid))
        throw new Error("Protected municipal source/permit alignment rejected");
    }
    if (config.role === "rochester-source") {
      const inputs = await (
        await db.run(`SELECT * FROM ${definition.table} ORDER BY native_id`)
      ).getRowObjectsJson();
      const projected = inputs.map((candidate) =>
        projectRochesterReportRow(
          candidate,
          snapshotId,
          config.sourceSchemaSha256,
        ),
      );
      // Recheck the producer's exact, unique address/jurisdiction assignment
      // against this pinned public snapshot, including retained unassigned rows.
      const addresses = await (
        await db.run(
          "SELECT p.id,p.address AS parcel_address,a.address AS site_address FROM properties p LEFT JOIN parcel_address_links l ON l.property_id=p.id LEFT JOIN site_addresses a ON a.id=l.address_id WHERE p.jurisdiction_name=$jurisdiction",
          { jurisdiction: "CITY OF ROCHESTER HILLS" },
        )
      ).getRowObjectsJson();
      const addressIndex = new Map<string, Set<string>>();
      for (const a of addresses)
        for (const value of [a.parcel_address, a.site_address]) {
          const key = normalizeTroyAddress(text(value));
          if (!key) continue;
          const ids = addressIndex.get(key) ?? new Set<string>();
          ids.add(String(a.id));
          addressIndex.set(key, ids);
        }
      for (const x of projected) {
        const candidates = [
          ...(addressIndex.get(
            normalizeTroyAddress(x.source.propertyAddressRaw),
          ) ?? []),
        ];
        const expected = candidates.length === 1 ? candidates[0] : null;
        if (x.row.property_id !== expected)
          throw Error(
            "Protected report exact-address/jurisdiction assignment rejected",
          );
      }
      const permits = projected.flatMap((x) =>
        x.permit ? [{ ...x, permit: x.permit }] : [],
      );
      if (permitCount + permits.length > PRIVATE_PERMIT_LIMIT)
        throw Error("Combined protected permit bound rejected");
      await insertProtectedPermits(permits);
      const collisions = await (
        await db.run("SELECT count(*)-count(DISTINCT id) AS n FROM permits")
      ).getRowObjectsJson();
      if (Number(collisions[0]!.n))
        throw Error("Protected report permit identity collision rejected");
      permitCount += permits.length;
      permitSourceCounts[definition.sourceId] = permits.length;
      for (let offset = 0; offset < projected.length; offset += 256) {
        const rows = projected.slice(offset, offset + 256).flatMap((x) =>
          x.owner
            ? [
                {
                  property_id: x.row.property_id,
                  source_id: x.row.source_id,
                  native_id: x.row.native_id,
                  canonical_json: JSON.stringify(x.owner),
                },
              ]
            : [],
        );
        await db.run(
          "INSERT INTO private_reported_owner_observations SELECT json_extract_string(value,'$.property_id'),json_extract_string(value,'$.source_id'),json_extract_string(value,'$.native_id'),json_extract_string(value,'$.canonical_json') FROM json_each($rows)",
          { rows: JSON.stringify(rows) },
        );
      }
      const overflow = await (
        await db.run(
          "SELECT count(*) AS n FROM (SELECT property_id FROM private_reported_owner_observations GROUP BY property_id HAVING count(*)>256)",
        )
      ).getRowObjectsJson();
      if (Number(overflow[0]!.n))
        throw Error("Protected reported-owner property bound rejected");
    }
    if (config.role === "assessment-source") {
      const inputs = await (
        await db.run(`SELECT * FROM ${definition.table} ORDER BY native_id`)
      ).getRowObjectsJson();
      const projections = inputs.map((candidate) =>
        projectAssessmentRow(candidate, snapshotId, config.sourceSchemaSha256),
      );
      for (const x of projections) {
        const matches = await (
          await db.run(
            "SELECT p.id,p.address,a.address AS site_address FROM properties p LEFT JOIN parcel_address_links l ON l.property_id=p.id LEFT JOIN site_addresses a ON a.id=l.address_id WHERE p.pin=$pin AND p.jurisdiction_name='CITY OF TROY'",
            { pin: x.source.normalizedCountyPin },
          )
        ).getRowObjectsJson();
        const propertyIds = [...new Set(matches.map((m) => String(m.id)))];
        const expected = propertyIds.length === 1 ? propertyIds[0] : null;
        const sourceAddress = [
          x.source.fields["Property Address"],
          x.source.fields["Property Address Apt"],
        ]
          .filter((v) => v?.trim())
          .join(" ");
        if (x.row.property_id !== expected)
          throw Error(
            "Protected assessment exact-PIN/jurisdiction assignment rejected",
          );
        if (x.row.property_id === null) continue;
        const addressAgrees = Boolean(
          normalizeTroyAddress(sourceAddress) &&
          matches.some((m) =>
            [m.address, m.site_address].some(
              (a) =>
                normalizeTroyAddress(text(a)) ===
                normalizeTroyAddress(sourceAddress),
            ),
          ),
        );
        if (!addressAgrees) addressDisagreements++;
        const matchCaveat = addressAgrees
          ? "Associated by the exact unique printed parcel number and jurisdiction; normalized street address text also agrees."
          : "Associated by the exact unique printed parcel number and jurisdiction. Source and county street address text differs; no street-number word or suffix equivalence is asserted. This is a medium-confidence source association, not verified ownership.";
        await db.run(
          "INSERT INTO private_assessment_match VALUES($id,$caveat)",
          {
            id: x.row.property_id,
            caveat:
              matchCaveat +
              " Building summary fields relate to the parcel report; no specific building, unit or roof identity is verified.",
          },
        );
        for (const owner of x.owners)
          await db.run(
            "INSERT INTO private_reported_owner_observations VALUES($property,$source,$native,$json)",
            {
              property: x.row.property_id,
              source: x.row.source_id,
              native: x.row.native_id + ":" + owner.sourceLabel,
              json: JSON.stringify({
                ...owner,
                limitations: [...owner.limitations, matchCaveat],
              }),
            },
          );
        // A missing/unrecognized new postal state must not erase an older valid observation.
        if (x.location.ownerRegion !== "unknown") {
          await db.run(
            "UPDATE owner_derivatives SET owner_region=$region,location_class=$location,site_address_match=NULL,observed_at=$at,evidence_class=$class WHERE property_id=$id",
            {
              region: x.location.ownerRegion,
              location: x.location.locationClass,
              at: x.location.observedAt,
              class: x.location.evidenceClass,
              id: x.row.property_id,
            },
          );
          await db.run(
            "INSERT INTO owner_derivatives(property_id,owner_region,location_class,site_address_match,observed_at,evidence_class) SELECT $id,$region,$location,NULL,$at,$class WHERE NOT EXISTS(SELECT 1 FROM owner_derivatives WHERE property_id=$id)",
            {
              region: x.location.ownerRegion,
              location: x.location.locationClass,
              at: x.location.observedAt,
              class: x.location.evidenceClass,
              id: x.row.property_id,
            },
          );
          await db.run(
            "INSERT INTO private_owner_location_provenance VALUES($id,$json)",
            {
              id: x.row.property_id,
              json: JSON.stringify(x.provenance[0]),
            },
          );
        }
        if (x.builtYear !== null || x.reportedSaleDate !== null)
          await db.run(
            "INSERT INTO protected_enrichment(property_id,source_id,native_id,built_year,sale_date,receipt_digest,observed_at,page,line,record_digest,public_snapshot_id) VALUES($property,$source,$native,$year,$sale,$capture,$at,NULL,NULL,$digest,$snapshot)",
            {
              property: x.row.property_id,
              source: x.row.source_id,
              native: x.row.native_id,
              year: x.builtYear,
              sale: x.reportedSaleDate,
              capture: x.source.captureSha256,
              at: x.row.observed_at,
              digest: x.row.record_digest,
              snapshot: snapshotId,
            },
          );
      }
      const overflow = await (
        await db.run(
          "SELECT count(*) AS n FROM (SELECT property_id FROM private_reported_owner_observations GROUP BY property_id HAVING count(*)>256)",
        )
      ).getRowObjectsJson();
      if (Number(overflow[0]!.n))
        throw Error("Protected reported-owner property bound rejected");
    }
    fullSourceAudits.push({
      role: config.role,
      sourceId: definition.sourceId,
      table: definition.table,
      records: Number(row.records),
      uniqueNativeIds: Number(row.unique_ids),
      matched: Number(row.matched),
      unassigned: Number(row.unassigned),
      sourceSchemaSha256: config.sourceSchemaSha256,
      sourceValidationSha256: config.sourceValidationSha256,
      sourceValidatedOffline: true,
      rawRowsReturned: false,
      ...(config.role === "assessment-source"
        ? {
            addressDisagreements,
            matchMethod: "exact_normalized_parcel_and_jurisdiction" as const,
          }
        : {}),
    });
    allowedSourcePaths.push(file);
    overlayDigests.push(config.role + ":" + config.sha256);
  }
  return permitCount;
}
