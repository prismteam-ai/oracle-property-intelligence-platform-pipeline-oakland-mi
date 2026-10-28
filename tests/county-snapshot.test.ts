import { expect, test } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  stat,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildCountySnapshot } from "../packages/county/src/build.ts";
import {
  deriveOwnerLocation,
  sha256,
  PUBLIC_PARCEL_FIELDS,
  PUBLIC_ADDRESS_FIELDS,
  type CountySourceManifest,
} from "../packages/county/src/model.ts";
import {
  RealSnapshot,
  verifySnapshotDirectory,
} from "../packages/query/src/real.ts";
import { buildProtectedEnrichment } from "../packages/county/src/enrichment.ts";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import {
  createPrivateSourceIntakeRow,
  SOURCE_INTAKE_COLUMNS,
} from "../packages/county/src/private-source-intake.ts";
import {
  FULL_SOURCE_COLUMNS,
  type FullSourceConfig,
} from "../packages/county/src/private-full-source.ts";
import {
  matchTroyIssued,
  normalizeTroyIssued,
  TROY_SOURCE,
} from "../packages/county/src/troy.ts";
import { DuckSnapshot } from "../packages/query/src/duckdb.ts";
import { SnapshotReader } from "../packages/query/src/index.ts";
import {
  syntheticProperties,
  SNAPSHOT_ID,
} from "../packages/test-support/src/fixtures.ts";
async function sourceFixture(
  jurisdiction = "Synthetic jurisdiction",
  assessmentPin?: string,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "prism-county-"));
  const privateRoot = path.join(root, "private");
  await mkdir(privateRoot, { mode: 0o700 });
  const observedAt = "2026-10-27T08:00:00.000Z";
  const parcelFeatures = [1, 2, 3].map((i) => ({
    attributes: {
      OBJECTID_12: i,
      OBJECTID: i,
      KEYPIN: i === 2 ? "0012345678" : "200" + i,
      PIN:
        i === 2
          ? "0012345678"
          : i === 1
            ? "0012345678"
            : (assessmentPin ?? "2003"),
      REVISIONDATE: 1791806753000,
      CVTTAXCODE: "test",
      CVTTAXDESCRIPTION: jurisdiction,
      CLASSCODE: "unknown",
      SITEADDRESS: "Synthetic site " + i,
      SITECITY: "Synthetic town",
      SITESTATE: "MI",
      SITEZIP5: "00000",
      POSTALADDRESS:
        i === 1
          ? "Synthetic site 1, Synthetic town MI 00000"
          : i === 2
            ? "Synthetic other site, Synthetic place CA 00000"
            : null,
    },
  }));
  const addressFeatures = [
    { id: 1, pin: "0012345678", x: -83.29, y: 42.66 },
    { id: 2, pin: "0012345678", x: -84, y: 43 },
    { id: 3, pin: assessmentPin ?? "2003", x: -83.29, y: 42.66 },
    { id: 4, pin: "unmatched", x: -83.28, y: 42.67 },
    { id: 5, pin: "0012345678", x: 999, y: 999 },
  ].map((p) => ({
    attributes: {
      OBJECTID: p.id,
      TYPE: "SYNTHETIC",
      PIN: p.pin,
      SITESTREETADDRESS: "Synthetic address " + p.id,
      SITECITY: "Synthetic town",
      SITESTATE: "MI",
      SITEZIPCODE: "00000",
    },
    geometry: { x: p.x, y: p.y },
  }));
  const layers: Partial<CountySourceManifest["layers"]> = {};
  for (const [k, features, fields, oid] of [
    [
      "parcel",
      parcelFeatures,
      [...PUBLIC_PARCEL_FIELDS, "POSTALADDRESS"],
      "OBJECTID_12",
    ],
    ["address", addressFeatures, [...PUBLIC_ADDRESS_FIELDS], "OBJECTID"],
  ] as const) {
    const p = path.join(privateRoot, k + ".body"),
      ids = path.join(privateRoot, k + "-ids.json");
    const bytes = JSON.stringify({ features });
    await writeFile(p, bytes, { mode: 0o600 });
    await writeFile(
      ids,
      JSON.stringify({
        objectIds: features.map(
          (f) => f.attributes[oid as keyof typeof f.attributes],
        ),
      }),
    );
    layers[k] = {
      source: "fixture://" + k,
      oidField: oid,
      fields: [...fields],
      publicFields: [...fields].filter((x) => x !== "POSTALADDRESS"),
      privateFields: k === "parcel" ? ["POSTALADDRESS"] : [],
      count: features.length,
      complete: true,
      objectIdsPath: ids,
      pages: [
        {
          path: p,
          sha256: sha256(bytes),
          observedAt,
          records: features.length,
          index: 0,
        },
      ],
    };
  }
  const source = {
    version: "test",
    layers,
    termsDigest: sha256("fixture-terms"),
    fieldClassificationDigest: sha256("fixture-classification"),
    runs: [
      {
        id: "test-baseline",
        complete: true,
        kind: "synthetic-regression",
        startedAt: observedAt,
        completedAt: observedAt,
      },
    ],
  } as CountySourceManifest;
  const manifest = path.join(privateRoot, "source.json");
  await writeFile(manifest, JSON.stringify(source));
  return { root, privateRoot, manifest, source };
}
test("hash-pinned complete county attributes stay lazy and private under an exact read allowlist", async () => {
  const f = await sourceFixture(),
    out = path.join(f.root, "public"),
    m = await buildCountySnapshot({
      sourceManifest: f.manifest,
      outputDir: out,
      privateOutputDir: path.join(f.privateRoot, "owners"),
    }),
    instance = await DuckDBInstance.create(":memory:"),
    db = await instance.connect();
  const sourceJson = JSON.stringify({
      OBJECTID_12: 1,
      NAME1: "PRIVATE_FULL_COUNTY_PARTY_SENTINEL",
      NAME2: "PRIVATE_FULL_COUNTY_SECOND_PARTY",
      POSTALADDRESS: "PRIVATE_FULL_COUNTY_POSTAL_SENTINEL",
      ASSESSEDVALUE: 12345,
      NUM_BEDS: 3,
      STRUCTURE_DESC: "Synthetic structure",
    }),
    schema = sha256("synthetic-full-schema");
  const rows = [
    {
      version: "county-full-attributes-v1",
      source_id: "official-oakland-tax-parcel-full-attributes",
      native_id: "1",
      public_snapshot_id: m.snapshotId,
      source_schema_sha256: schema,
      source_record_json: sourceJson,
      record_digest: sha256(sourceJson),
      observed_at: "2026-10-28T01:00:00.000Z",
      property_id: "oakland-parcel-1",
    },
    {
      version: "county-full-attributes-v1",
      source_id: "official-oakland-tax-parcel-full-attributes",
      native_id: "2",
      public_snapshot_id: m.snapshotId,
      source_schema_sha256: schema,
      source_record_json: JSON.stringify({
        ...JSON.parse(sourceJson),
        OBJECTID_12: 2,
      }),
      record_digest: sha256(
        JSON.stringify({ ...JSON.parse(sourceJson), OBJECTID_12: 2 }),
      ),
      observed_at: "2026-10-28T01:00:00.000Z",
      property_id: null,
    },
  ];
  const create = async (
    input: typeof rows,
    name: string,
  ): Promise<FullSourceConfig> => {
    await db.run(
      "CREATE OR REPLACE TABLE full_source(" +
        FULL_SOURCE_COLUMNS.map((k) => k + " VARCHAR").join(",") +
        ")",
    );
    for (const row of input)
      await db.run(
        "INSERT INTO full_source VALUES(" +
          FULL_SOURCE_COLUMNS.map((_, i) => "$" + (i + 1)).join(",") +
          ")",
        FULL_SOURCE_COLUMNS.map((k) => row[k]),
      );
    const file = path.join(f.privateRoot, name);
    await db.run(
      `COPY full_source TO '${file.replaceAll("'", "''")}' (FORMAT PARQUET)`,
    );
    return {
      role: "county-parcels",
      file,
      sha256: sha256(await readFile(file)),
      sourceSchemaSha256: schema,
      sourceRecordCount: input.length,
      sourceValidationSha256: sha256("synthetic-offline-proof"),
      sourceValidatedOffline: true,
    };
  };
  try {
    const config = await create(rows, "county-full.parquet"),
      reader = await RealSnapshot.open(out, { protectedFullSources: [config] });
    try {
      expect(reader.fullSourceAudits).toMatchObject([
        {
          records: 2,
          uniqueNativeIds: 2,
          matched: 1,
          unassigned: 1,
          sourceValidatedOffline: true,
          rawRowsReturned: false,
        },
      ]);
      const connection = (reader as unknown as { connection: typeof db })
        .connection;
      const definition = await (
        await connection.run(
          "SELECT sql FROM duckdb_views() WHERE view_name='private_county_parcels'",
        )
      ).getRowObjectsJson();
      expect(String(definition[0]!.sql)).toContain("read_parquet");
      const privateValue = await (
        await connection.run(
          "SELECT json_extract_string(source_record_json,'$.NAME1') AS source_party FROM private_county_parcels WHERE native_id='1'",
        )
      ).getRowObjectsJson();
      expect(privateValue[0]!.source_party).toBe(
        "PRIVATE_FULL_COUNTY_PARTY_SENTINEL",
      );
      await expect(
        connection.run("SELECT * FROM read_text('/etc/hosts')"),
      ).rejects.toThrow();
      await expect(
        connection.run("SET enable_external_access=true"),
      ).rejects.toThrow();
      const detail = await reader.detail("oakland-parcel-1", reader.snapshotId),
        search = await reader.search({
          snapshotId: reader.snapshotId,
          lat: 42.66,
          lng: -83.29,
          radiusMeters: 5000,
        });
      expect(
        JSON.stringify({
          detail,
          search,
          coverage: reader.coverage,
          audit: reader.fullSourceAudits,
        }),
      ).not.toContain("PRIVATE_FULL_COUNTY_");
    } finally {
      reader.close();
    }
    await expect(
      RealSnapshot.open(out, {
        protectedFullSources: [{ ...config, sourceRecordCount: 3 }],
      }),
    ).rejects.toThrow("metadata/native/count");
    await expect(
      RealSnapshot.open(out, {
        protectedFullSources: [
          await create(
            [{ ...rows[0]!, property_id: "missing" }],
            "invalid-full-fk.parquet",
          ),
        ],
      }),
    ).rejects.toThrow("property binding");
  } finally {
    db.closeSync();
    instance.closeSync();
  }
});
test("private full-source intake retains unmatched/source-only fields in DuckDB without exporting them to property/search DTOs", async () => {
  const f = await sourceFixture(),
    out = path.join(f.root, "public"),
    m = await buildCountySnapshot({
      sourceManifest: f.manifest,
      outputDir: out,
      privateOutputDir: path.join(f.privateRoot, "owners"),
    });
  const fields = {
    "Permit Type": "Res., Roof",
    "Permit Number": "SYN-INTAKE",
    "Date Issued": "Jan 1, 2011",
    Address: "Synthetic site 1",
    Applicant: "PRIVATE_SYNTHETIC_PERSON_SENTINEL",
    "Applicant Address": "PRIVATE_SYNTHETIC_POSTAL_SENTINEL",
    "Applicant City State Zip": "PRIVATE_SYNTHETIC_CITYZIP_SENTINEL",
    "Parcel #": "0012345678",
    Lot: "PRIVATE_SYNTHETIC_LOT_SENTINEL",
    Subdivision: "PRIVATE_SYNTHETIC_SUBDIVISION_SENTINEL",
    "Work Description": "PRIVATE_SYNTHETIC_RAW_SCOPE_SENTINEL",
    Value: "$1000",
  };
  const row = createPrivateSourceIntakeRow(fields, {
    publicSnapshotId: m.snapshotId,
    observedAt: "2026-10-28T01:00:00.000Z",
    receiptDigest: sha256("synthetic"),
    matchedPropertyId: null,
    joinStatus: "unmatched",
  });
  const i = await DuckDBInstance.create(":memory:"),
    db = await i.connect();
  const create = async (value: typeof row, name: string) => {
    await db.run(
      "CREATE OR REPLACE TABLE intake(" +
        SOURCE_INTAKE_COLUMNS.map((x) => x + " VARCHAR").join(",") +
        ")",
    );
    await db.run(
      "INSERT INTO intake VALUES(" +
        SOURCE_INTAKE_COLUMNS.map((_, i) => "$" + (i + 1)).join(",") +
        ")",
      SOURCE_INTAKE_COLUMNS.map((k) => value[k]),
    );
    const file = path.join(f.privateRoot, name);
    await db.run(
      `COPY intake TO '${file.replaceAll("'", "''")}' (FORMAT PARQUET)`,
    );
    return {
      protectedSourceIntakeFile: file,
      protectedSourceIntakeSha256: sha256(await readFile(file)),
    };
  };
  try {
    const reader = await RealSnapshot.open(
      out,
      await create(row, "intake.parquet"),
    );
    try {
      expect(reader.sourceIntakeCount).toBe(1);
      expect(reader.snapshotId).not.toBe(m.snapshotId);
      const audit = await reader.auditPrivateSourceIntake();
      expect(audit).toMatchObject({
        rows: 1,
        matched: 0,
        unassigned: 1,
        rawRowsReturned: false,
      });
      expect(audit.visibleSourceFields).toHaveLength(12);
      const result = await reader.search({
        snapshotId: reader.snapshotId,
        lat: 42.66,
        lng: -83.29,
        radiusMeters: 5000,
      });
      const detail = await reader.detail("oakland-parcel-1", reader.snapshotId);
      expect(
        JSON.stringify({ result, detail, coverage: reader.coverage, audit }),
      ).not.toContain("PRIVATE_SYNTHETIC_");
    } finally {
      reader.close();
    }
    await expect(
      RealSnapshot.open(
        out,
        await create(
          {
            ...row,
            matched_property_id: "missing-property",
            join_status: "matched",
          },
          "invalid-binding.parquet",
        ),
      ),
    ).rejects.toThrow("binding");
  } finally {
    db.closeSync();
    i.closeSync();
  }
});
test("protected canonical permits retain metadata, exclude issuance from open filters, and reject broken bindings", async () => {
  const f = await sourceFixture(),
    out = path.join(f.root, "public"),
    m = await buildCountySnapshot({
      sourceManifest: f.manifest,
      outputDir: out,
      privateOutputDir: path.join(f.privateRoot, "owners"),
    });
  const observedAt = "2026-10-28T01:00:00.000Z";
  const make = (
    number: string,
    property: string,
    business = "Synthetic Roofing LLC",
  ) => {
    const obs = normalizeTroyIssued(
      {
        permitNumber: number,
        issuedDate: "Apr 15, 2011",
        siteAddress: "Synthetic site 1",
        applicant: business,
        parcel: "88-00-12-345-678",
        reportedPermitType: "Res., Roof",
        description: "Roof work",
        value: "100",
      },
      { observedAt, receiptDigest: sha256("synthetic-receipt") },
    );
    const matched = matchTroyIssued(obs, [
      {
        propertyId: property,
        parcelPin: "0012345678",
        siteAddress: "Synthetic site 1",
        city: "Troy",
      },
    ]);
    return {
      property_id: property,
      permit_json: JSON.stringify(matched.permit),
      public_snapshot_id: m.snapshotId,
      source_id: TROY_SOURCE,
      native_id: number,
      record_digest: obs.recordDigest,
      observed_at: observedAt,
    };
  };
  const issued = make("SYN-ISSUED", "oakland-parcel-1"),
    explicit = make("SYN-OPEN", "oakland-parcel-3");
  const p = JSON.parse(explicit.permit_json);
  Object.assign(p, {
    status: "open",
    statusBasis: "explicit_open",
    reportedStatus: "Open",
    statusObservedAt: observedAt,
    openedAt: "2020-01-01",
  });
  p.provenance.push({
    sourceId: "official-troy-permit-status",
    recordId: "SYN-OPEN:status",
    observedAt,
    digest: sha256("synthetic-status"),
    kind: "real-minimized",
  });
  explicit.permit_json = JSON.stringify(p);
  const instance = await DuckDBInstance.create(":memory:"),
    db = await instance.connect();
  const create = async (rows: (typeof issued)[], name: string) => {
    await db.run(
      "CREATE OR REPLACE TABLE staged(property_id VARCHAR,permit_json VARCHAR,public_snapshot_id VARCHAR,source_id VARCHAR,native_id VARCHAR,record_digest VARCHAR,observed_at VARCHAR)",
    );
    for (const r of rows)
      await db.run(
        "INSERT INTO staged VALUES($property,$permit,$snapshot,$source,$native,$digest,$observed)",
        {
          property: r.property_id,
          permit: r.permit_json,
          snapshot: r.public_snapshot_id,
          source: r.source_id,
          native: r.native_id,
          digest: r.record_digest,
          observed: r.observed_at,
        },
      );
    const file = path.join(f.privateRoot, name);
    await db.run(
      `COPY staged TO '${file.replaceAll("'", "''")}' (FORMAT PARQUET)`,
    );
    return {
      protectedPermitsFile: file,
      protectedPermitsSha256: sha256(await readFile(file)),
    };
  };
  try {
    const ready = await create([issued, explicit], "permits.parquet"),
      reader = await RealSnapshot.open(out, ready);
    try {
      expect(reader.permitCount).toBe(2);
      const detail = await reader.detail("oakland-parcel-1", reader.snapshotId);
      expect(detail.permits[0]).toMatchObject({
        permitNumber: "SYN-ISSUED",
        status: "unknown",
        statusBasis: "issued_only",
        kind: "roof_unspecified",
        openedAt: null,
        closedAt: null,
        provenance: [{ kind: "real-minimized" }],
      });
      const result = await reader.search({
        snapshotId: reader.snapshotId,
        lat: 42.66,
        lng: -83.29,
        radiusMeters: 5000,
        permitStatus: "open",
        minOpenDays: 1827,
      });
      expect(result.rows.map((x) => x.id)).toEqual(["oakland-parcel-3"]);
      expect(result.rows[0]?.permits[0]?.statusObservedAt).toBe(observedAt);
      const publicReader = await RealSnapshot.open(out);
      try {
        expect(
          (await publicReader.detail("oakland-parcel-1", m.snapshotId)).permits,
        ).toEqual([]);
      } finally {
        publicReader.close();
      }
    } finally {
      reader.close();
    }
    await expect(
      RealSnapshot.open(
        out,
        await create(
          [{ ...issued, property_id: "unknown-property" }],
          "unknown.parquet",
        ),
      ),
    ).rejects.toThrow("binding");
    await expect(
      RealSnapshot.open(
        out,
        await create(
          [{ ...issued, public_snapshot_id: "different" }],
          "wrong-base.parquet",
        ),
      ),
    ).rejects.toThrow("rejected");
    await expect(
      RealSnapshot.open(
        out,
        await create([issued, issued], "duplicate.parquet"),
      ),
    ).rejects.toThrow("Duplicate");
    const bulk = await RealSnapshot.open(
      out,
      await create(
        Array.from({ length: 257 }, (_, i) =>
          make(
            `SYN-BULK-${i}`,
            "oakland-parcel-1",
            i === 256
              ? `O'Brien "Quoted" Roofing LLC`
              : "Synthetic Roofing LLC",
          ),
        ),
        "bulk.parquet",
      ),
    );
    try {
      expect(
        (await bulk.detail("oakland-parcel-1", bulk.snapshotId)).permits,
      ).toHaveLength(257);
      const quoted = (
        await bulk.detail("oakland-parcel-1", bulk.snapshotId)
      ).permits.find((x) => x.permitNumber === "SYN-BULK-256");
      expect(quoted).toMatchObject({
        issuedAt: "2011-04-15",
        status: "unknown",
        openedAt: null,
        closedAt: null,
        contractor: {
          reportedName: `O'Brien "Quoted" Roofing LLC`,
          license: null,
          rating: null,
        },
      });
    } finally {
      bulk.close();
    }
  } finally {
    db.closeSync();
    instance.closeSync();
  }
});
test("reported-sale age uses the latest observed sale, excludes unknown/future dates, and never establishes tenure", async () => {
  const f = await sourceFixture(),
    out = path.join(f.root, "public");
  await buildCountySnapshot({
    sourceManifest: f.manifest,
    outputDir: out,
    privateOutputDir: path.join(f.privateRoot, "owners"),
  });
  const instance = await DuckDBInstance.create(":memory:"),
    db = await instance.connect(),
    file = path.join(f.privateRoot, "sales.parquet");
  try {
    const m = JSON.parse(
      await readFile(path.join(out, "artifact-manifest.json"), "utf8"),
    );
    await db.run(
      "CREATE TABLE observations(property_id VARCHAR,source_id VARCHAR,native_id VARCHAR,built_year INTEGER,sale_date VARCHAR,receipt_digest VARCHAR,observed_at VARCHAR,page INTEGER,line INTEGER,record_digest VARCHAR,public_snapshot_id VARCHAR)",
    );
    for (const [id, date, n] of [
      ["oakland-parcel-1", "2008-01-01", 1],
      ["oakland-parcel-1", "2025-10-27", 2],
      ["oakland-parcel-2", "2010-05-15", 3],
      ["oakland-parcel-3", null, 4],
      ["oakland-address-4", "2027-01-01", 5],
    ] as const)
      await db.run(
        "INSERT INTO observations VALUES($id,'official-novi-residential-sales-pdf',$native,NULL,$date,$digest,'2026-10-27T08:00:00.000Z',1,$line,$digest,$snapshot)",
        {
          id,
          native: "synthetic-" + n,
          date,
          digest: sha256("synthetic-" + n),
          line: n,
          snapshot: m.snapshotId,
        },
      );
    await db.run(
      `COPY observations TO '${file.replaceAll("'", "''")}' (FORMAT PARQUET)`,
    );
    const reader = await RealSnapshot.open(out, {
      protectedEnrichmentFile: file,
      protectedEnrichmentSha256: sha256(await readFile(file)),
    });
    try {
      const q = {
        snapshotId: reader.snapshotId,
        lat: 42.66,
        lng: -83.29,
        radiusMeters: 5000,
      };
      expect(
        (await reader.search({ ...q, minReportedSaleAgeYears: 10 })).rows.map(
          (x) => x.id,
        ),
      ).toEqual(["oakland-parcel-2"]);
      expect(
        (await reader.search({ ...q, minReportedSaleAgeYears: 1 })).rows.map(
          (x) => x.id,
        ),
      ).toEqual(["oakland-parcel-2"]);
      expect(
        (await reader.search({ ...q, minReportedSaleAgeYears: 0 })).total,
      ).toBe(2);
      const d = await reader.detail("oakland-parcel-1", reader.snapshotId);
      expect(d.ownership.lastTransferDate).toBeNull();
      expect(d.ownership.historyCoverage).toBe("partial");
      await expect(
        reader.search({ ...q, minOwnershipYears: 1 }),
      ).rejects.toThrow("Ownership tenure is unknown");
    } finally {
      reader.close();
    }
  } finally {
    db.closeSync();
    instance.closeSync();
  }
});
test("full projection preserves native IDs, all address associations, unmatched and stacked locations, with deterministic bytes", async () => {
  const f = await sourceFixture(),
    out = path.join(f.root, "public"),
    privateOut = path.join(f.privateRoot, "derivatives");
  const m = await buildCountySnapshot({
    sourceManifest: f.manifest,
    outputDir: out,
    privateOutputDir: privateOut,
  });
  expect(m.parcelCount).toBe(3);
  expect(m.addressCount).toBe(5);
  expect(m.count).toBe(4);
  const second = await buildCountySnapshot({
    sourceManifest: f.manifest,
    outputDir: path.join(f.root, "rebuild"),
    privateOutputDir: path.join(f.privateRoot, "rebuild"),
  });
  expect(second.digest).toBe(m.digest);
  expect(second.files).toEqual(m.files);
  const real = await RealSnapshot.open(out);
  let spillDirectory: string;
  try {
    const connection = (real as unknown as { connection: DuckDBConnection })
      .connection;
    const scratchSettings = await (
      await connection.run(
        "SELECT name,value FROM duckdb_settings() WHERE name IN ('temp_directory','max_temp_directory_size')",
      )
    ).getRowObjectsJson();
    spillDirectory = String(
      scratchSettings.find((s) => s.name === "temp_directory")!.value,
    );
    expect(path.dirname(spillDirectory)).toBe(os.tmpdir());
    expect(path.basename(spillDirectory)).toMatch(/^prism-duckdb-/);
    expect((await stat(spillDirectory)).mode & 0o777).toBe(0o700);
    expect(
      String(
        scratchSettings.find((s) => s.name === "max_temp_directory_size")!
          .value,
      ),
    ).toBe("488.2 MiB");
    const q = {
      snapshotId: m.snapshotId,
      lat: 42.66,
      lng: -83.29,
      radiusMeters: 5000,
    };
    const r = await real.search(q);
    expect(r.total).toBe(4);
    expect(r.rows.map((x) => x.id)).toContain("oakland-address-4");
    expect(
      r.rows.every(
        (x) =>
          x.coordinates &&
          x.roof.ageYears === null &&
          x.ownership.ownerRegion === "unknown",
      ),
    ).toBe(true);
    const d = await real.detail("oakland-parcel-1", m.snapshotId);
    expect(d.siteAddressCount).toBe(3);
    expect(d.siteAddresses?.map((a) => a.nativeId)).toEqual(["1", "2", "5"]);
    expect(
      d.siteAddresses?.find((a) => a.nativeId === "5")?.coordinates,
    ).toBeNull();
    const alternate = await real.search({
      ...q,
      lat: 43,
      lng: -84,
      radiusMeters: 200,
    });
    expect(alternate.total).toBe(2);
    expect(alternate.rows.every((x) => x.coordinates?.lat === 43)).toBe(true);
    expect((await real.search({ ...q, roofMinAgeYears: 15 })).total).toBe(0);
    expect(
      (await real.search({ ...q, roofMinAgeYears: 15, includeUnknown: true }))
        .total,
    ).toBe(4);
    expect(
      (await real.search({ ...q, permitStatus: "open", minOpenDays: 1827 }))
        .total,
    ).toBe(0);
    await expect(real.search({ ...q, minOwnershipYears: 10 })).rejects.toThrow(
      "Ownership tenure is unknown",
    );
    await expect(
      real.search({ ...q, ownerRegion: "out_of_area" }),
    ).rejects.toThrow("protected");
    const paged = await real.search({ ...q, limit: 1 });
    expect(paged.nextCursor).not.toBeNull();
    await expect(
      real.search({ ...q, lat: 42.67, limit: 1, cursor: paged.nextCursor }),
    ).rejects.toThrow("Cursor");
    expect(
      (await real.search({ ...q, lat: 89.99, lng: 179.99, radiusMeters: 100 }))
        .total,
    ).toBe(0);
  } finally {
    real.close();
  }
  await expect(stat(spillDirectory)).rejects.toThrow();
  const protectedFile = path.join(privateOut, "owner-derivatives.parquet");
  const protectedReader = await RealSnapshot.open(out, {
    protectedDerivativeFile: protectedFile,
    protectedDerivativeSha256: sha256(await readFile(protectedFile)),
  });
  try {
    const result = await protectedReader.search({
      snapshotId: protectedReader.snapshotId,
      lat: 42.66,
      lng: -83.29,
      radiusMeters: 5000,
      ownerRegion: "out_of_area",
    });
    expect(protectedReader.snapshotId).not.toBe(m.snapshotId);
    await expect(
      protectedReader.search({
        snapshotId: m.snapshotId,
        lat: 42.66,
        lng: -83.29,
        radiusMeters: 5000,
      }),
    ).rejects.toThrow("snapshot");
    expect(result.rows.map((p) => p.id)).toEqual(["oakland-parcel-2"]);
    expect(result.rows[0]!.ownership.locationClass).toBe("out_of_state");
    expect(JSON.stringify(result)).not.toContain("Synthetic other site");
  } finally {
    protectedReader.close();
  }
  const files = m.files;
  for (const file of files) {
    if (file.name.endsWith(".json")) {
      const body = await readFile(path.join(out, file.name), "utf8");
      expect(body).not.toContain("Synthetic other site");
      expect(body).not.toContain("POSTALADDRESS");
    }
  }
  await writeFile(path.join(out, "sample.json"), "tampered");
  await expect(verifySnapshotDirectory(out)).rejects.toThrow("size");
  const link = path.join(f.root, "link");
  await symlink(out, link);
  await expect(verifySnapshotDirectory(link)).rejects.toThrow("symlink");
});
test("incomplete or unexpected fields cannot promote a county snapshot", async () => {
  const f = await sourceFixture();
  f.source.layers.parcel.complete = false;
  await writeFile(f.manifest, JSON.stringify(f.source));
  await expect(
    buildCountySnapshot({
      sourceManifest: f.manifest,
      outputDir: path.join(f.root, "bad"),
      privateOutputDir: path.join(f.privateRoot, "bad"),
    }),
  ).rejects.toThrow("incomplete");
});
test("owner derivatives preserve unknown and do not infer county or tenure from ZIP/revision", () => {
  expect(deriveOwnerLocation(null, null, null)).toMatchObject({
    ownerRegion: "unknown",
    locationClass: "unknown",
  });
  expect(
    deriveOwnerLocation("Synthetic PO BOX, CA 90000", null, null),
  ).toMatchObject({
    ownerRegion: "out_of_area",
    locationClass: "out_of_state",
  });
  expect(
    deriveOwnerLocation("Synthetic town MI 00000", null, null).locationClass,
  ).toBe("in_state");
  expect(
    deriveOwnerLocation("Synthetic foreign address", null, null).ownerRegion,
  ).toBe("unknown");
});
test("optional owner and tenure predicates agree in synthetic DuckDB/reference readers", async () => {
  const properties = syntheticProperties(),
    reference = new SnapshotReader(SNAPSHOT_ID, properties),
    duck = await DuckSnapshot.create(SNAPSHOT_ID, properties);
  try {
    for (const fields of [
      { ownerRegion: "out_of_area" },
      { ownerRegion: "unknown" },
      { minOwnershipYears: 10 },
      { ownerRegion: "out_of_area", minOwnershipYears: 10 },
    ]) {
      const q = {
        snapshotId: SNAPSHOT_ID,
        lat: 42.66,
        lng: -83.29,
        radiusMeters: 8000,
        ...fields,
      };
      const a = reference.search(q),
        b = await duck.search(q);
      expect(b.rows.map((p) => p.id)).toEqual(a.rows.map((p) => p.id));
      expect(b.total).toBe(a.total);
    }
  } finally {
    duck.close();
  }
});

