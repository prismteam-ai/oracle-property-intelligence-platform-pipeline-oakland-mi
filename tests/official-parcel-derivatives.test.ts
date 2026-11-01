import { expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import {
  assertOfficialOwnerDerivativeCompatible,
  compareOfficialOwnerDerivatives,
} from "../packages/county/src/official-parcel-derivatives.ts";
import { projectOfficialParcelObservation } from "../packages/county/src/official-parcel.ts";
import {
  deriveOwnerLocation,
  OWNER_DERIVATION_VERSION,
  sha256,
} from "../packages/county/src/model.ts";
import { FULL_SOURCE_COLUMNS } from "../packages/county/src/private-full-source.ts";
import {
  officialProfileFixture,
  source,
  snapshot,
  observedAt,
} from "./official-parcel.fixture.ts";

const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
async function fixture(
  options: {
    mismatch?: boolean;
    missing?: boolean;
    extra?: boolean;
    wrongNative?: boolean;
    wrongTransform?: boolean;
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "prism-derivative-fixture-"));
  const file = path.join(root, "source.parquet"),
    owner = path.join(root, "owner.parquet");
  const instance = await DuckDBInstance.create(":memory:");
  const db = await instance.connect();
  try {
    await db.run(
      `CREATE TABLE source(${FULL_SOURCE_COLUMNS.map((name) => name + " VARCHAR").join(",")})`,
    );
    await db.run(
      "CREATE TABLE owner(property_id VARCHAR,public_snapshot_id VARCHAR,transform_version VARCHAR,owner_region VARCHAR,location_class VARCHAR,site_address_match BOOLEAN,evidence_class VARCHAR)",
    );
    for (let id = 1; id <= 3; id++) {
      const raw = JSON.stringify({
        OBJECTID_12: options.wrongNative && id === 1 ? 99 : id,
        NAME1: null,
        NAME2: null,
        POSTALADDRESS:
          id === 1
            ? "1 SYNTHETIC ROAD, SYNTHETIC CITY MI 00000"
            : id === 2
              ? "SYNTHETIC MAIL CA 00000"
              : null,
        SITEADDRESS: "1 SYNTHETIC ROAD",
        SITECITY: "SYNTHETIC CITY",
      });
      await db.run(
        "INSERT INTO source VALUES($version,$source,$native,$snapshot,$schema,$json,$digest,$at,$property)",
        {
          version: "county-full-attributes-v1",
          source: "official-oakland-tax-parcel-full-attributes",
          native: String(id),
          snapshot,
          schema: source.sourceSchemaSha256,
          json: raw,
          digest: sha256(raw),
          at: observedAt,
          property: "oakland-parcel-" + id,
        },
      );
      if (options.missing && id === 3) continue;
      const fields = JSON.parse(raw) as Record<string, unknown>;
      const d = deriveOwnerLocation(
        fields.POSTALADDRESS,
        fields.SITEADDRESS,
        fields.SITECITY,
      );
      await db.run(
        "INSERT INTO owner VALUES($id,$snapshot,$transform,$region,$location,$match,$evidence)",
        {
          id: "oakland-parcel-" + id,
          snapshot,
          transform: options.wrongTransform
            ? "wrong-transform"
            : OWNER_DERIVATION_VERSION,
          region: options.mismatch && id === 1 ? "out_of_area" : d.ownerRegion,
          location: d.locationClass,
          match: d.siteAddressMatch,
          evidence: d.evidenceClass,
        },
      );
    }
    if (options.extra)
      await db.run(
        "INSERT INTO owner VALUES('oakland-parcel-99',$snapshot,$transform,'unknown','unknown',NULL,'unknown')",
        { snapshot, transform: OWNER_DERIVATION_VERSION },
      );
    await db.run(`COPY source TO ${quote(file)} (FORMAT PARQUET)`);
    await db.run(`COPY owner TO ${quote(owner)} (FORMAT PARQUET)`);
  } finally {
    db.closeSync();
    instance.closeSync();
  }
  return {
    root,
    options: {
      source: { ...source, file, sha256: sha256(await readFile(file)) },
      ownerFile: owner,
      ownerSha256: sha256(await readFile(owner)),
      publicSnapshotId: snapshot,
    },
  };
}

