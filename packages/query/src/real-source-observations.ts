import { readFile } from "node:fs/promises";
import type { DuckDBConnection } from "@duckdb/node-api";
import { z } from "zod";
import {
  PermitSchema,
  ProviderPermitObservationSchema,
  RecordedTransferIndexObservationSchema,
  PrivateSourceRunsSchema,
} from "../../contracts/src/index.ts";
import { sha256, stableJson } from "../../county/src/model.ts";
import { quote } from "./real-utils.ts";
import type { SnapshotOpenOptions } from "./real-loader-types.ts";
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const BaseRow = z.object({
  version: z.literal("1"),
  public_snapshot_id: z.string().min(1).max(200),
  property_id: z.string().min(1).max(200),
  observation_json: z.string().max(32768),
  observation_digest: Hash,
  observed_at: z.iso.datetime(),
});
export const PROVIDER_OBSERVATION_COLUMNS = [
  "version",
  "public_snapshot_id",
  "property_id",
  "existing_permit_id",
  "observation_json",
  "observation_digest",
  "observed_at",
] as const;
export const TRANSFER_OBSERVATION_COLUMNS = [
  "version",
  "public_snapshot_id",
  "property_id",
  "observation_json",
  "observation_digest",
  "observed_at",
] as const;
const ProviderRow = BaseRow.extend({
  existing_permit_id: z.string().min(1).max(200).nullable(),
}).strict();
const TransferRow = BaseRow.strict();
export interface SourceObservationAudit {
  providerObservations: number;
  existingPermitAssociations: number;
  providerCategoryDisagreements: number;
  newSourceCandidates: number;
  currentlyReportedActive: number;
  deedObservations: number;
  tenYearDeedObservations: number;
  deedObservedThrough: string | null;
  runs: unknown[];
}
export async function loadSourceObservations(args: {
  db: DuckDBConnection;
  options: SnapshotOpenOptions;
  publicSnapshotId: string;
  checkPrivate: (file: string, digest: string | undefined) => Promise<void>;
  overlayDigests: string[];
}): Promise<SourceObservationAudit> {
  const { db, options, publicSnapshotId, checkPrivate, overlayDigests } = args;
  const audit: SourceObservationAudit = {
    providerObservations: 0,
    existingPermitAssociations: 0,
    providerCategoryDisagreements: 0,
    newSourceCandidates: 0,
    currentlyReportedActive: 0,
    deedObservations: 0,
    tenYearDeedObservations: 0,
    deedObservedThrough: null,
    runs: [],
  };
  await db.run(
    "CREATE TABLE private_provider_observations(property_id VARCHAR,permit_id VARCHAR,provider_record_id VARCHAR,provider_status VARCHAR,activity_claim VARCHAR,lifecycle VARCHAR,age_days INTEGER,continuous_open_days INTEGER,canonical_json VARCHAR)",
  );
  await db.run(
    "CREATE TABLE private_transfer_observations(property_id VARCHAR,claim_window_start DATE,observed_through DATE,last_deed_date DATE,canonical_json VARCHAR)",
  );
  async function rows(
    file: string,
    digest: string | undefined,
    table: string,
    columns: readonly string[],
  ) {
    await checkPrivate(file, digest);
    await db.run(
      `CREATE TABLE ${table} AS SELECT * FROM read_parquet(${quote(file)})`,
    );
    const metadata = await (
      await db.run(`PRAGMA table_info('${table}')`)
    ).getRowObjectsJson();
    if (
      metadata.length !== columns.length ||
      metadata.some((c, i) => c.name !== columns[i] || c.type !== "VARCHAR")
    )
      throw new Error("Protected source observation outer columns rejected");
    const count = await (
      await db.run(`SELECT count(*) AS n FROM ${table}`)
    ).getRowObjectsJson();
    if (Number(count[0]!.n) > 5000)
      throw new Error("Protected source observation row bound rejected");
    return (await db.run(`SELECT * FROM ${table}`)).getRowObjectsJson();
  }
  const ids = new Set<string>();
  if (options.protectedProviderObservationsFile) {
    const input = await rows(
      options.protectedProviderObservationsFile,
      options.protectedProviderObservationsSha256,
      "provider_observation_rows",
      PROVIDER_OBSERVATION_COLUMNS,
    );
    for (const candidate of input) {
      const row = ProviderRow.parse(candidate);
      const observation = ProviderPermitObservationSchema.parse(
        JSON.parse(row.observation_json) as unknown,
      );
      if (
        row.public_snapshot_id !== publicSnapshotId ||
        observation.publicSnapshotId !== publicSnapshotId ||
        row.property_id !== observation.canonicalPropertyId ||
        row.observed_at !== observation.sourceObservedAt ||
        sha256(row.observation_json) !== row.observation_digest ||
        stableJson(observation) !== row.observation_json ||
        ids.has(observation.providerRecordId)
      )
        throw new Error(
          "Protected provider observation identity/integrity rejected",
        );
      ids.add(observation.providerRecordId);
      const properties = await (
        await db.run("SELECT count(*) AS n FROM properties WHERE id=$id", {
          id: row.property_id,
        })
      ).getRowObjectsJson();
      if (Number(properties[0]!.n) !== 1)
        throw new Error("Protected provider canonical property rejected");
      let permitId: string;
      if (row.existing_permit_id !== null) {
        const old = await (
          await db.run(
            "SELECT canonical_json,source_id FROM permits WHERE id=$id AND property_id=$property",
            { id: row.existing_permit_id, property: row.property_id },
          )
        ).getRowObjectsJson();
        if (
          old.length !== 1 ||
          old[0]!.source_id !== "official-troy-issued-permits" ||
          !old[0]!.canonical_json
        )
          throw new Error(
            "Protected provider existing permit binding rejected",
          );
        const permit = PermitSchema.parse(
          JSON.parse(String(old[0]!.canonical_json)) as unknown,
        );
        if (
          permit.permitNumber !== observation.permitNumber ||
          permit.issuedAt !== observation.dateIssued ||
          permit.jurisdiction !== "City of Troy, Oakland County, Michigan"
        )
          throw new Error(
            "Protected provider permit number/date/jurisdiction rejected",
          );
        permitId = permit.id;
        if (permit.kind === "other") audit.providerCategoryDisagreements++;
        const merged = PermitSchema.parse({
          ...permit,
          sourceObservations: [
            ...(permit.sourceObservations ?? []),
            observation,
          ],
        });
        await db.run("UPDATE permits SET canonical_json=$json WHERE id=$id", {
          json: JSON.stringify(merged),
          id: permitId,
        });
        audit.existingPermitAssociations++;
      } else {
        // This is a distinct provider source candidate, not a verified new municipal/legal permit.
        permitId = "permitstack:" + observation.providerRecordId;
        const collisions = await (
          await db.run(
            "SELECT count(*) AS n FROM permits WHERE id=$id OR (property_id=$property AND source_id='official-troy-issued-permits' AND json_extract_string(canonical_json,'$.permitNumber')=$number AND json_extract_string(canonical_json,'$.issuedAt') IS NOT DISTINCT FROM $issued)",
            {
              id: permitId,
              property: row.property_id,
              number: observation.permitNumber,
              issued: observation.dateIssued,
            },
          )
        ).getRowObjectsJson();
        if (Number(collisions[0]!.n) !== 0)
          throw new Error(
            "Protected provider source candidate reconciliation rejected",
          );
        const permit = PermitSchema.parse({
          id: permitId,
          status: "unknown",
          kind: "roof_unspecified",
          permitNumber: observation.permitNumber,
          jurisdiction: "Troy",
          issuedAt: observation.dateIssued,
          statusBasis:
            observation.providerStatus === "ISSUED" ? "issued_only" : "unknown",
          reportedStatus: observation.providerStatus,
          reportedPermitType: "Provider classified roofing",
          openedAt: null,
          closedAt: null,
          contractor: {
            reportedName: observation.reportedBusinessName,
            verifiedCompanyId: null,
            license: null,
            rating: null,
          },
          provenance: [
            {
              sourceId: observation.provenance.sourceId,
              recordId: observation.providerRecordId,
              observedAt: observation.sourceObservedAt,
              digest: observation.provenance.recordDigest,
              kind: "real-minimized",
            },
          ],
          sourceObservations: [observation],
        });
        await db.run(
          "INSERT INTO permits(property_id,id,status,kind,opened_at,closed_at,open_days,reported_contractor,verified_company_id,license,rating,source_id,native_id,receipt_digest,observed_at,canonical_json) VALUES($property,$id,'unknown','roof_unspecified',NULL,NULL,NULL,$business,NULL,NULL,NULL,$source,$native,$digest,$observed,$json)",
          {
            property: row.property_id,
            id: permitId,
            business: observation.reportedBusinessName,
            source: observation.provenance.sourceId,
            native: observation.providerRecordId,
            digest: observation.provenance.recordDigest,
            observed: observation.sourceObservedAt,
            json: JSON.stringify(permit),
          },
        );
        audit.newSourceCandidates++;
      }
      await db.run(
        "INSERT INTO private_provider_observations VALUES($property,$permit,$record,$status,$activity,$lifecycle,$age,$continuous,$json)",
        {
          property: row.property_id,
          permit: permitId,
          record: observation.providerRecordId,
          status: observation.providerStatus,
          activity: observation.activityClaim,
          lifecycle: observation.supportedLifecycle,
          age: observation.ageSinceIssueDays,
          continuous: observation.continuousOpenDays,
          json: row.observation_json,
        },
      );
      audit.providerObservations++;
      if (observation.activityClaim !== "not_established")
        audit.currentlyReportedActive++;
    }
    await db.run("DROP TABLE provider_observation_rows");
    overlayDigests.push(
      "provider-observations:" + options.protectedProviderObservationsSha256,
    );
  }
  if (options.protectedTransferObservationsFile) {
    const input = await rows(
      options.protectedTransferObservationsFile,
      options.protectedTransferObservationsSha256,
      "transfer_observation_rows",
      TRANSFER_OBSERVATION_COLUMNS,
    );
    const seen = new Set<string>();
    for (const candidate of input) {
      const row = TransferRow.parse(candidate);
      const observation = RecordedTransferIndexObservationSchema.parse(
        JSON.parse(row.observation_json) as unknown,
      );
      if (
        row.public_snapshot_id !== publicSnapshotId ||
        row.property_id !== observation.canonicalPropertyId ||
        row.observed_at !== observation.reference.observedAt ||
        sha256(row.observation_json) !== row.observation_digest ||
        stableJson(observation) !== row.observation_json ||
        seen.has(row.property_id)
      )
        throw new Error(
          "Protected deed observation identity/integrity rejected",
        );
      seen.add(row.property_id);
      const properties = await (
        await db.run("SELECT count(*) AS n FROM properties WHERE id=$id", {
          id: row.property_id,
        })
      ).getRowObjectsJson();
      if (Number(properties[0]!.n) !== 1)
        throw new Error("Protected deed canonical property rejected");
      await db.run(
        "INSERT INTO private_transfer_observations VALUES($property,$start,$through,$deed,$json)",
        {
          property: row.property_id,
          start: observation.claimWindowStart,
          through: observation.observedThrough,
          deed: observation.lastRecordedDeedDate,
          json: row.observation_json,
        },
      );
      audit.deedObservations++;
      if (observation.noDeedObservedForMoreThanTenYears)
        audit.tenYearDeedObservations++;
      audit.deedObservedThrough =
        audit.deedObservedThrough === null
          ? observation.observedThrough
          : [audit.deedObservedThrough, observation.observedThrough].sort()[0]!;
    }
    await db.run("DROP TABLE transfer_observation_rows");
    overlayDigests.push(
      "transfer-observations:" + options.protectedTransferObservationsSha256,
    );
  }
  if (options.protectedSourceRunsFile) {
    await checkPrivate(
      options.protectedSourceRunsFile,
      options.protectedSourceRunsSha256,
    );
    const raw = await readFile(options.protectedSourceRunsFile, "utf8");
    if (Buffer.byteLength(raw) > 65536)
      throw new Error("Private source refresh receipt byte bound rejected");
    const runs = PrivateSourceRunsSchema.parse(JSON.parse(raw) as unknown);
    if (
      runs.some(
        (r) =>
          r.publicSnapshotId !== publicSnapshotId ||
          r.provider.admitted !== audit.providerObservations ||
          r.provider.existingPermitAssociations !==
            audit.existingPermitAssociations ||
          r.provider.newSourceCandidates !== audit.newSourceCandidates ||
          r.provider.currentlyReportedActive !==
            audit.currentlyReportedActive ||
          r.deedIndex.admitted !== audit.deedObservations ||
          r.deedIndex.positiveTenYearObservations !==
            audit.tenYearDeedObservations ||
          r.deedIndex.observedThrough !== audit.deedObservedThrough,
      )
    )
      throw new Error("Private source refresh receipt binding/count rejected");
    audit.runs = runs;
    overlayDigests.push("source-runs:" + options.protectedSourceRunsSha256);
  }
  return audit;
}
