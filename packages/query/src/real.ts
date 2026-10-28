import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import {
  CONTRACT_VERSION,
  DomainError,
  PropertySchema,
  QuerySchema,
  SearchResponseSchema,
  type Property,
  type SearchResponse,
} from "../../contracts/src/index.ts";
import {
  sha256,
  PROPERTY_VIEW_SQL,
  COUNTY_LIMITATIONS,
  OWNER_DERIVATION_VERSION,
} from "../../county/src/model.ts";
import type { ArtifactManifest } from "../../county/src/build.ts";
import {
  PRIVATE_PERMIT_LIMIT,
  validateProtectedPermitRow,
} from "../../county/src/private-permits.ts";
const CORE_FILES = [
  "parcels.parquet",
  "site-addresses.parquet",
  "parcel-address-links.parquet",
  "permits.parquet",
  "coverage.json",
  "runs.json",
  "dataset-manifest.json",
  "schema.json",
  "sample.json",
];
const distanceSql =
  "12742017.6*asin(sqrt(least(1.0,pow(sin(radians(a.lat-$lat)/2),2)+cos(radians($lat))*cos(radians(a.lat))*pow(sin(radians(a.lng-$lng)/2),2))))";
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
type Row = Record<string, unknown>;
function text(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}
export async function verifySnapshotDirectory(
  directory: string,
): Promise<{ directory: string; manifest: ArtifactManifest }> {
  if ((await lstat(directory)).isSymbolicLink())
    throw new Error("Snapshot directory must not be a symlink");
  const root = await realpath(directory);
  const manifestPath = path.join(root, "artifact-manifest.json");
  if ((await lstat(manifestPath)).isSymbolicLink())
    throw new Error("Manifest symlink rejected");
  const raw = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as ArtifactManifest;
  if (
    raw.version !== "1" ||
    ![CONTRACT_VERSION, "0.2.1"].includes(raw.contractVersion) ||
    !/^oakland-real-[a-f0-9]{20}$/.test(raw.snapshotId) ||
    !/^[a-f0-9]{64}$/.test(raw.digest) ||
    !Number.isSafeInteger(raw.count) ||
    raw.count < 1 ||
    !Array.isArray(raw.files) ||
    raw.files.length !== CORE_FILES.length
  )
    throw new Error("Invalid snapshot manifest");
  const names = new Set<string>();
  let total = 0;
  for (const f of raw.files) {
    if (
      !CORE_FILES.includes(f.name) ||
      names.has(f.name) ||
      !Number.isSafeInteger(f.bytes) ||
      f.bytes < 0 ||
      f.bytes > 512 * 1024 ** 2 ||
      !/^[a-f0-9]{64}$/.test(f.sha256)
    )
      throw new Error("Unsafe/duplicate snapshot manifest entry");
    names.add(f.name);
    const p = path.join(root, f.name),
      s = await lstat(p);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink > 1 || s.size !== f.bytes)
      throw new Error("Unsafe or wrong-size snapshot file");
    total += s.size;
    if (total > 1024 ** 3)
      throw new Error("Snapshot exceeds bounded local load");
    if (sha256(await readFile(p)) !== f.sha256)
      throw new Error("Snapshot content integrity failure");
  }
  const dataset = JSON.parse(
    await readFile(path.join(root, "dataset-manifest.json"), "utf8"),
  ) as { snapshotId?: string; digest?: string };
  if (dataset.snapshotId !== raw.snapshotId || dataset.digest !== raw.digest)
    throw new Error("Snapshot identity mismatch");
  return { directory: root, manifest: raw };
}
export class RealSnapshot {
  readonly mode = "real" as const;
  readonly snapshotId: string;
  readonly digest: string;
  readonly count: number;
  readonly addressCount: number;
  readonly coverage: unknown[];
  readonly runs: unknown[];
  readonly manifest: ArtifactManifest;
  readonly publicSnapshotId: string;
  readonly protectedSignals: boolean;
  private constructor(
    manifest: ArtifactManifest,
    private connection: DuckDBConnection,
    private instance: DuckDBInstance,
    coverage: unknown,
    runs: unknown[],
    readonly ownerSignalsAvailable: boolean,
    overlayDigests: readonly string[],
    readonly permitCount: number,
  ) {
    this.publicSnapshotId = manifest.snapshotId;
    this.protectedSignals = overlayDigests.length > 0;
    this.digest = overlayDigests.length
      ? sha256(
          JSON.stringify({
            publicDigest: manifest.digest,
            protectedDigests: [...overlayDigests].sort(),
          }),
        )
      : manifest.digest;
    this.snapshotId = overlayDigests.length
      ? manifest.snapshotId + "-protected-" + this.digest.slice(0, 20)
      : manifest.snapshotId;
    this.manifest = {
      ...manifest,
      snapshotId: this.snapshotId,
      digest: this.digest,
      ...(overlayDigests.length
        ? { publicSnapshotId: manifest.snapshotId, protectedView: true }
        : {}),
    };
    this.count = manifest.count;
    this.addressCount = manifest.addressCount;
    this.coverage = [
      coverage,
      ...(overlayDigests.length
        ? [
            {
              source: "Protected operational observations",
              scope:
                "Authenticated operational model only; excluded from public artifacts",
              state: "partial",
              count: null,
              limitations: [
                "Owner location is derived from postal state, not a county or tenure inference.",
                "Official sales cohorts are partial; built year is a low-confidence roof proxy, not an observed replacement.",
                "No private observation is promoted to public bytes without redistribution approval.",
                "Troy permit observations are a stratified partial cohort selected by a roof mention. Original non-roof permit types remain retained; only explicit roofing scope qualifies for roofing predicates. Issuance does not establish open status or completed work.",
                "The Troy Applicant field is retained only for clearly reported businesses. It does not establish contractor role; license metadata describes that reported business.",
              ],
              permitCount,
            },
          ]
        : []),
    ];
    this.runs = runs;
  }
  static async open(
    directory: string,
    options: {
      protectedDerivativeFile?: string;
      protectedDerivativeSha256?: string;
      protectedEnrichmentFile?: string;
      protectedEnrichmentSha256?: string;
      protectedPermitsFile?: string;
      protectedPermitsSha256?: string;
    } = {},
  ): Promise<RealSnapshot> {
    const verified = await verifySnapshotDirectory(directory);
    const root = verified.directory;
    const instance = await DuckDBInstance.create(":memory:", {
      threads: "2",
      memory_limit: "1024MB",
    });
    const db = await instance.connect();
    const overlayDigests: string[] = [];
    let permitCount = 0;
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
      await db.run(PROPERTY_VIEW_SQL);
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
        for (const { row, permit, openDays } of validated) {
          await db.run(
            "INSERT INTO permits(property_id,id,status,kind,opened_at,closed_at,open_days,reported_contractor,verified_company_id,license,rating,source_id,native_id,receipt_digest,observed_at,canonical_json) VALUES($property,$id,$status,$kind,$opened,$closed,$days,$reported,$company,$license,$rating,$source,$native,$digest,$observed,$canonical)",
            {
              property: row.property_id,
              id: permit.id,
              status: permit.status,
              kind: permit.kind,
              opened: permit.openedAt,
              closed: permit.closedAt,
              days: openDays,
              reported: permit.contractor.reportedName,
              company: permit.contractor.verifiedCompanyId,
              license: permit.contractor.license,
              rating: permit.contractor.rating,
              source: row.source_id,
              native: row.native_id,
              digest: row.record_digest,
              observed: row.observed_at,
              canonical: JSON.stringify(permit),
            },
          );
        }
        permitCount = rows.length;
        overlayDigests.push("permits:" + options.protectedPermitsSha256);
        await db.run("DROP TABLE protected_permit_rows");
      }
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
      await db.run("SET enable_external_access=false");
      return new RealSnapshot(
        verified.manifest,
        db,
        instance,
        JSON.parse(
          await readFile(path.join(root, "coverage.json"), "utf8"),
        ) as unknown,
        JSON.parse(
          await readFile(path.join(root, "runs.json"), "utf8"),
        ) as unknown[],
        Boolean(options.protectedDerivativeFile),
        overlayDigests,
        permitCount,
      );
    } catch (error) {
      db.closeSync();
      instance.closeSync();
      throw error;
    }
  }
  private async property(
    row: Row,
    nearest?: { lat: number; lng: number },
  ): Promise<Property> {
    const id = String(row.id);
    const addresses = await (
      await this.connection.run(
        "SELECT a.* FROM parcel_address_links l JOIN site_addresses a ON a.id=l.address_id WHERE l.property_id=$id ORDER BY a.id LIMIT 25",
        { id },
      )
    ).getRowObjectsJson();
    const count = await (
      await this.connection.run(
        "SELECT count(*) AS n FROM parcel_address_links WHERE property_id=$id",
        { id },
      )
    ).getRowObjectsJson();
    const provenance = (r: Row) => [
      {
        sourceId: String(r.source_id),
        recordId: String(r.native_id),
        observedAt: String(r.observed_at),
        digest: String(r.content_hash),
        kind: "real-public" as const,
      },
    ];
    const siteAddresses = addresses.map((a) => ({
      id: String(a.id),
      nativeId: String(a.native_id),
      address: text(a.address) ?? "No site address reported",
      city: text(a.city),
      state: text(a.state),
      postalCode: text(a.postal_code),
      coordinates:
        a.lat !== null && a.lng !== null
          ? { lat: Number(a.lat), lng: Number(a.lng) }
          : null,
      provenance: provenance(a),
    }));
    const representative =
      siteAddresses.find((a) => a.coordinates)?.coordinates ?? null;
    const owner = await (
      await this.connection.run(
        "SELECT * FROM owner_derivatives WHERE property_id=$id",
        { id },
      )
    ).getRowObjectsJson();
    const o = owner[0];
    const enrichment = await (
      await this.connection.run(
        "SELECT * FROM protected_enrichment WHERE property_id=$id ORDER BY source_id,native_id LIMIT 50",
        { id },
      )
    ).getRowObjectsJson();
    const builtYears = [
      ...new Set(
        enrichment
          .filter((e) => e.built_year !== null)
          .map((e) => Number(e.built_year)),
      ),
    ];
    const builtYear = builtYears.length === 1 ? builtYears[0]! : null;
    const asOf = String(row.observed_at).slice(0, 10);
    const privateProvenance = (e: Row) => ({
      sourceId: String(e.source_id),
      recordId:
        String(e.native_id) +
        ":page:" +
        String(e.page) +
        ":line:" +
        String(e.line),
      observedAt: String(e.observed_at),
      digest: String(e.record_digest),
      kind: "real-minimized" as const,
    });
    const permits = await (
      await this.connection.run(
        "SELECT * FROM permits WHERE property_id=$id ORDER BY id LIMIT $bound",
        { id, bound: PRIVATE_PERMIT_LIMIT },
      )
    ).getRowObjectsJson();
    return PropertySchema.parse({
      id,
      nativeId: String(row.native_id),
      parcelIds:
        String(row.source_id) === "oakland-tax-parcel-plus" ? [id] : [],
      parcelIdentifiers: { pin: text(row.pin), keypin: text(row.keypin) },
      jurisdiction: {
        code: text(row.jurisdiction_code),
        name: text(row.jurisdiction_name),
      },
      sourceRevisionDate: text(row.revision_date),
      address:
        text(row.address) ??
        siteAddresses[0]?.address ??
        "No site address reported",
      usage: "unknown",
      coordinates: nearest ?? representative,
      coordinateBasis: nearest
        ? "nearest_official_site_address"
        : representative
          ? "official_site_address"
          : "unknown",
      siteAddresses,
      siteAddressCount: Number(count[0]!.n),
      siteAddressesTruncated: Number(count[0]!.n) > siteAddresses.length,
      evidenceClass: "source_reported",
      roof: {
        ageYears:
          builtYear === null
            ? null
            : Math.max(0, Number(asOf.slice(0, 4)) - builtYear),
        basis: builtYear === null ? "unknown" : "built_year",
        confidence: builtYear === null ? "unknown" : "low",
        asOf,
        caveats:
          builtYear === null
            ? [
                builtYears.length > 1
                  ? "Conflicting source-reported built years; age remains unknown."
                  : "Selected official layers do not establish roof age or installation.",
              ]
            : [
                `Source-reported building year: ${builtYear}. This is a building year proxy, not a verified roof installation year.`,
                "Protected official assessor report year-built proxy; unobserved roof replacements may exist. Municipal redistribution rights remain unverified.",
              ],
        provenance: enrichment
          .filter((e) => e.built_year !== null)
          .map(privateProvenance),
        evidenceClass:
          builtYear === null ? "unknown" : "derived_deterministically",
      },
      permits: permits.map((p) =>
        p.canonical_json
          ? (JSON.parse(String(p.canonical_json)) as unknown)
          : {
              id: String(p.id),
              status: String(p.status),
              kind: String(p.kind),
              openedAt: text(p.opened_at),
              closedAt: text(p.closed_at),
              contractor: {
                reportedName: text(p.reported_contractor),
                verifiedCompanyId: text(p.verified_company_id),
                license: text(p.license),
                rating: p.rating === null ? null : Number(p.rating),
              },
              provenance: [
                {
                  sourceId: String(p.source_id),
                  recordId: String(p.native_id),
                  digest: String(p.receipt_digest),
                  observedAt: String(p.observed_at),
                  kind: "real-public",
                },
              ],
            },
      ),
      ownership: {
        lastTransferDate: null,
        events: enrichment
          .filter((e) => e.sale_date !== null)
          .map((e) => ({
            id: String(e.source_id) + ":" + String(e.native_id),
            kind: "reported_sale",
            date: String(e.sale_date),
            provenance: [privateProvenance(e)],
          })),
        historyCoverage: enrichment.some((e) => e.sale_date !== null)
          ? "partial"
          : "unknown",
        ownerRegion: o?.owner_region ?? "unknown",
        locationClass: o?.location_class ?? "unknown",
        siteAddressMatch: o?.site_address_match ?? null,
        observedAt: o?.observed_at ?? null,
        evidenceClass: o?.evidence_class ?? "unknown",
      },
      provenance: provenance(row),
    });
  }
  async detail(id: string, snapshotId: string): Promise<Property> {
    if (snapshotId !== this.snapshotId)
      throw new DomainError(
        "SNAPSHOT_UNAVAILABLE",
        "Requested snapshot unavailable",
      );
    if (id.length > 200)
      throw new DomainError("INVALID_INPUT", "Invalid property identity");
    const rows = await (
      await this.connection.run("SELECT * FROM properties WHERE id=$id", { id })
    ).getRowObjectsJson();
    if (!rows[0]) throw new DomainError("INVALID_INPUT", "Property not found");
    return this.property(rows[0]);
  }
  async search(input: unknown): Promise<SearchResponse> {
    const parsed = QuerySchema.safeParse(input);
    if (!parsed.success)
      throw new DomainError(
        "INVALID_INPUT",
        "Search parameters outside contract",
      );
    const q = parsed.data;
    if (q.snapshotId !== this.snapshotId)
      throw new DomainError(
        "SNAPSHOT_UNAVAILABLE",
        "Requested snapshot unavailable",
      );
    if (q.minOwnershipYears !== undefined)
      throw new DomainError(
        "UNSUPPORTED_TOOL",
        "Ownership tenure is unknown: no legitimate transfer-event source is present. Source revision date is not a transfer date.",
      );
    if (
      q.ownerRegion &&
      q.ownerRegion !== "any" &&
      q.ownerRegion !== "unknown" &&
      !this.ownerSignalsAvailable
    )
      throw new DomainError(
        "NOT_AUTHORIZED",
        "Owner-location derivatives are available only in the protected operational read model.",
      );
    const { cursor, ...filter } = q;
    const queryHash = sha256(JSON.stringify(filter));
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
          c.offset < 0 ||
          c.offset > 10000000
        )
          throw new Error();
        offset = c.offset;
      } catch {
        throw new DomainError(
          "INVALID_CURSOR",
          "Cursor belongs to another snapshot/filter",
        );
      }
    const delta = q.radiusMeters / 6371008.8;
    const latMargin = (delta * 180) / Math.PI;
    const lonMargin =
      Math.abs(q.lat) + latMargin >= 90
        ? 180
        : (Math.asin(
            Math.min(1, Math.sin(delta) / Math.cos((q.lat * Math.PI) / 180)),
          ) *
            180) /
          Math.PI;
    const rawMin = q.lng - lonMargin,
      rawMax = q.lng + lonMargin;
    const wrapped = rawMin < -180 || rawMax > 180;
    const minLng = rawMin < -180 ? rawMin + 360 : rawMin,
      maxLng = rawMax > 180 ? rawMax - 360 : rawMax;
    const statusRequired = q.permitStatus !== "any" || q.minOpenDays > 0;
    const params = {
      lat: q.lat,
      lng: q.lng,
      minLat: Math.max(-90, q.lat - latMargin),
      maxLat: Math.min(90, q.lat + latMargin),
      minLng,
      maxLng,
      allLng: lonMargin === 180,
      wrapped,
      radius: q.radiusMeters,
      roof: q.roofMinAgeYears ?? null,
      reportedSaleAge: q.minReportedSaleAgeYears ?? null,
      includeUnknown: q.includeUnknown,
      minConfidence: q.minConfidence,
      owner: q.ownerRegion ?? "any",
      statusRequired,
      status: q.permitStatus,
      days: q.minOpenDays,
      limit: q.limit,
      offset,
      prioritize: q.permitStatus === "open" || q.minOpenDays > 0,
    };
    const cte = `WITH candidates AS (SELECT a.id,a.lat,a.lng,${distanceSql} AS distance FROM site_addresses a WHERE a.lat BETWEEN $minLat AND $maxLat AND ($allLng OR (NOT $wrapped AND a.lng BETWEEN $minLng AND $maxLng) OR ($wrapped AND (a.lng >= $minLng OR a.lng <= $maxLng)))), ranked AS (SELECT l.property_id,c.lat,c.lng,c.distance,row_number() OVER(PARTITION BY l.property_id ORDER BY c.distance,c.id) AS rn FROM candidates c JOIN parcel_address_links l ON l.address_id=c.id WHERE c.distance <= $radius), matches AS (SELECT p.*,n.lat AS matched_lat,n.lng AS matched_lng,n.distance,(SELECT max(open_days) FROM permits pm WHERE pm.property_id=p.id AND pm.status='open' AND pm.kind!='other') AS priority FROM properties p JOIN ranked n ON n.property_id=p.id AND n.rn=1 LEFT JOIN owner_derivatives o ON o.property_id=p.id LEFT JOIN roof_evidence roof ON roof.property_id=p.id LEFT JOIN latest_reported_sales sale ON sale.property_id=p.id WHERE ($reportedSaleAge IS NULL OR (sale.sale_date IS NOT NULL AND sale.sale_date <= CAST(substr(p.observed_at,1,10) AS DATE) AND sale.sale_date < CAST(substr(p.observed_at,1,10) AS DATE) - CAST($reportedSaleAge AS INTEGER)*INTERVAL 1 YEAR)) AND ($roof IS NULL OR ($includeUnknown AND roof.built_year IS NULL) OR (CAST(substr(p.observed_at,1,4) AS INTEGER)-roof.built_year)>$roof) AND ($minConfidence='any' OR ($minConfidence='low' AND roof.built_year IS NOT NULL)) AND ($owner='any' OR coalesce(o.owner_region,'unknown')=$owner) AND (NOT $statusRequired OR EXISTS(SELECT 1 FROM permits x WHERE x.property_id=p.id AND x.kind!='other' AND ($status='any' OR x.status=$status) AND ($days=0 OR (x.status='open' AND x.open_days >= $days)))))`;
    const native = await (
      await this.connection.run(
        cte +
          " SELECT *,count(*) OVER() AS total FROM matches ORDER BY CASE WHEN $prioritize THEN coalesce(priority,-1) ELSE -1 END DESC,distance,id LIMIT $limit OFFSET $offset",
        params,
      )
    ).getRowObjectsJson();
    let total = native.length ? Number(native[0]!.total) : 0;
    if (!native.length) {
      const countParams = { ...params };
      const countQuery = cte + " SELECT count(*) AS total FROM matches";
      const used = Object.fromEntries(
        Object.entries(countParams).filter(([key]) =>
          countQuery.includes("$" + key),
        ),
      );
      total = Number(
        (
          await (
            await this.connection.run(countQuery, used)
          ).getRowObjectsJson()
        )[0]!.total,
      );
    }
    const rows: SearchResponse["rows"] = [];
    for (const r of native)
      rows.push({
        ...(await this.property(r, {
          lat: Number(r.matched_lat),
          lng: Number(r.matched_lng),
        })),
        distanceMeters: Number(r.distance),
      });
    const more = offset + rows.length < total;
    return SearchResponseSchema.parse({
      contractVersion: CONTRACT_VERSION,
      snapshotId: this.snapshotId,
      queryHash,
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
        ...COUNTY_LIMITATIONS,
        ...(statusRequired
          ? [
              "Permit filters use only explicitly observed status. Issued-only records have unknown status, and this partial cohort cannot establish absence of permits.",
            ]
          : []),
        ...(q.roofMinAgeYears !== undefined
          ? [
              this.protectedSignals
                ? "Where protected assessor year-built observations are present, they are low-confidence age proxies; actual roof installation is unobserved. includeUnknown controls records without a source-backed proxy."
                : "Public roof-age evidence is unknown; only an explicit includeUnknown includes records without a source-backed proxy.",
            ]
          : []),
        ...(this.protectedSignals
          ? [
              "Protected owner location is derived from postal state; no ownership tenure is inferred.",
            ]
          : []),
        ...(q.minReportedSaleAgeYears !== undefined
          ? [
              "Reported-sale age uses the latest observed reported-sale date and the property's snapshot observation date. Partial sale observations do not establish ownership tenure or rule out unobserved later sales; unknown dates are excluded.",
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