test("changed observation inputs cannot alias a prior snapshot; explicit no-change reuse preserves immutable data bytes", async () => {
  const f = await sourceFixture(),
    firstDir = path.join(f.root, "first");
  const first = await buildCountySnapshot({
    sourceManifest: f.manifest,
    outputDir: firstDir,
    privateOutputDir: path.join(f.privateRoot, "first"),
  });
  for (const layer of Object.values(f.source.layers))
    for (const page of layer.pages)
      page.observedAt = "2026-10-28T08:00:00.000Z";
  f.source.runs = [
    {
      id: "test-no-change-second",
      complete: true,
      kind: "synthetic-no-change",
      startedAt: "2026-10-28T08:00:00.000Z",
    },
  ];
  await writeFile(f.manifest, JSON.stringify(f.source));
  const changed = await buildCountySnapshot({
    sourceManifest: f.manifest,
    outputDir: path.join(f.root, "changed-inputs"),
    privateOutputDir: path.join(f.privateRoot, "changed"),
  });
  expect(changed.snapshotId).not.toBe(first.snapshotId);
  const reused = await buildCountySnapshot({
    sourceManifest: f.manifest,
    outputDir: path.join(f.root, "reused"),
    privateOutputDir: path.join(f.privateRoot, "reused"),
    previousSnapshotDir: firstDir,
  });
  expect(reused.snapshotId).toBe(first.snapshotId);
  expect(reused.digest).toBe(first.digest);
  for (const name of [
    "parcels.parquet",
    "site-addresses.parquet",
    "coverage.json",
    "dataset-manifest.json",
    "sample.json",
  ])
    expect(reused.files.find((f) => f.name === name)?.sha256).toBe(
      first.files.find((f) => f.name === name)?.sha256,
    );
});
test("leap-day ownership anniversary is clamped consistently to the calendar month end", async () => {
  const row = syntheticProperties()[0]!;
  row.ownership.lastTransferDate = "2020-02-29";
  row.ownership.transferHistoryCoverage = {
    state: "full",
    from: "2020-02-29",
    through: "2021-02-28",
    provenance: row.provenance,
    limitations: ["Synthetic complete history test fixture only"],
  };
  row.ownership.uninterruptedTenure = {
    state: "supported",
    unchangedSince: "2020-02-29",
    asOf: "2021-02-28",
    provenance: row.provenance,
  };
  row.roof.asOf = "2021-02-28";
  row.coordinates = { lat: 42.66, lng: -83.29 };
  const reader = new SnapshotReader(SNAPSHOT_ID, [row]),
    duck = await DuckSnapshot.create(SNAPSHOT_ID, [row]);
  try {
    const q = {
      snapshotId: SNAPSHOT_ID,
      lat: 42.66,
      lng: -83.29,
      radiusMeters: 100,
      minOwnershipYears: 1,
    };
    expect(reader.search(q).total).toBe(1);
    expect((await duck.search(q)).total).toBe(1);
  } finally {
    duck.close();
  }
});

