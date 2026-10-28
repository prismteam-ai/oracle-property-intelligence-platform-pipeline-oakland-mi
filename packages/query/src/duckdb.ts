import {
  SOURCE_OBSERVATION_FILTER_SQL,
  RECORDED_DEED_FILTER_SQL,
  ROOFING_CANDIDATE_SQL,
} from "./source-predicates.ts";
import { resolveQueryPlace } from "../../places/src/index.ts";
import {
  PERMIT_EVIDENCE_SQL,
  needsPermitEvidence,
  hasMinimumVerifiedTenure,
} from "./predicates.ts";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import {
  CONTRACT_VERSION,
  DomainError,
  QuerySchema,
  SearchResponseSchema,
  type Property,
  type SearchResponse,
} from "../../contracts/src/index.ts";
import {
  SnapshotReader,
  observedPermitStatus,
  observedPermitOpenDays,
  latestReportedSale,
} from "./index.ts";
import { digest } from "../../identity/src/index.ts";
const distanceSql =
  "12742017.6 * asin(sqrt(least(1.0,pow(sin(radians(lat-$lat)/2),2)+cos(radians($lat))*cos(radians(lat))*pow(sin(radians(lng-$lng)/2),2))))";
export class DuckSnapshot {
  private constructor(
    readonly snapshotId: string,
    readonly rows: readonly Property[],
    readonly connection: DuckDBConnection,
    private instance: DuckDBInstance,
  ) {}
  static async create(
    snapshotId: string,
    rows: readonly Property[],
  ): Promise<DuckSnapshot> {
    const instance = await DuckDBInstance.create(":memory:", {
      threads: "2",
      memory_limit: "512MB",
      enable_external_access: "false",
    });
    const db = await instance.connect();
    await db.run(
      "CREATE TABLE properties (id VARCHAR PRIMARY KEY, lat DOUBLE, lng DOUBLE, age INTEGER, confidence INTEGER, payload JSON, reported_sale DATE, tenure_since DATE, tenure_from DATE, tenure_through DATE)",
    );
    await db.run(
      "CREATE TABLE permits (id VARCHAR, property_id VARCHAR, status VARCHAR, open_days INTEGER, kind VARCHAR, verified_company_id VARCHAR, canonical_json JSON)",
    );
    await db.run(
      "CREATE TABLE private_provider_observations(permit_id VARCHAR,provider_status VARCHAR,activity_claim VARCHAR,lifecycle VARCHAR,age_days INTEGER,continuous_open_days INTEGER)",
    );
    await db.run(
      "CREATE TABLE private_transfer_observations(property_id VARCHAR,claim_window_start DATE,observed_through DATE,last_deed_date DATE)",
    );
    const confidence = { high: 3, medium: 2, low: 1, unknown: 0 };
    for (const p of rows) {
      await db.run(
        "INSERT INTO properties VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          p.id,
          p.coordinates?.lat ?? null,
          p.coordinates?.lng ?? null,
          p.roof.ageYears,
          confidence[p.roof.confidence],
          JSON.stringify(p),
          latestReportedSale(p),
          hasMinimumVerifiedTenure(p, 0)
            ? p.ownership.uninterruptedTenure!.unchangedSince
            : null,
          hasMinimumVerifiedTenure(p, 0)
            ? p.ownership.transferHistoryCoverage!.from
            : null,
          hasMinimumVerifiedTenure(p, 0)
            ? p.ownership.transferHistoryCoverage!.through
            : null,
        ],
      );
      for (const row of p.ownership.recordedTransferIndexObservations ?? [])
        await db.run(
          "INSERT INTO private_transfer_observations VALUES($property,$start,$through,$deed)",
          {
            property: p.id,
            start: row.claimWindowStart,
            through: row.observedThrough,
            deed: row.lastRecordedDeedDate,
          },
        );
      for (const permit of p.permits) {
        for (const row of permit.sourceObservations ?? [])
          await db.run(
            "INSERT INTO private_provider_observations VALUES($permit,$status,$activity,$lifecycle,$age,$continuous)",
            {
              permit: permit.id,
              status: row.providerStatus,
              activity: row.activityClaim,
              lifecycle: row.supportedLifecycle,
              age: row.ageSinceIssueDays,
              continuous: row.continuousOpenDays,
            },
          );
        await db.run("INSERT INTO permits VALUES ($1,$2,$3,$4,$5,$6,$7)", [
          permit.id,
          p.id,
          observedPermitStatus(permit),
          observedPermitOpenDays(permit, p.roof.asOf),
          permit.kind,
          permit.contractor.verifiedCompanyId,
          JSON.stringify(permit),
        ]);
      }
    }
    return new DuckSnapshot(snapshotId, rows, db, instance);
  }
  async search(input: unknown): Promise<SearchResponse> {
    const q = QuerySchema.safeParse(input);
    if (!q.success)
      throw new DomainError(
        "INVALID_INPUT",
        "Search parameters outside contract",
      );
    const query = q.data;
    const placeResolution = resolveQueryPlace(query);
    if (query.snapshotId !== this.snapshotId)
      throw new DomainError(
        "SNAPSHOT_UNAVAILABLE",
        "Requested snapshot unavailable",
      );
    const { cursor, ...filter } = query;
    const queryHash = digest(filter);
    let offset = 0;
    if (cursor)
      try {
        const c = JSON.parse(Buffer.from(cursor, "base64url").toString()) as {
          snapshotId: string;
          queryHash: string;
          offset: number;
        };
        if (
          c.snapshotId !== this.snapshotId ||
          c.queryHash !== queryHash ||
          !Number.isSafeInteger(c.offset) ||
          c.offset < 0
        )
          throw new Error();
        offset = c.offset;
      } catch {
        throw new DomainError(
          "INVALID_CURSOR",
          "Cursor belongs to another snapshot/filter",
        );
      }
    const confidence = { any: 0, high: 3, medium: 2, low: 1 };
    const sql = `WITH matches AS (
      SELECT id,payload,age,${distanceSql} AS distance,
      (SELECT max(x.open_days) FROM permits x WHERE x.property_id=p.id AND x.status='open' AND ${ROOFING_CANDIDATE_SQL} AND ($status='any' OR x.status=$status) AND ($days=0 OR x.open_days >= $days) ${PERMIT_EVIDENCE_SQL} ${SOURCE_OBSERVATION_FILTER_SQL}) AS priority
      FROM properties p WHERE lat IS NOT NULL AND confidence >= $confidence
      ${RECORDED_DEED_FILTER_SQL}
      AND ($roof IS NULL OR age > $roof OR ($unknown AND age IS NULL))
      AND ($owner='any' OR coalesce(json_extract_string(payload,'$.ownership.ownerRegion'),'unknown')=$owner)
      AND ($years IS NULL OR (tenure_since IS NOT NULL
        AND tenure_since + CAST($years AS INTEGER)*INTERVAL '1 year' <= CAST(json_extract_string(payload,'$.roof.asOf') AS DATE)
        AND tenure_from + CAST($years AS INTEGER)*INTERVAL '1 year' <= CAST(json_extract_string(payload,'$.roof.asOf') AS DATE)
        AND tenure_through >= CAST(json_extract_string(payload,'$.roof.asOf') AS DATE)))
      AND ($reportedSaleAge IS NULL OR (reported_sale IS NOT NULL
        AND reported_sale <= CAST(json_extract_string(payload,'$.roof.asOf') AS DATE)
        AND reported_sale < CAST(json_extract_string(payload,'$.roof.asOf') AS DATE) - CAST($reportedSaleAge AS INTEGER)*INTERVAL '1 year'))
      AND (($status='any' AND $days=0 AND NOT $evidenceRequired)
        OR EXISTS(SELECT 1 FROM permits x WHERE x.property_id=p.id AND ${ROOFING_CANDIDATE_SQL}
          AND ($status='any' OR x.status=$status)
          AND ($days=0 OR (x.status='open' AND x.open_days >= $days))
          ${PERMIT_EVIDENCE_SQL} ${SOURCE_OBSERVATION_FILTER_SQL})))
      SELECT payload,distance,count(*) OVER() AS total FROM matches WHERE distance <= $radius
      ORDER BY CASE WHEN $sortRoof THEN age ELSE NULL END DESC NULLS LAST,
        CASE WHEN $prioritize THEN coalesce(priority,-1) ELSE -1 END DESC,distance,id
      LIMIT $limit OFFSET $offset`;
    const result = await this.connection.run(sql, {
      lat: query.lat,
      lng: query.lng,
      confidence: confidence[query.minConfidence],
      roof: query.roofMinAgeYears ?? null,
      unknown: query.includeUnknown,
      status: query.permitStatus,
      sourceRequired:
        query.providerPermitStatus !== undefined ||
        query.permitActivityClaim !== undefined ||
        query.minPermitAgeSinceIssueDays !== undefined,
      providerStatus: query.providerPermitStatus ?? null,
      activityClaim: query.permitActivityClaim ?? null,
      issueAge: query.minPermitAgeSinceIssueDays ?? null,
      deedGap: query.minRecordedDeedGapYears ?? null,
      allowProviderRoof:
        query.minOpenDays === 0 &&
        query.permitActivityClaim !== "native_reported_open",
      days: query.minOpenDays,
      owner: query.ownerRegion ?? "any",
      years: query.minOwnershipYears ?? null,
      reportedSaleAge: query.minReportedSaleAgeYears ?? null,
      radius: query.radiusMeters,
      prioritize:
        query.sort === "permit_open_days_desc" ||
        (!query.sort &&
          (query.permitStatus === "open" || query.minOpenDays > 0)),
      sortRoof: query.sort === "roof_age_desc",
      evidenceRequired: needsPermitEvidence(query),
      requiresContractor: Boolean(query.requiresContractor),
      requiresVerifiedLicense: Boolean(query.requiresVerifiedLicense),
      requiresBbbRating: Boolean(query.requiresBbbRating),
      limit: query.limit,
      offset,
    });
    const native = await result.getRowObjectsJson();
    // Count remains exact even if a caller pages beyond the final row.
    const total = native.length
      ? Number(native[0]!.total)
      : new SnapshotReader(this.snapshotId, this.rows).search({
          ...query,
          cursor: undefined,
          limit: 1,
        }).total;
    const rows = native.map((r) => ({
      ...(JSON.parse(String(r.payload)) as Property),
      distanceMeters: Number(r.distance),
    }));
    const more = offset + rows.length < total;
    return SearchResponseSchema.parse({
      contractVersion: CONTRACT_VERSION,
      snapshotId: this.snapshotId,
      queryHash,
      placeResolution,
      rows,
      total,
      truncated: more,
      nextCursor: more
        ? Buffer.from(
            JSON.stringify({
              snapshotId: this.snapshotId,
              queryHash,
              offset: offset + rows.length,
            }),
          ).toString("base64url")
        : null,
      limitations: [
        "P1 fixture/sample scope, not county coverage",
        "Local DuckDB accepted-snapshot query; no upstream MCP deployment",
        "No actual public CID or provider persistence verified",
        ...(query.minReportedSaleAgeYears !== undefined
          ? [
              "Reported-sale age uses only the latest observed reported-sale event and snapshot date. Partial observations do not establish ownership tenure or rule out unobserved later sales; unknown dates are excluded.",
            ]
          : []),
      ],
    });
  }
  close(): void {
    this.connection.closeSync();
    this.instance.closeSync();
  }
}