test("complete retained comparison streams all rows and emits only count/hash proof", async () => {
  const f = await fixture();
  try {
    const proof = await compareOfficialOwnerDerivatives(f.options);
    expect(proof).toMatchObject({
      status: "PASS_ALL_RETAINED_POSTAL_DERIVATIVES_MATCH",
      comparedRows: 3,
      mismatchedRows: 0,
      missingLegacyRows: 0,
      extraLegacyRows: 0,
      fullCorpusCompared: true,
      rowsOrPostalValuesEmitted: false,
      sourceOrDerivativeFilesChanged: false,
    });
    expect(JSON.stringify(proof)).not.toContain("SYNTHETIC ROAD");
    expect(sha256(await readFile(f.options.source.file))).toBe(
      f.options.source.sha256,
    );
    expect(sha256(await readFile(f.options.ownerFile))).toBe(
      f.options.ownerSha256,
    );
    await expect(
      compareOfficialOwnerDerivatives({
        ...f.options,
        ownerSha256: sha256("wrong bytes"),
      }),
    ).rejects.toThrow("Exact bounded");
  } finally {
    await rm(f.root, { recursive: true });
  }
});

test.each([
  [
    { mismatch: true },
    {
      comparedRows: 3,
      mismatchedRows: 1,
      missingLegacyRows: 0,
      extraLegacyRows: 0,
    },
  ],
  [
    { missing: true },
    {
      comparedRows: 2,
      mismatchedRows: 0,
      missingLegacyRows: 1,
      extraLegacyRows: 0,
    },
  ],
  [
    { extra: true },
    {
      comparedRows: 3,
      mismatchedRows: 0,
      missingLegacyRows: 0,
      extraLegacyRows: 1,
    },
  ],
] as const)(
  "mismatch or incomplete legacy coverage cannot pass: %j",
  async (options, expected) => {
    const f = await fixture(options);
    try {
      expect(await compareOfficialOwnerDerivatives(f.options)).toMatchObject({
        status: "STOP_DERIVATIVE_MISMATCH_REQUIRES_RECONCILIATION",
        ...expected,
      });
    } finally {
      await rm(f.root, { recursive: true });
    }
  },
);

test.each([{ wrongNative: true }, { wrongTransform: true }])(
  "wrong native association or transform cannot certify agreement: %j",
  async (options) => {
    const f = await fixture(options);
    try {
      await expect(
        compareOfficialOwnerDerivatives(f.options),
      ).rejects.toThrow();
    } finally {
      await rm(f.root, { recursive: true });
    }
  },
);

test("runtime guard rejects absent or contradictory legacy derivatives before serving an observation", () => {
  const raw = JSON.stringify({
    OBJECTID_12: 1,
    POSTALADDRESS: "SYNTHETIC MAIL CA 00000",
  });
  const observation = projectOfficialParcelObservation(
    {
      property_id: "oakland-parcel-1",
      native_id: "1",
      source_record_json: raw,
      record_digest: sha256(raw),
      observed_at: observedAt,
    },
    officialProfileFixture(),
  );
  const legacy = {
    owner_region: "out_of_area",
    location_class: "out_of_state",
    site_address_match: null,
    evidence_class: "derived_deterministically",
  };
  expect(() =>
    assertOfficialOwnerDerivativeCompatible(observation, legacy),
  ).not.toThrow();
  expect(() =>
    assertOfficialOwnerDerivativeCompatible(observation, undefined),
  ).toThrow("contradicts");
  for (const changed of [
    { owner_region: "regional" },
    { location_class: "local" },
    { site_address_match: true },
    { evidence_class: "unknown" },
  ])
    expect(() =>
      assertOfficialOwnerDerivativeCompatible(observation, {
        ...legacy,
        ...changed,
      }),
    ).toThrow("contradicts");
});