test.each([
  {
    publicObservedAt: "2026-10-27T08:00:00.000Z",
    builtYear: 1990,
    expectedAge: 36,
  },
  // A later source observation can follow the public snapshot. Its retained year
  // must survive independently of a clamped age; asOf-age would falsely yield 2020.
  {
    publicObservedAt: "2020-10-27T08:00:00.000Z",
    builtYear: 2025,
    expectedAge: 0,
  },
])(
  "protected source year $builtYear remains precise when proxy age is $expectedAge, outside public snapshots and unable to prove tenure",
  async ({ publicObservedAt, builtYear, expectedAge }) => {
    const f = await sourceFixture(),
      out = path.join(f.root, "public");
    for (const layer of Object.values(f.source.layers))
      for (const page of layer.pages) page.observedAt = publicObservedAt;
    await writeFile(f.manifest, JSON.stringify(f.source));
    const m = await buildCountySnapshot({
      sourceManifest: f.manifest,
      outputDir: out,
      privateOutputDir: path.join(f.privateRoot, "owner"),
    });
    const input = path.join(f.privateRoot, "enrichment.json");
    await writeFile(
      input,
      JSON.stringify({
        observedAt: "2026-10-27T08:00:00.000Z",
        sources: [
          {
            sourceId: "official-novi-residential-sales-pdf",
            url: "https://www.cityofnovi.org/media/synthetic.pdf",
            bodySha256: sha256("synthetic-pdf"),
            observedAt: "2026-10-27T08:00:00.000Z",
            rights: "private_pending_redistribution",
            observations: [
              {
                nativeId: "synthetic-row-1",
                sourcePin: "50-00-12-345-678",
                normalizedPin: "0012345678",
                builtYear,
                saleDate: "2024-05-15",
                page: 1,
                line: 1,
                recordDigest: sha256("synthetic-row"),
              },
            ],
          },
        ],
      }),
    );
    const privateDir = path.join(f.privateRoot, "enriched");
    const summary = await buildProtectedEnrichment({
      snapshotDirectory: out,
      inputFile: input,
      outputDirectory: privateDir,
      protectedRoots: [out],
    });
    expect(summary.counts).toMatchObject({
      observations: 1,
      matched_properties: 2,
    });
    const file = path.join(privateDir, "protected-enrichment.parquet"),
      reader = await RealSnapshot.open(out, {
        protectedEnrichmentFile: file,
        protectedEnrichmentSha256: sha256(await readFile(file)),
      });
    const publicReader = await RealSnapshot.open(out);
    try {
      expect(reader.snapshotId).not.toBe(m.snapshotId);
      const q = {
        snapshotId: reader.snapshotId,
        lat: 42.66,
        lng: -83.29,
        radiusMeters: 5000,
        ...(expectedAge > 0 ? { roofMinAgeYears: expectedAge - 1 } : {}),
        minConfidence: "low",
      };
      const result = await reader.search(q);
      expect(result.total).toBe(2);
      expect(
        result.rows.every(
          (p) =>
            p.roof.basis === "built_year" &&
            p.roof.confidence === "low" &&
            p.roof.ageYears === expectedAge &&
            p.roof.caveats.includes(
              `Source-reported building year: ${builtYear}. This is a building year proxy, not a verified roof installation year.`,
            ),
        ),
      ).toBe(true);
      expect(
        result.rows.every(
          (p) =>
            p.roof.provenance?.[0]?.kind === "real-minimized" &&
            p.ownership.events?.[0]?.kind === "reported_sale" &&
            p.ownership.lastTransferDate === null &&
            p.ownership.historyCoverage === "partial",
        ),
      ).toBe(true);
      expect(
        (
          await publicReader.search({
            ...q,
            snapshotId: publicReader.snapshotId,
          })
        ).total,
      ).toBe(0);
      const detail = await reader.detail(result.rows[0]!.id, reader.snapshotId);
      expect(detail.roof.caveats).toEqual(result.rows[0]!.roof.caveats);
      expect(detail.roof.asOf).toBe(publicObservedAt.slice(0, 10));
      if (expectedAge === 0)
        expect(
          Number(detail.roof.asOf.slice(0, 4)) - detail.roof.ageYears!,
        ).not.toBe(builtYear);
      const publicDetail = await publicReader.detail(
        result.rows[0]!.id,
        publicReader.snapshotId,
      );
      expect(publicDetail.roof.ageYears).toBeNull();
      expect(publicDetail.roof.caveats.join(" ")).not.toContain(
        "Source-reported building year:",
      );
      await expect(
        reader.search({ ...q, minOwnershipYears: 10 }),
      ).rejects.toThrow("tenure is unknown");
      await expect(
        reader.search({ ...q, ownerRegion: "out_of_area" }),
      ).rejects.toThrow("protected");
    } finally {
      reader.close();
      publicReader.close();
    }
  },
);

