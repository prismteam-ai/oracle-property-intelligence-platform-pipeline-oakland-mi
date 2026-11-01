import {
  readFile,
  writeFile,
  mkdir,
  stat,
  rename,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance, type DuckDBAppender } from "@duckdb/node-api";
import { CONTRACT_VERSION } from "../../contracts/src/index.ts";
import { validateSourceFieldProfile } from "../../source-profiles/src/field-authority.ts";
import {
  assertPrivateDestination,
  canonicalDestination,
} from "../../receipts/src/private-paths.ts";
import {
  PUBLIC_PARCEL_FIELDS,
  PUBLIC_ADDRESS_FIELDS,
  TRANSFORM_VERSION,
  OWNER_DERIVATION_VERSION,
  sha256,
  stableJson,
  nullableText,
  sourceOid,
  sourceDate,
  officialPoint,
  deriveOwnerLocation,
  COUNTY_LIMITATIONS,
  PROPERTY_VIEW_SQL,
  type CountySourceManifest,
  type SourceLayer,
} from "./model.ts";
export interface ArtifactFile {
  name: string;
  bytes: number;
  sha256: string;
}
export interface ArtifactManifest {
  version: string;
  contractVersion: string;
  snapshotId: string;
  digest: string;
  count: number;
  addressCount: number;
  parcelCount: number;
  files: ArtifactFile[];
  limitations: string[];
  publicSnapshotId?: string;
  protectedView?: boolean;
}
function sqlPath(s: string): string {
  return "'" + s.replaceAll("'", "''") + "'";
}
function appendRow(
  appender: DuckDBAppender,
  row: readonly (string | number | boolean | null)[],
): void {
  for (const v of row) {
    if (v === null) appender.appendNull();
    else if (typeof v === "number") appender.appendDouble(v);
    else if (typeof v === "boolean") appender.appendBoolean(v);
    else appender.appendVarchar(v);
  }
  appender.endRow();
}
async function jsonWrite(p: string, v: unknown) {
  await writeFile(p, JSON.stringify(v, null, 2) + "\n");
}
function idCensus(raw: unknown): Set<string> {
  const ids = Array.isArray(raw)
    ? raw
    : (raw as { objectIds?: unknown[] }).objectIds;
  if (!ids) throw new Error("Missing ID census");
  const set = new Set(ids.map(sourceOid));
  if (set.size !== ids.length) throw new Error("Duplicate census IDs");
  return set;
}
async function consume(
  layer: SourceLayer,
  kind: "parcel" | "address",
  append: DuckDBAppender,
  owner: DuckDBAppender | null,
): Promise<{
  count: number;
  contentDigest: string;
  provenanceDigest: string;
  derivatives: Record<string, number>;
}> {
  if (!layer?.complete)
    throw new Error("Source layer is incomplete; no sampled promotion");
  const expected = idCensus(
    JSON.parse(await readFile(layer.objectIdsPath, "utf8")) as unknown,
  );
  if (expected.size !== layer.count) throw new Error("Census/count mismatch");
  const seen = new Set<string>();
  const rowDigests: string[] = [];
  const provenanceDigests: string[] = [];
  const derivatives: Record<string, number> = {};
  const publicFields =
    kind === "parcel" ? [...PUBLIC_PARCEL_FIELDS] : [...PUBLIC_ADDRESS_FIELDS];
  const allowed = new Set([
    ...publicFields,
    ...(kind === "parcel" ? ["POSTALADDRESS"] : []),
  ]);
  if (layer.sourceProfile) {
    validateSourceFieldProfile(layer.sourceProfile, {
      sourceUrl: layer.source,
      termsSha256: layer.sourceProfile.termsSha256,
      fieldClassificationDigest: layer.sourceFieldClassificationDigest ?? "",
      requestedFields: layer.fields,
    });
    for (const field of layer.fields) allowed.add(field);
  }
  for (const page of [...layer.pages].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  )) {
    const bytes = await readFile(page.path);
    if (sha256(bytes) !== page.sha256)
      throw new Error("Raw receipt digest mismatch");
    const raw = JSON.parse(bytes.toString()) as {
      features?: { attributes: Record<string, unknown>; geometry?: unknown }[];
      exceededTransferLimit?: boolean;
      error?: unknown;
    };
    if (!raw.features || raw.error || raw.exceededTransferLimit)
      throw new Error("Invalid or truncated source page");
    if (page.records !== undefined && raw.features.length !== page.records)
      throw new Error("Page record receipt mismatch");
    const observedAt = new Date(page.observedAt).toISOString();
    for (const feature of raw.features) {
      const a = feature.attributes;
      for (const key of Object.keys(a))
        if (!allowed.has(key))
          throw new Error("Source page has a non-allowlisted field");
      const oid = sourceOid(a[layer.oidField]);
      if (!expected.has(oid) || seen.has(oid))
        throw new Error("Duplicate/unexpected native object ID");
      seen.add(oid);
      const publicRow = Object.fromEntries(
        publicFields.map((k) => [k, a[k] ?? null]),
      );
      const point = kind === "address" ? officialPoint(feature.geometry) : null;
      const rowHash = sha256(
        stableJson({
          attributes: publicRow,
          ...(kind === "address" ? { coordinates: point } : {}),
        }),
      );
      rowDigests.push(oid + ":" + rowHash);
      provenanceDigests.push(oid + ":" + rowHash + ":" + observedAt);
      if (kind === "parcel") {
        const id = "oakland-parcel-" + oid;
        appendRow(append, [
          id,
          "oakland-tax-parcel-plus",
          oid,
          nullableText(a.PIN),
          nullableText(a.KEYPIN),
          sourceDate(a.REVISIONDATE),
          nullableText(a.CVTTAXCODE),
          nullableText(a.CVTTAXDESCRIPTION),
          nullableText(a.CLASSCODE),
          nullableText(a.SITEADDRESS),
          nullableText(a.SITECITY),
          nullableText(a.SITESTATE),
          nullableText(a.SITEZIP5),
          rowHash,
          observedAt,
        ]);
        if (owner) {
          const d = deriveOwnerLocation(
            a.POSTALADDRESS,
            a.SITEADDRESS,
            a.SITECITY,
          );
          appendRow(owner, [
            id,
            d.ownerRegion,
            d.locationClass,
            d.siteAddressMatch,
            observedAt,
            d.evidenceClass,
          ]);
          derivatives[d.locationClass] =
            (derivatives[d.locationClass] ?? 0) + 1;
        }
      } else
        appendRow(append, [
          "oakland-site-address-" + oid,
          "oakland-site-address",
          oid,
          nullableText(a.PIN),
          nullableText(a.SITESTREETADDRESS),
          nullableText(a.SITECITY),
          nullableText(a.SITESTATE),
          nullableText(a.SITEZIPCODE),
          point?.lat ?? null,
          point?.lng ?? null,
          rowHash,
          observedAt,
        ]);
    }
    append.flushSync();
    owner?.flushSync();
  }
  if (seen.size !== expected.size)
    throw new Error("Finite missing-ID set prevents complete promotion");
  rowDigests.sort();
  return {
    count: seen.size,
    contentDigest: sha256(rowDigests.join("\n")),
    provenanceDigest: sha256(provenanceDigests.sort().join("\n")),
    derivatives,
  };
}
export async function buildCountySnapshot(options: {
  sourceManifest: string;
  outputDir: string;
  privateOutputDir: string;
  protectedRoots?: string[];
  previousSnapshotDir?: string;
}): Promise<ArtifactManifest> {
  const source = JSON.parse(
    await readFile(options.sourceManifest, "utf8"),
  ) as CountySourceManifest;
  if (
    !/^[a-f0-9]{64}$/.test(source.termsDigest) ||
    !/^[a-f0-9]{64}$/.test(source.fieldClassificationDigest)
  )
    throw new Error("Terms/field freeze digests required");
  const out = await canonicalDestination(options.outputDir);
  await mkdir(out, { recursive: true });
  const privateOut = await assertPrivateDestination(options.privateOutputDir, [
    out,
    ...(options.protectedRoots ?? []),
  ]);
  await mkdir(privateOut, { recursive: true, mode: 0o700 });
  // This historical public projection retains its approved field set. Full
  // official observations remain in pinned source receipts/runtime views;
  // a separate exact-byte candidate controls later irreversible publication.
  const instance = await DuckDBInstance.create(":memory:", {
    threads: "1",
    memory_limit: "2GB",
  });
  const db = await instance.connect();
  try {
    await db.run(
      "CREATE TABLE parcels (id VARCHAR PRIMARY KEY,source_id VARCHAR,native_id VARCHAR,pin VARCHAR,keypin VARCHAR,revision_date VARCHAR,jurisdiction_code VARCHAR,jurisdiction_name VARCHAR,class_code VARCHAR,address VARCHAR,city VARCHAR,state VARCHAR,postal_code VARCHAR,content_hash VARCHAR,observed_at VARCHAR)",
    );
    await db.run(
      "CREATE TABLE site_addresses(id VARCHAR PRIMARY KEY,source_id VARCHAR,native_id VARCHAR,pin VARCHAR,address VARCHAR,city VARCHAR,state VARCHAR,postal_code VARCHAR,lat DOUBLE,lng DOUBLE,content_hash VARCHAR,observed_at VARCHAR)",
    );
    await db.run(
      "CREATE TABLE owner_derivatives(property_id VARCHAR PRIMARY KEY,owner_region VARCHAR,location_class VARCHAR,site_address_match BOOLEAN,observed_at VARCHAR,evidence_class VARCHAR)",
    );
    const p = await db.createAppender("parcels"),
      a = await db.createAppender("site_addresses"),
      o = await db.createAppender("owner_derivatives");
    const parcel = await consume(source.layers.parcel, "parcel", p, o);
    p.closeSync();
    o.closeSync();
    const address = await consume(source.layers.address, "address", a, null);
    a.closeSync();
    await db.run(
      `CREATE TABLE parcel_address_links AS SELECT p.id AS property_id,a.id AS address_id,'exact_source_pin' AS match_basis FROM parcels p JOIN site_addresses a ON p.pin IS NOT NULL AND p.pin=a.pin UNION ALL SELECT 'oakland-address-'||a.native_id,a.id,'unmatched_source_address' FROM site_addresses a WHERE NOT EXISTS(SELECT 1 FROM parcels p WHERE p.pin IS NOT NULL AND p.pin=a.pin)`,
    );
    await db.run(PROPERTY_VIEW_SQL);
    await db.run(
      "CREATE TABLE permits(property_id VARCHAR,id VARCHAR,status VARCHAR,kind VARCHAR,opened_at VARCHAR,closed_at VARCHAR,open_days INTEGER,reported_contractor VARCHAR,verified_company_id VARCHAR,license VARCHAR,rating DOUBLE,source_id VARCHAR,native_id VARCHAR,receipt_digest VARCHAR,observed_at VARCHAR)",
    );
    const stats = (
      await (
        await db.run(
          `SELECT (SELECT count(*) FROM properties)::INTEGER AS properties,(SELECT count(*) FROM parcels)::INTEGER AS parcels,(SELECT count(*) FROM site_addresses)::INTEGER AS addresses,(SELECT count(*) FROM parcel_address_links)::INTEGER AS links,(SELECT count(*) FROM site_addresses WHERE lat IS NOT NULL AND lng IS NOT NULL)::INTEGER AS coordinates,(SELECT count(*) FROM site_addresses a WHERE NOT EXISTS(SELECT 1 FROM parcels p WHERE p.pin IS NOT NULL AND p.pin=a.pin))::INTEGER AS unmatched_addresses,(SELECT count(*) FROM parcels p WHERE NOT EXISTS(SELECT 1 FROM parcel_address_links l WHERE l.property_id=p.id))::INTEGER AS parcels_without_address,(SELECT count(*) FROM (SELECT pin FROM site_addresses WHERE pin IS NOT NULL GROUP BY pin HAVING count(*)>1))::INTEGER AS multi_address_pins,(SELECT count(*) FROM (SELECT pin FROM parcels WHERE pin IS NOT NULL GROUP BY pin HAVING count(*)>1))::INTEGER AS multi_parcel_pins,(SELECT count(*) FROM (SELECT lat,lng FROM site_addresses WHERE lat IS NOT NULL GROUP BY lat,lng HAVING count(*)>1))::INTEGER AS stacked_coordinate_groups`,
        )
      ).getRowObjectsJson()
    )[0]!;
    const identity = {
      transformVersion: TRANSFORM_VERSION,
      contractVersion: CONTRACT_VERSION,
      fieldClassificationDigest: source.fieldClassificationDigest,
      termsDigest: source.termsDigest,
      parcelContentDigest: parcel.contentDigest,
      addressContentDigest: address.contentDigest,
      parcelProvenanceDigest: parcel.provenanceDigest,
      addressProvenanceDigest: address.provenanceDigest,
    };
    let digest = sha256(stableJson(identity));
    let snapshotId = "oakland-real-" + digest.slice(0, 20);
    let previous:
      | Awaited<
          ReturnType<
            typeof import("../../query/src/real.ts").verifySnapshotDirectory
          >
        >
      | undefined;
    let reusePrevious = false;
    if (options.previousSnapshotDir) {
      const { verifySnapshotDirectory } =
        await import("../../query/src/real.ts");
      previous = await verifySnapshotDirectory(options.previousSnapshotDir);
      const prior = JSON.parse(
        await readFile(
          path.join(previous.directory, "dataset-manifest.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const sameKeys = [
        "transformVersion",
        "contractVersion",
        "fieldClassificationDigest",
        "termsDigest",
        "parcelContentDigest",
        "addressContentDigest",
      ] as const;
      reusePrevious = sameKeys.every((key) => prior[key] === identity[key]);
      if (reusePrevious) {
        digest = previous.manifest.digest;
        snapshotId = previous.manifest.snapshotId;
      } else if (previous.directory === out)
        throw new Error(
          "Changed real facts require a new output directory to preserve the previous immutable snapshot",
        );
    }
    if (!reusePrevious)
      for (const [table, name, order] of [
        ["parcels", "parcels.parquet", "id"],
        ["site_addresses", "site-addresses.parquet", "id"],
        [
          "parcel_address_links",
          "parcel-address-links.parquet",
          "property_id,address_id",
        ],
        ["permits", "permits.parquet", "property_id,id"],
      ] as const)
        await db.run(
          `COPY (SELECT * FROM ${table} ORDER BY ${order}) TO ${sqlPath(path.join(out, name))} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 122880)`,
        );
    await db.run(
      "ALTER TABLE owner_derivatives ADD COLUMN public_snapshot_id VARCHAR",
    );
    await db.run(
      "UPDATE owner_derivatives SET public_snapshot_id=$snapshotId",
      { snapshotId },
    );
    await db.run(
      "ALTER TABLE owner_derivatives ADD COLUMN transform_version VARCHAR",
    );
    await db.run("UPDATE owner_derivatives SET transform_version=$version", {
      version: OWNER_DERIVATION_VERSION,
    });
    await db.run(
      `COPY (SELECT * FROM owner_derivatives ORDER BY property_id) TO ${sqlPath(path.join(privateOut, "owner-derivatives.parquet"))} (FORMAT PARQUET, COMPRESSION ZSTD)`,
    );
    if (reusePrevious && previous && previous.directory !== out)
      for (const file of previous.manifest.files)
        await copyFile(
          path.join(previous.directory, file.name),
          path.join(out, file.name),
        );
    const coverage = {
      snapshotId,
      mode: "real",
      completeSelectedLayers: true,
      counts: stats,
      sourceLayers: [
        {
          source: source.layers.parcel.source,
          nativeIdField: source.layers.parcel.oidField,
          count: parcel.count,
          contentDigest: parcel.contentDigest,
        },
        {
          source: source.layers.address.source,
          nativeIdField: source.layers.address.oidField,
          count: address.count,
          contentDigest: address.contentDigest,
        },
      ],
      roofAge: { known: null, state: "not_in_source_scope" },
      permits: { known: null, state: "not_in_source_scope" },
      ownershipTransfer: { known: null, state: "unknown" },
      officialContractorLicenseRating: { state: "not_in_source_scope" },
      publicOwnerLocation: {
        state: "unknown",
        reason: "Protected operational derivatives are not in public artifacts",
      },
      limitations: COUNTY_LIMITATIONS,
    };
    if (!reusePrevious)
      await jsonWrite(path.join(out, "coverage.json"), coverage);
    if (!reusePrevious)
      await jsonWrite(path.join(out, "dataset-manifest.json"), {
        ...identity,
        snapshotId,
        digest,
        counts: stats,
      });
    const runHistory = (source.runs ?? []).map((run) => {
      type Delta = {
        added: number;
        changed: number;
        deleted: number;
        unchanged: number;
      };
      const r = run as {
        id?: string;
        startedAt?: string;
        completedAt?: string;
        complete?: boolean;
        kind?: string;
        layers?: Record<
          string,
          {
            source?: string;
            count?: number;
            received?: number;
            complete?: boolean;
            publicDelta?: Delta;
            delta?: Delta;
          }
        >;
      };
      const layers = Object.fromEntries(
        Object.entries(r.layers ?? {}).map(([key, value]) => [
          key,
          {
            source: value.source,
            count: value.count,
            received: value.received,
            complete: value.complete,
            delta:
              value.publicDelta ??
              value.delta ??
              (r.kind === "full-baseline"
                ? {
                    added: value.count ?? 0,
                    changed: 0,
                    deleted: 0,
                    unchanged: 0,
                  }
                : null),
          },
        ]),
      );
      const values = Object.values(layers);
      const known = values.every((v) => v.delta !== null);
      const totals = known
        ? values.reduce(
            (sum, value) => ({
              added: sum.added + value.delta!.added,
              changed: sum.changed + value.delta!.changed,
              deleted: sum.deleted + value.delta!.deleted,
              unchanged: sum.unchanged + value.delta!.unchanged,
            }),
            { added: 0, changed: 0, deleted: 0, unchanged: 0 },
          )
        : null;
      return {
        id: r.id,
        at: r.completedAt ?? r.startedAt,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        complete: r.complete,
        kind: r.kind,
        source: r.kind ?? "official source",
        state: r.complete ? "COMPLETE" : "INCOMPLETE",
        sourceCount: values.reduce((n, v) => n + (v.count ?? 0), 0),
        processed: values.reduce((n, v) => n + (v.received ?? 0), 0),
        added: totals?.added ?? null,
        changed: totals?.changed ?? null,
        deleted: totals?.deleted ?? null,
        unchanged: totals?.unchanged ?? null,
        deltas: totals,
        layers,
        snapshotId,
        digest,
        canonicalPropertyCount: Number(stats.properties),
        datasetReused: reusePrevious && r.kind !== "full-baseline",
        limitations: [
          "Deltas count source-layer records (parcels plus site addresses), not assessed properties.",
          "A complete no-change source check reuses the immutable dataset; history retains the actual observation window.",
        ],
      };
    });
    await jsonWrite(path.join(out, "runs.json"), runHistory);
    if (!reusePrevious)
      await jsonWrite(path.join(out, "schema.json"), {
        version: CONTRACT_VERSION,
        transformVersion: TRANSFORM_VERSION,
        parcels: PUBLIC_PARCEL_FIELDS,
        siteAddress: PUBLIC_ADDRESS_FIELDS,
        publicOnly: true,
        ownerNamesPostalContactIncluded: false,
        fieldDecision:
          "Historical approved baseline projection only; not a source/runtime ban. Official observations use the source-specific profile and separate publication candidate.",
        identity:
          "Exact source-layer/native OID; PIN is an association attribute",
        pointSemantics:
          "Official approximate parcel centers, not roof centroids",
        addressAssociations:
          "All exact source PIN matches; native entities never collapsed",
        privateDerivativeDefinition:
          "regional=observed postal state MI, out_of_area=another recognized US state; no county/tenure inference",
      });
    const sample = await (
      await db.run(
        "SELECT id,native_id,pin,address,city,state,postal_code FROM parcels ORDER BY native_id LIMIT 10",
      )
    ).getRowObjectsJson();
    if (!reusePrevious)
      await jsonWrite(path.join(out, "sample.json"), {
        mode: "real-public-projection",
        snapshotId,
        sourceRows: false,
        properties: sample,
      });
    await jsonWrite(path.join(privateOut, "owner-derivative-summary.json"), {
      snapshotId,
      count: parcel.count,
      counts: parcel.derivatives,
      rawNamesRequested: source.layers.parcel.fields.some((field) =>
        ["NAME1", "NAME2"].includes(field),
      ),
      rawPostalReturned: false,
      rawSourceRetention:
        "Pinned full source receipts retain observed fields; this file summarizes derivatives only.",
      derivativeFileSha256: sha256(
        await readFile(path.join(privateOut, "owner-derivatives.parquet")),
      ),
      derivationVersion: OWNER_DERIVATION_VERSION,
      definition:
        "Recognized terminal US postal state+ZIP only; MI=regional, other state=out_of_area; local requires exact street and city token equality. Street-only values remain unknown. County, residency and tenure are not inferred.",
    });
    const names = [
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
    const files: ArtifactFile[] = [];
    for (const name of names) {
      const p = path.join(out, name);
      files.push({
        name,
        bytes: (await stat(p)).size,
        sha256: sha256(await readFile(p)),
      });
    }
    const manifest: ArtifactManifest = {
      version: "1",
      contractVersion: CONTRACT_VERSION,
      snapshotId,
      digest,
      count: Number(stats.properties),
      parcelCount: parcel.count,
      addressCount: address.count,
      files,
      limitations: COUNTY_LIMITATIONS,
    };
    await jsonWrite(path.join(out, "artifact-manifest.json.tmp"), manifest);
    await rename(
      path.join(out, "artifact-manifest.json.tmp"),
      path.join(out, "artifact-manifest.json"),
    );
    return manifest;
  } finally {
    db.closeSync();
    instance.closeSync();
  }
}
