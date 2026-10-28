import { expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, symlink } from "node:fs/promises";
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
import { DuckDBInstance } from "@duckdb/node-api";
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
async function sourceFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "prism-county-"));
  const privateRoot = path.join(root, "private");
  await mkdir(privateRoot, { mode: 0o700 });
  const observedAt = "2026-10-27T08:00:00.000Z";
  const parcelFeatures = [1, 2, 3].map((i) => ({
    attributes: {
      OBJECTID_12: i,
      OBJECTID: i,
      KEYPIN: i === 2 ? "0012345678" : "200" + i,
      PIN: i === 2 ? "0012345678" : i === 1 ? "0012345678" : "2003",
      REVISIONDATE: 1791806753000,
      CVTTAXCODE: "test",
      CVTTAXDESCRIPTION: "Synthetic jurisdiction",
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
    { id: 3, pin: "2003", x: -83.29, y: 42.66 },
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
test("protected canonical permits retain metadata, exclude issuance from open filters, and reject broken bindings", async () => {
  const f = await sourceFixture(),
    out = path.join(f.root, "public"),
    m = await buildCountySnapshot({
      sourceManifest: f.manifest,
      outputDir: out,
      privateOutputDir: path.join(f.privateRoot, "owners"),
    });
  const observedAt = "2026-10-28T01:00:00.000Z";
  const make = (number: string, property: string) => {
    const obs = normalizeTroyIssued(
      {
        permitNumber: number,
        issuedDate: "Apr 15, 2011",
        siteAddress: "Synthetic site 1",
        applicant: "Synthetic Roofing LLC",
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
  try {
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