test("owner address comparison never aliases street-number or unit prefixes", () => {
  expect(
    deriveOwnerLocation(
      "1100 MAIN ST, TESTVILLE MI 12345",
      "100 MAIN ST",
      "TESTVILLE",
    ),
  ).toMatchObject({ siteAddressMatch: false, locationClass: "in_state" });
  expect(
    deriveOwnerLocation(
      "100 MAIN ST UNIT 10, TESTVILLE MI 12345",
      "100 MAIN ST UNIT 1",
      "TESTVILLE",
    ),
  ).toMatchObject({ siteAddressMatch: false, locationClass: "in_state" });
  expect(
    deriveOwnerLocation(
      "100 MAIN ST UNIT 1, TESTVILLE MI 12345",
      "100 MAIN ST UNIT 1",
      "TESTVILLE",
    ),
  ).toMatchObject({ siteAddressMatch: true, locationClass: "local" });
  expect(
    deriveOwnerLocation("100 MAIN ST", "100 MAIN ST", "TESTVILLE"),
  ).toMatchObject({
    siteAddressMatch: null,
    ownerRegion: "unknown",
    locationClass: "unknown",
  });
});

test("protected Rochester source projects only labeled owners and issued permits with exact snapshot address assignments", async () => {
  const { rhRow, rhSchema } = await import("./private-rochester.fixture.ts");
  const f = await sourceFixture("CITY OF ROCHESTER HILLS"),
    out = path.join(f.root, "public");
  const m = await buildCountySnapshot({
    sourceManifest: f.manifest,
    outputDir: out,
    privateOutputDir: path.join(f.privateRoot, "owners"),
  });
  const instance = await DuckDBInstance.create(":memory:"),
    db = await instance.connect();
  const create = async (
    rows: ReturnType<typeof rhRow>[],
    name: string,
  ): Promise<FullSourceConfig> => {
    await db.run(
      "CREATE OR REPLACE TABLE rh(" +
        FULL_SOURCE_COLUMNS.map((k) => k + " VARCHAR").join(",") +
        ")",
    );
    for (const row of rows)
      await db.run(
        "INSERT INTO rh VALUES(" +
          FULL_SOURCE_COLUMNS.map((_, i) => "$" + (i + 1)).join(",") +
          ")",
        FULL_SOURCE_COLUMNS.map((k) => row[k]),
      );
    const file = path.join(f.privateRoot, name);
    await db.run(`COPY rh TO '${file.replaceAll("'", "''")}' (FORMAT PARQUET)`);
    return {
      role: "rochester-source",
      file,
      sha256: sha256(await readFile(file)),
      sourceSchemaSha256: rhSchema,
      sourceRecordCount: rows.length,
      sourceValidationSha256: sha256("synthetic-source-proof"),
      sourceValidatedOffline: true,
    };
  };
  const rows = [
    rhRow(1, "issued"),
    rhRow(2, "applied"),
    rhRow(3, "applied"),
  ].map((x) => ({ ...x, public_snapshot_id: m.snapshotId }));
  const unmatched = JSON.parse(rows[2]!.source_record_json);
  unmatched.propertyAddressRaw = "Synthetic unmatched site";
  rows[2]!.property_id = null;
  rows[2]!.source_record_json = JSON.stringify(unmatched);
  rows[2]!.record_digest = sha256(rows[2]!.source_record_json);
  try {
    const config = await create(rows, "valid-rh.parquet"),
      reader = await RealSnapshot.open(out, { protectedFullSources: [config] }),
      publicReader = await RealSnapshot.open(out);
    try {
      const detail = await reader.detail("oakland-parcel-1", reader.snapshotId);
      expect(reader.permitCount).toBe(1);
      expect(detail.permits).toHaveLength(1);
      expect(detail.permits[0]).toMatchObject({
        status: "unknown",
        statusBasis: "issued_only",
        contractor: { reportedName: null },
      });
      expect(detail.ownership.reportedOwnerObservations).toHaveLength(2);
      expect(
        detail.ownership.reportedOwnerObservations!.map(
          (x) => x.relatedPermitEvent?.kind,
        ),
      ).toEqual(["issued", "applied"]);
      expect(detail.ownership.lastTransferDate).toBeNull();
      expect(detail.ownership.uninterruptedTenure?.state).toBe(
        "insufficient_history",
      );
      const q = {
        snapshotId: reader.snapshotId,
        lat: 42.66,
        lng: -83.29,
        radiusMeters: 5000,
        permitStatus: "unknown",
      };
      expect((await reader.search(q)).total).toBe(1);
      expect(JSON.stringify(detail)).not.toContain("SYNTHETIC_UNKNOWN_PARTY");
      expect(JSON.stringify(detail)).not.toContain("SYNTHETIC_PHONE");
      expect(
        JSON.stringify(
          await publicReader.detail(
            "oakland-parcel-1",
            publicReader.snapshotId,
          ),
        ),
      ).not.toContain("SYNTHETIC_OWNER_ONLY");
      const conn = (reader as unknown as { connection: typeof db }).connection;
      const retained = await (
        await conn.run(
          "SELECT count(*) AS n FROM private_rochester_building_reports",
        )
      ).getRowObjectsJson();
      expect(Number(retained[0]!.n)).toBe(3);
    } finally {
      reader.close();
      publicReader.close();
    }
    for (const [i, property] of ["missing", "oakland-parcel-3", null].entries())
      await expect(
        RealSnapshot.open(out, {
          protectedFullSources: [
            await create(
              [{ ...rows[0]!, property_id: property }],
              "bad-rh-" + i + ".parquet",
            ),
          ],
        }),
      ).rejects.toThrow(/property binding|exact-address/);
    const overflow = Array.from({ length: 257 }, (_, i) => ({
      ...rhRow(i + 1, "applied"),
      public_snapshot_id: m.snapshotId,
    }));
    await expect(
      RealSnapshot.open(out, {
        protectedFullSources: [
          await create(overflow, "owner-overflow.parquet"),
        ],
      }),
    ).rejects.toThrow("reported-owner property bound");
  } finally {
    db.closeSync();
    instance.closeSync();
  }
});

