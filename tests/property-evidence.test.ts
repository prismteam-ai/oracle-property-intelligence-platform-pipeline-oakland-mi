import { it, expect } from "vitest";
import { DuckDBInstance } from "@duckdb/node-api";
import {
  loadPropertyEvidence,
  type PropertyEvidence,
} from "../packages/query/src/property-evidence.ts";
import {
  PROPERTY_VIEW_SQL,
  PROPERTY_TABLE_SQL,
} from "../packages/county/src/model.ts";
import { PRIVATE_PERMIT_LIMIT } from "../packages/county/src/private-permits.ts";

it("materializes the exact duplicate/null-preserving public property relation", async () => {
  const instance = await DuckDBInstance.create(":memory:"),
    db = await instance.connect();
  try {
    await db.run(
      "CREATE TABLE parcels(id VARCHAR,source_id VARCHAR,native_id VARCHAR,pin VARCHAR,keypin VARCHAR,revision_date VARCHAR,jurisdiction_code VARCHAR,jurisdiction_name VARCHAR,class_code VARCHAR,address VARCHAR,city VARCHAR,state VARCHAR,postal_code VARCHAR,content_hash VARCHAR,observed_at VARCHAR)",
    );
    await db.run(
      "INSERT INTO parcels VALUES('p1','parcel','1','111',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'h','2026-10-28'),('p1','parcel','1','111',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'h','2026-10-28'),('p2','parcel','2',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'h','2026-10-28')",
    );
    await db.run(
      "CREATE TABLE site_addresses(id VARCHAR,source_id VARCHAR,native_id VARCHAR,pin VARCHAR,address VARCHAR,city VARCHAR,state VARCHAR,postal_code VARCHAR,content_hash VARCHAR,observed_at VARCHAR)",
    );
    await db.run(
      "INSERT INTO site_addresses VALUES('a1','address','1','111',NULL,NULL,NULL,NULL,'h','2026-10-28'),('a2','address','2',NULL,NULL,NULL,NULL,NULL,'h','2026-10-28'),('a3','address','3','222',NULL,NULL,NULL,NULL,'h','2026-10-28')",
    );
    await db.run(
      PROPERTY_VIEW_SQL.replace("VIEW properties", "VIEW expected_properties"),
    );
    await db.run(PROPERTY_TABLE_SQL);
    const rows = await (
      await db.run(
        "SELECT (SELECT count(*) FROM properties) AS n,(SELECT count(*) FROM properties WHERE id='p1') AS duplicates,(SELECT count(*) FROM properties WHERE pin IS NULL) AS null_pins,(SELECT count(*) FROM (SELECT * FROM properties EXCEPT ALL SELECT * FROM expected_properties)) AS extra,(SELECT count(*) FROM (SELECT * FROM expected_properties EXCEPT ALL SELECT * FROM properties)) AS missing",
      )
    ).getRowObjectsJson();
    expect(rows).toEqual([
      { n: "5", duplicates: "2", null_pins: "2", extra: "0", missing: "0" },
    ]);
    expect(
      await (
        await db.run(
          "SELECT table_type FROM information_schema.tables WHERE table_name='properties'",
        )
      ).getRowObjectsJson(),
    ).toEqual([{ table_type: "BASE TABLE" }]);
  } finally {
    db.closeSync();
    instance.closeSync();
  }
});

