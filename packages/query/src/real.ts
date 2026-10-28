import {
  EFFECTIVE_PERMIT_STATUS_SQL,
  EFFECTIVE_OPEN_DAYS_SQL,
  SOURCE_OBSERVATION_FILTER_SQL,
  RECORDED_DEED_FILTER_SQL,
  ROOFING_CANDIDATE_SQL,
} from "./source-predicates.ts";
import { resolveQueryPlace } from "../../places/src/index.ts";
import { PERMIT_EVIDENCE_SQL, needsPermitEvidence } from "./predicates.ts";
import { rmSync } from "node:fs";
import type { DuckDBInstance, DuckDBConnection } from "@duckdb/node-api";
import {
  CONTRACT_VERSION,
  DomainError,
  PropertySchema,
  QuerySchema,
  SearchResponseSchema,
  type Property,
  type SearchResponse,
} from "../../contracts/src/index.ts";
import { sha256, COUNTY_LIMITATIONS } from "../../county/src/model.ts";
import type { ArtifactManifest } from "../../county/src/build.ts";
import { PRIVATE_PERMIT_LIMIT } from "../../county/src/private-permits.ts";
import { TROY_SOURCE_FIELDS } from "../../county/src/private-source-intake.ts";
import {
  FULL_SOURCE_DEFINITIONS,
  type FullSourceAudit,
} from "../../county/src/private-full-source.ts";
import { text, type Row } from "./real-utils.ts";
import { loadRealSnapshot } from "./real-loader.ts";
import type { SnapshotOpenOptions } from "./real-loader-types.ts";
export { verifySnapshotDirectory } from "./real-utils.ts";
const distanceSql =
  "12742017.6*asin(sqrt(least(1.0,pow(sin(radians(a.lat-$lat)/2),2)+cos(radians($lat))*cos(radians(a.lat))*pow(sin(radians(a.lng-$lng)/2),2))))";
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
  readonly sourceFreshness: import("../../hosted-runtime/src/source-freshness.ts").SourceFreshnessSummary;
  private constructor(
    manifest: ArtifactManifest,
    private connection: DuckDBConnection,
    private instance: DuckDBInstance,
    coverage: unknown,
    runs: unknown[],
    readonly ownerSignalsAvailable: boolean,
    overlayDigests: readonly string[],
    readonly permitCount: number,
    readonly permitSourceCounts: Readonly<Record<string, number>>,
    readonly sourceIntakeCount: number,
    readonly fullSourceAudits: readonly FullSourceAudit[],
    readonly sourceObservationAudit: import("./real-source-observations.ts").SourceObservationAudit,
    private temporaryDirectory: string,
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
                "Troy permit observations are a bounded cohort selected by the visible roof-description filter. Original non-roof permit types remain retained; only explicit roofing scope qualifies for roofing predicates. Issuance does not establish open status or completed work.",
                "Property views retain only clearly reported business Applicants with contractor role unverified. The full source working intake retains original Applicant values privately; license metadata describes the reported business.",
              ],
              permitCount,
            },
          ]
        : []),
      ...(overlayDigests.some((digest) => digest.startsWith("source-intake:"))
        ? [
            {
              source: "Private Troy source intake",
              scope:
                "All acquired visible source fields, including records without a canonical property assignment",
              state: "partial",
              count: sourceIntakeCount,
              limitations: [
                "Original source fields, including personal/unclassified Applicant and source address fields, are retained only in the protected working database.",
                "Full source fields are excluded from Property responses, agent/model tools and public publication.",
                "An Applicant is not necessarily a contractor; unassigned source records are retained without fabricated property links.",
              ],
            },
          ]
        : []),
      ...(overlayDigests.some((digest) => digest.startsWith("permits:"))
        ? [
            {
              source: "Official Troy issued permits",
              scope:
                "Acquired roof-description results linked to current properties; this is not countywide permit coverage",
              state: "partial",
              count: permitSourceCounts["official-troy-issued-permits"] ?? 0,
              limitations: [
                "Count includes roofing-qualified and other permit types with conservative property assignments. Unmatched or conflicting records are excluded from property results.",
                "Issued-only records have unknown open/closed status and do not prove completed roofing work.",
                "The source Applicant business is not a verified contractor role; business-license observations preserve their own reported status and date.",
              ],
            },
          ]
        : []),
      ...(permitSourceCounts["official-independence-public-permits"]
        ? [
            {
              source: "Official Independence Public permit records",
              scope:
                "Current exact-PIN, jurisdiction and point-consistent assignments from the acquired municipal view",
              state: "partial",
              count: permitSourceCounts["official-independence-public-permits"],
              limitations: [
                "Only the literal CLOSED establishes closed status; FINALED, ISSUED, EXPIRED, CANCELED, HOLD (PREREQ) and SUSPENDED (FEE) remain unknown.",
                "No source lifecycle dates, continuous open duration or verified contractor identity is asserted.",
                "Unassigned source records and all original fields remain in the protected source intake.",
              ],
            },
          ]
        : []),
      ...(permitSourceCounts[
        "official-rochester-hills-building-permit-reports"
      ] !== undefined
        ? [
            {
              source:
                "Official Rochester Hills issued/applied building reports",
              scope:
                "Exact normalized site-address and jurisdiction associations; issued records supply unknown-status permit observations, applied records remain separate report events",
              state: "partial",
              count:
                permitSourceCounts[
                  "official-rochester-hills-building-permit-reports"
                ],
              limitations: [
                "Count denotes assigned issued records only, not all raw report rows or owner observations. All acquired issued/applied rows remain in the protected working intake.",
                "Source-labeled Owner text has no verified effective date, current legal role, role at the permit event, or uninterrupted-tenure meaning.",
                "Unlabeled grouping-party names and contact fields are retained privately without inferred roles. Applications and issued-only observations do not prove open, completed or continuously open work.",
              ],
            },
          ]
        : []),
    ];
    this.coverage.push(
      ...fullSourceAudits.map((audit) => ({
        source: FULL_SOURCE_DEFINITIONS[audit.role].title,
        scope:
          audit.role === "assessment-source"
            ? "All39 observed fields from one normal official Troy real-property UI case, retained as a private manual transcription; no bulk or server-body capture"
            : audit.role === "rochester-source"
              ? "All records in the twelve acquired April–September 2026 issued/applied building reports; source has no point geometry"
              : FULL_SOURCE_DEFINITIONS[audit.role].geometryIncluded
                ? "Complete observed source attributes and point geometry retained in protected working views"
                : "Complete observed source attributes retained in protected working views; geometry is excluded by the acquisition scope",
        state: "source_retained_private",
        count: audit.records,
        limitations: [
          "Full raw source records are excluded from Property responses, agent/model input and public publication. Explicitly typed owner/report observations may appear in authenticated Property responses; owner names remain excluded from model input.",
          "Source name/party fields do not establish verified ownership, contractor role or tenure. Explicit Owner State supports only a reported mailing-state derivative, not residence or county-local identity.",
          "All JSON keys/types/digests were validated offline against the pinned source schema and file hash; runtime checks metadata, native IDs and non-null canonical bindings setwise.",
        ],
      })),
    );
    if (sourceObservationAudit.providerObservations)
      this.coverage.push({
        source: "PermitStack roofing status observations",
        scope:
          "Protected Troy provider observations; municipal facts remain separately retained",
        state: "partial_provider_reported",
        count: sourceObservationAudit.providerObservations,
        limitations: [
          `${sourceObservationAudit.existingPermitAssociations} existing municipal permit associations; ${sourceObservationAudit.newSourceCandidates} additional provider source candidates, not verified new legal permits.`,
          `${sourceObservationAudit.providerCategoryDisagreements} provider ROOFING classifications differ from the retained municipal-work projection kind=other. Provider-qualified candidate filters may include them; native activity/duration filters retain the independently qualified roofing scope.`,
          `${sourceObservationAudit.currentlyReportedActive} current reported-active observations. ISSUED is not OPEN; issue age is not continuous open duration.`,
          "Provider classifications and contractor identity/role are independently qualified. No public redistribution.",
        ],
      });
    if (sourceObservationAudit.deedObservations)
      this.coverage.push({
        source: "Official current-PIN recorded-deed index observations",
        scope:
          "Bounded exact-current-PIN queries, all visible result pages; predecessor-parcel lineage not established",
        state: "partial_current_pin_index",
        count: sourceObservationAudit.deedObservations,
        limitations: [
          `${sourceObservationAudit.tenYearDeedObservations} no-observed-deed gaps exceed ten years through ${sourceObservationAudit.deedObservedThrough}.`,
          "Advertised global index start is not proven current-PIN historical lineage coverage. This is not legal ownership continuity or title verification.",
        ],
      });
    this.sourceFreshness = {
      knownDataThroughDates: [],
      unknownCohorts:
        1 +
        Number(
          overlayDigests.some(
            (digest) =>
              !/^(provider-observations|transfer-observations|source-runs):/.test(
                digest,
              ),
          ),
        ),
    };
    for (const [count, date] of [
      [
        sourceObservationAudit.providerObservations,
        sourceObservationAudit.providerDataThroughOldest,
      ],
      [
        sourceObservationAudit.deedObservations,
        sourceObservationAudit.deedObservedThrough,
      ],
    ] as const) {
      if (count === 0) continue;
      if (date === null) this.sourceFreshness.unknownCohorts++;
      else
        this.sourceFreshness.knownDataThroughDates = [
          ...this.sourceFreshness.knownDataThroughDates,
          date,
        ];
    }
    this.runs = [...runs, ...sourceObservationAudit.runs];
  }
  static async open(
    directory: string,
    options: SnapshotOpenOptions = {},
  ): Promise<RealSnapshot> {
    return loadRealSnapshot(
      directory,
      options,
      (...values) => new RealSnapshot(...values),
    );
  }
  /** Counts only. Full source text has no Property/API/model-tool export path. */
  async auditPrivateSourceIntake() {
    const rows = await (
      await this.connection.run(
        "SELECT count(*) AS rows,count(DISTINCT native_id) AS unique_records,count(*) FILTER(WHERE matched_property_id IS NOT NULL) AS matched,count(*) FILTER(WHERE matched_property_id IS NULL) AS unassigned FROM private_source_intake",
      )
    ).getRowObjectsJson();
    const nonempty: Record<string, number> = {};
    for (const field of TROY_SOURCE_FIELDS) {
      const result = await (
        await this.connection.run(
          `SELECT count(*) FILTER(WHERE json_extract_string(source_fields_json,'$."${field}"')!='') AS n FROM private_source_intake`,
        )
      ).getRowObjectsJson();
      nonempty[field] = Number(result[0]!.n);
    }
    return {
      rows: Number(rows[0]!.rows),
      uniqueRecords: Number(rows[0]!.unique_records),
      matched: Number(rows[0]!.matched),
      unassigned: Number(rows[0]!.unassigned),
      visibleSourceFields: [...TROY_SOURCE_FIELDS],
      nonemptyFieldCounts: nonempty,
      rawRowsReturned: false,
    };
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
    const reportedOwners = await (
      await this.connection.run(
        "SELECT canonical_json FROM private_reported_owner_observations WHERE property_id=$id ORDER BY source_id,native_id",
        { id },
      )
    ).getRowObjectsJson();
    const locationProvenance = await (
      await this.connection.run(
        "SELECT canonical_json FROM private_owner_location_provenance WHERE property_id=$id",
        { id },
      )
    ).getRowObjectsJson();
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
        e.page != null && e.line != null
          ? String(e.native_id) +
            ":page:" +
            String(e.page) +
            ":line:" +
            String(e.line)
          : String(e.native_id),
      observedAt: String(e.observed_at),
      digest: String(e.record_digest),
      kind: "real-minimized" as const,
    });
    const assessmentCaveats = await (
      await this.connection.run(
        "SELECT caveat FROM private_assessment_match WHERE property_id=$id",
        { id },
      )
    ).getRowObjectsJson();
    const permits = await (
      await this.connection.run(
        "SELECT * FROM permits WHERE property_id=$id ORDER BY id LIMIT $bound",
        { id, bound: PRIVATE_PERMIT_LIMIT },
      )
    ).getRowObjectsJson();
    const deedObservations = await (
      await this.connection.run(
        "SELECT canonical_json FROM private_transfer_observations WHERE property_id=$id",
        { id },
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
        caveats: [
          ...(builtYear === null
            ? [
                builtYears.length > 1
                  ? "Conflicting source-reported built years; age remains unknown."
                  : "Selected official layers do not establish roof age or installation.",
              ]
            : [
                `Source-reported building year: ${builtYear}. This is a building year proxy, not a verified roof installation year.`,
                "Protected official assessor report year-built proxy; unobserved roof replacements may exist. Municipal redistribution rights remain unverified.",
              ]),
          ...assessmentCaveats.map((c) => String(c.caveat)),
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
        ...(deedObservations.length
          ? {
              recordedTransferIndexObservations: deedObservations.map(
                (o) => JSON.parse(String(o.canonical_json)) as unknown,
              ),
            }
          : {}),
        ...(reportedOwners.length
          ? {
              reportedOwnerObservations: reportedOwners.map(
                (o) => JSON.parse(String(o.canonical_json)) as unknown,
              ),
            }
          : {}),
        ...(locationProvenance.length
          ? {
              locationProvenance: locationProvenance.map(
                (p) => JSON.parse(String(p.canonical_json)) as unknown,
              ),
            }
          : {}),
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
        transferHistoryCoverage: {
          state: enrichment.some((e) => e.sale_date !== null)
            ? "partial"
            : "unknown",
          from: null,
          through: null,
          provenance: [],
          limitations: [
            "No complete transfer/deed history with a proved coverage window has been acquired; reported sales remain separate observations.",
          ],
        },
        uninterruptedTenure: {
          state: "insufficient_history",
          unchangedSince: null,
          asOf,
          provenance: [],
        },
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
    const placeResolution = resolveQueryPlace(q);
    if (q.snapshotId !== this.snapshotId)
      throw new DomainError(
        "SNAPSHOT_UNAVAILABLE",
        "Requested snapshot unavailable",
      );
    if (q.minOwnershipYears !== undefined)
      throw new DomainError(
        "UNSUPPORTED_TOOL",
        "Ownership tenure is unknown; legal continuity is unestablished. The separate minRecordedDeedGapYears filter supports only a bounded current-PIN official-index no-observed-deed gap; it does not establish unchanged ownership.",
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
    const statusRequired =
      q.permitStatus !== "any" || q.minOpenDays > 0 || needsPermitEvidence(q);
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
      sourceRequired:
        q.providerPermitStatus !== undefined ||
        q.permitActivityClaim !== undefined ||
        q.minPermitAgeSinceIssueDays !== undefined,
      providerStatus: q.providerPermitStatus ?? null,
      activityClaim: q.permitActivityClaim ?? null,
      issueAge: q.minPermitAgeSinceIssueDays ?? null,
      deedGap: q.minRecordedDeedGapYears ?? null,
      allowProviderRoof:
        q.minOpenDays === 0 && q.permitActivityClaim !== "native_reported_open",
      status: q.permitStatus,
      days: q.minOpenDays,
      limit: q.limit,
      offset,
      prioritize:
        q.sort === "permit_open_days_desc" ||
        (!q.sort && (q.permitStatus === "open" || q.minOpenDays > 0)),
      sortRoof: q.sort === "roof_age_desc",
      requiresContractor: Boolean(q.requiresContractor),
      requiresVerifiedLicense: Boolean(q.requiresVerifiedLicense),
      requiresBbbRating: Boolean(q.requiresBbbRating),
    };
    const cte = `WITH candidates AS (SELECT a.id,a.lat,a.lng,${distanceSql} AS distance FROM site_addresses a WHERE a.lat BETWEEN $minLat AND $maxLat AND ($allLng OR (NOT $wrapped AND a.lng BETWEEN $minLng AND $maxLng) OR ($wrapped AND (a.lng >= $minLng OR a.lng <= $maxLng)))), ranked AS (SELECT l.property_id,c.lat,c.lng,c.distance,row_number() OVER(PARTITION BY l.property_id ORDER BY c.distance,c.id) AS rn FROM candidates c JOIN parcel_address_links l ON l.address_id=c.id WHERE c.distance <= $radius), matches AS (SELECT p.*,CASE WHEN roof.built_year IS NULL THEN NULL ELSE greatest(0,CAST(substr(p.observed_at,1,4) AS INTEGER)-roof.built_year) END AS roof_priority,n.lat AS matched_lat,n.lng AS matched_lng,n.distance,(SELECT max(${EFFECTIVE_OPEN_DAYS_SQL}) FROM permits x WHERE x.property_id=p.id AND ${EFFECTIVE_PERMIT_STATUS_SQL}='open' AND ${ROOFING_CANDIDATE_SQL} AND ($status='any' OR ${EFFECTIVE_PERMIT_STATUS_SQL}=$status) AND ($days=0 OR ${EFFECTIVE_OPEN_DAYS_SQL} >= $days) ${PERMIT_EVIDENCE_SQL} ${SOURCE_OBSERVATION_FILTER_SQL}) AS priority FROM properties p JOIN ranked n ON n.property_id=p.id AND n.rn=1 LEFT JOIN owner_derivatives o ON o.property_id=p.id LEFT JOIN roof_evidence roof ON roof.property_id=p.id LEFT JOIN latest_reported_sales sale ON sale.property_id=p.id WHERE true ${RECORDED_DEED_FILTER_SQL} AND ($reportedSaleAge IS NULL OR (sale.sale_date IS NOT NULL AND sale.sale_date <= CAST(substr(p.observed_at,1,10) AS DATE) AND sale.sale_date < CAST(substr(p.observed_at,1,10) AS DATE) - CAST($reportedSaleAge AS INTEGER)*INTERVAL 1 YEAR)) AND ($roof IS NULL OR ($includeUnknown AND roof.built_year IS NULL) OR (CAST(substr(p.observed_at,1,4) AS INTEGER)-roof.built_year)>$roof) AND ($minConfidence='any' OR ($minConfidence='low' AND roof.built_year IS NOT NULL)) AND ($owner='any' OR coalesce(o.owner_region,'unknown')=$owner) AND (NOT $statusRequired OR EXISTS(SELECT 1 FROM permits x WHERE x.property_id=p.id AND ${ROOFING_CANDIDATE_SQL} AND ($status='any' OR ${EFFECTIVE_PERMIT_STATUS_SQL}=$status) AND ($days=0 OR (${EFFECTIVE_PERMIT_STATUS_SQL}='open' AND ${EFFECTIVE_OPEN_DAYS_SQL} >= $days)) ${PERMIT_EVIDENCE_SQL} ${SOURCE_OBSERVATION_FILTER_SQL})))`;
    const native = await (
      await this.connection.run(
        cte +
          " SELECT *,count(*) OVER() AS total FROM matches ORDER BY CASE WHEN $sortRoof THEN roof_priority ELSE NULL END DESC NULLS LAST,CASE WHEN $prioritize THEN coalesce(priority,-1) ELSE -1 END DESC,distance,id LIMIT $limit OFFSET $offset",
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
    try {
      this.connection.closeSync();
    } finally {
      try {
        this.instance.closeSync();
      } finally {
        rmSync(this.temporaryDirectory, { recursive: true, force: true });
      }
    }
  }
}