test("a pinned single UI assessment preserves39rawfields and yields an actual-coordinate regional query without tenure or guessed sale date", async () => {
  const { assessmentRow, assessmentSchema } =
    await import("./private-assessment.fixture.ts");
  const f = await sourceFixture("CITY OF TROY", "2000000001"),
    out = path.join(f.root, "public"),
    m = await buildCountySnapshot({
      sourceManifest: f.manifest,
      outputDir: out,
      privateOutputDir: path.join(f.privateRoot, "owners"),
    });
  const instance = await DuckDBInstance.create(":memory:"),
    db = await instance.connect();
  const create = async (
    row: ReturnType<typeof assessmentRow>,
    name: string,
  ): Promise<FullSourceConfig> => {
    await db.run(
      "CREATE OR REPLACE TABLE assessment(" +
        FULL_SOURCE_COLUMNS.map((k) => k + " VARCHAR").join(",") +
        ")",
    );
    await db.run(
      "INSERT INTO assessment VALUES(" +
        FULL_SOURCE_COLUMNS.map((_, i) => "$" + (i + 1)).join(",") +
        ")",
      FULL_SOURCE_COLUMNS.map((k) => row[k]),
    );
    const file = path.join(f.privateRoot, name);
    await db.run(
      `COPY assessment TO '${file.replaceAll("'", "''")}' (FORMAT PARQUET)`,
    );
    return {
      role: "assessment-source",
      file,
      sha256: sha256(await readFile(file)),
      sourceSchemaSha256: assessmentSchema,
      sourceRecordCount: 1,
      sourceValidationSha256: sha256("synthetic39field-transcription-proof"),
      sourceValidatedOffline: true,
    };
  };
  try {
    const config = await create(
        assessmentRow(m.snapshotId),
        "assessment.parquet",
      ),
      reader = await RealSnapshot.open(out, { protectedFullSources: [config] }),
      publicReader = await RealSnapshot.open(out);
    try {
      const result = await reader.search({
        snapshotId: reader.snapshotId,
        lat: 42.66,
        lng: -83.29,
        radiusMeters: 1000,
        ownerRegion: "regional",
      });
      expect(result.total).toBe(1);
      expect(result.rows[0]!.id).toBe("oakland-parcel-3");
      const detail = await reader.detail("oakland-parcel-3", reader.snapshotId);
      expect(detail.roof).toMatchObject({
        ageYears: 4,
        basis: "built_year",
        confidence: "low",
      });
      expect(detail.ownership.locationProvenance).toHaveLength(1);
      expect(detail.roof.caveats.join(" ")).toContain(
        "no specific building, unit or roof identity is verified",
      );
      expect(detail.ownership.reportedOwnerObservations).toHaveLength(2);
      expect(detail.ownership.lastTransferDate).toBeNull();
      expect(detail.ownership.events).toEqual([]);
      expect(detail.ownership.uninterruptedTenure!.state).toBe(
        "insufficient_history",
      );
      expect(detail.permits).toEqual([]);
      expect(JSON.stringify(detail)).not.toContain("SYN_TAXPAYER_NOT_OWNER");
      expect(JSON.stringify(detail)).not.toContain("source_record_json");
      expect(
        JSON.stringify(
          await publicReader.detail(
            "oakland-parcel-3",
            publicReader.snapshotId,
          ),
        ),
      ).not.toContain("SYN_ASSESSMENT_OWNER");
      const conn = (reader as unknown as { connection: typeof db }).connection;
      const raw = await (
        await conn.run(
          "SELECT json_extract_string(source_record_json,'$.fields.\"Taxpayer Street Addr\"') AS taxpayer FROM private_troy_assessing_ui_sources",
        )
      ).getRowObjectsJson();
      expect(raw[0]!.taxpayer).toBe("SYN_TAXPAYER_NOT_OWNER");
      await expect(
        reader.search({
          snapshotId: reader.snapshotId,
          lat: 42.66,
          lng: -83.29,
          radiusMeters: 1000,
          minOwnershipYears: 10,
        }),
      ).rejects.toThrow("Ownership tenure is unknown");
    } finally {
      reader.close();
      publicReader.close();
    }
    const row = assessmentRow(m.snapshotId),
      raw = JSON.parse(row.source_record_json);
    raw.fields["Property Address"] = "Synthetic site 1";
    row.source_record_json = JSON.stringify(raw);
    row.record_digest = sha256(row.source_record_json);
    const differentAddress = await RealSnapshot.open(out, {
      protectedFullSources: [
        await create(row, "different-assessment-address.parquet"),
      ],
    });
    try {
      const detail = await differentAddress.detail(
        "oakland-parcel-3",
        differentAddress.snapshotId,
      );
      expect(
        detail.ownership.reportedOwnerObservations![0]!.limitations.join(" "),
      ).toContain("street address text differs");
      expect(differentAddress.fullSourceAudits[0]!.addressDisagreements).toBe(
        1,
      );
    } finally {
      differentAddress.close();
    }
    const wrong = assessmentRow(m.snapshotId),
      wrongSource = JSON.parse(wrong.source_record_json);
    wrongSource.normalizedCountyPin = "2000000002";
    wrongSource.fields["Parcel Number"] = "88-20-00-000-002";
    wrong.native_id = wrongSource.fields["Parcel Number"];
    wrong.source_record_json = JSON.stringify(wrongSource);
    wrong.record_digest = sha256(wrong.source_record_json);
    await expect(
      RealSnapshot.open(out, {
        protectedFullSources: [
          await create(wrong, "foreign-assessment-pin.parquet"),
        ],
      }),
    ).rejects.toThrow("exact-PIN/jurisdiction");
  } finally {
    db.closeSync();
    instance.closeSync();
  }
});