it("hydrates duplicate IDs, nulls, per-property limits and evidence order in nine bounded reads", async () => {
  const instance = await DuckDBInstance.create(":memory:"),
    db = await instance.connect();
  try {
    for (const sql of [
      "CREATE TABLE site_addresses(id VARCHAR,content_hash VARCHAR,lat DOUBLE)",
      "CREATE TABLE parcel_address_links(property_id VARCHAR,address_id VARCHAR)",
      "CREATE TABLE owner_derivatives(property_id VARCHAR,owner_region VARCHAR)",
      "CREATE TABLE private_reported_owner_observations(property_id VARCHAR,source_id VARCHAR,native_id VARCHAR,canonical_json VARCHAR)",
      "CREATE TABLE private_owner_location_provenance(property_id VARCHAR,canonical_json VARCHAR)",
      "CREATE TABLE protected_enrichment(property_id VARCHAR,source_id VARCHAR,native_id VARCHAR,built_year INTEGER)",
      "CREATE TABLE private_assessment_match(property_id VARCHAR,caveat VARCHAR)",
      "CREATE TABLE permits(property_id VARCHAR,id VARCHAR,canonical_json VARCHAR)",
      "CREATE TABLE private_transfer_observations(property_id VARCHAR,canonical_json VARCHAR)",
    ])
      await db.run(sql);
    await db.run(
      "INSERT INTO site_addresses SELECT 'a'||lpad(CAST(i AS VARCHAR),2,'0'),'h',NULL FROM range(30) t(i)",
    );
    await db.run(
      "INSERT INTO parcel_address_links SELECT 'A',id FROM site_addresses UNION ALL SELECT 'A','a00' UNION ALL SELECT 'B','a29'",
    );
    await db.run(
      "INSERT INTO owner_derivatives VALUES('A',NULL),('B','unknown')",
    );
    await db.run(
      "INSERT INTO private_reported_owner_observations VALUES('A','z','2','{}'),('A','a','1','{}'),('A','a','1','{}')",
    );
    await db.run(
      "INSERT INTO private_owner_location_provenance VALUES('A','null'),('B','{}')",
    );
    await db.run(
      "INSERT INTO protected_enrichment SELECT 'A','source',lpad(CAST(i AS VARCHAR),2,'0'),NULL FROM range(55) t(i)",
    );
    await db.run("INSERT INTO private_assessment_match VALUES('A',NULL)");
    await db.run(
      "INSERT INTO permits VALUES('A','p2',NULL),('A','p1','{}'),('A','p1','{}'),('B','p3','{}')",
    );
    await db.run(
      "INSERT INTO private_transfer_observations VALUES('A','{}'),('A','null')",
    );
    const original = db.run;
    let calls = 0;
    db.run = async function (...args: Parameters<typeof original>) {
      calls++;
      return original.apply(this, args);
    };
    const batch = await loadPropertyEvidence(db, ["A", "A", "B", "empty"]);
    expect(calls).toBe(9);
    expect(batch.size).toBe(3);
    const legacy: [keyof PropertyEvidence, string][] = [
      [
        "addresses",
        "SELECT a.* FROM parcel_address_links l JOIN site_addresses a ON a.id=l.address_id WHERE l.property_id=$id ORDER BY a.id LIMIT25".replace(
          "LIMIT25",
          "LIMIT 25",
        ),
      ],
      [
        "count",
        "SELECT count(*) AS n FROM parcel_address_links WHERE property_id=$id",
      ],
      ["owner", "SELECT * FROM owner_derivatives WHERE property_id=$id"],
      [
        "reportedOwners",
        "SELECT canonical_json FROM private_reported_owner_observations WHERE property_id=$id ORDER BY source_id,native_id",
      ],
      [
        "locationProvenance",
        "SELECT canonical_json FROM private_owner_location_provenance WHERE property_id=$id",
      ],
      [
        "enrichment",
        "SELECT * FROM protected_enrichment WHERE property_id=$id ORDER BY source_id,native_id LIMIT50".replace(
          "LIMIT50",
          "LIMIT 50",
        ),
      ],
      [
        "assessmentCaveats",
        "SELECT caveat FROM private_assessment_match WHERE property_id=$id",
      ],
      [
        "permits",
        `SELECT * FROM permits WHERE property_id=$id ORDER BY id LIMIT ${PRIVATE_PERMIT_LIMIT}`,
      ],
      [
        "deedObservations",
        "SELECT canonical_json FROM private_transfer_observations WHERE property_id=$id",
      ],
    ];
    for (const id of ["A", "B", "empty"])
      for (const [field, sql] of legacy) {
        const expected = await (
          await original.call(db, sql, { id })
        ).getRowObjectsJson();
        const evidence = batch.get(id)!;
        const actual = evidence[field].map(
          ({ __property_id: _group, ...row }) => row,
        );
        expect(actual).toEqual(expected);
      }
    expect(batch.get("A")!.addresses).toHaveLength(25);
    expect(batch.get("A")!.count[0]!.n).toBe("31");
    expect(batch.get("A")!.enrichment).toHaveLength(50);
    expect(batch.get("A")!.reportedOwners).toHaveLength(3);
    calls = 0;
    expect(await loadPropertyEvidence(db, [])).toEqual(new Map());
    expect(calls).toBe(0);
    await expect(
      loadPropertyEvidence(
        db,
        Array.from({ length: 201 }, (_, i) => String(i)),
      ),
    ).rejects.toThrow("bound");
    await expect(loadPropertyEvidence(db, ["x".repeat(201)])).rejects.toThrow(
      "bound",
    );
    expect(calls).toBe(0);
  } finally {
    db.closeSync();
    instance.closeSync();
  }
});
