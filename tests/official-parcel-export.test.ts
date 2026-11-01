import { expect, test } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { exportOfficialParcelCandidate } from "../packages/county/src/official-parcel-export.ts";
import { FULL_SOURCE_COLUMNS } from "../packages/county/src/private-full-source.ts";
import { sourceFieldProfileDigest } from "../packages/source-profiles/src/field-authority.ts";
import { sha256 } from "../packages/county/src/model.ts";
import {
  officialProfileFixture,
  source,
  snapshot,
  observedAt,
} from "./official-parcel.fixture.ts";

test("deterministic local candidate retains observed null/absence, counts actual values and excludes restricted/credential fields", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-official-candidate-"));
  const sourceFile = path.join(root, "retained.parquet");
  const instance = await DuckDBInstance.create(":memory:");
  const db = await instance.connect();
  try {
    await db.run(
      `CREATE TABLE raw(${FULL_SOURCE_COLUMNS.map((name) => `${name} VARCHAR`).join(",")})`,
    );
    for (let id = 1; id <= 3; id++) {
      const attributes = {
        OBJECTID_12: id,
        NAME1: null,
        NAME2: null,
        ...(id < 3
          ? { POSTALADDRESS: id === 1 ? "SYNTHETIC OBSERVED MI 00000" : "" }
          : {}),
        RESTRICTED_VALUE: "SYNTHETIC_RESTRICTED_SENTINEL",
        API_KEY: "SYNTHETIC_CREDENTIAL_SENTINEL",
      };
      const json = JSON.stringify(attributes);
      await db.run(
        "INSERT INTO raw VALUES($version,$source,$native,$snapshot,$schema,$json,$digest,$at,$property)",
        {
          version: "county-full-attributes-v1",
          source: "official-oakland-tax-parcel-full-attributes",
          native: String(id),
          snapshot,
          schema: source.sourceSchemaSha256,
          json,
          digest: sha256(json),
          at: observedAt,
          property: "oakland-parcel-" + id,
        },
      );
    }
    await db.run(
      `COPY raw TO '${sourceFile.replaceAll("'", "''")}' (FORMAT PARQUET)`,
    );
  } finally {
    db.closeSync();
    instance.closeSync();
  }
  const config = {
    ...source,
    file: sourceFile,
    sha256: sha256(await readFile(sourceFile)),
  };
  const profile = officialProfileFixture();
  profile.sourceFileSha256 = config.sha256;
  profile.profile.fields.RESTRICTED_VALUE = {
    classification: "restricted_source",
    exposed: true,
    acquisitionAllowed: true,
    runtimeAllowed: true,
    publication: "source_terms_restricted",
  };
  profile.profile.fields.API_KEY = {
    classification: "credential",
    exposed: true,
    acquisitionAllowed: false,
    runtimeAllowed: false,
    publication: "excluded",
  };
  profile.fieldClassificationDigest = sourceFieldProfileDigest(profile.profile);
  const first = await exportOfficialParcelCandidate({
    source: config,
    profile,
    outputDir: path.join(root, "candidate-a"),
  });
  const second = await exportOfficialParcelCandidate({
    source: config,
    profile,
    outputDir: path.join(root, "candidate-b"),
  });
  expect(first.files).toEqual(second.files);
  expect(first.rows).toBe(3);
  expect(first.populatedNameValues).toBe(0);
  expect(first.observedFieldCounts.POSTALADDRESS).toEqual({
    present: 2,
    populatedTrimmedString: 1,
    observedNullOrEmpty: 1,
    notObserved: 1,
  });
  expect(first.fields).not.toContain("RESTRICTED_VALUE");
  expect(first.fields).not.toContain("API_KEY");
  expect(first.uploadAuthorized).toBe(false);
  expect(first.irreversiblePublicIpfsApproval).toContain("PENDING");
  const output = await DuckDBInstance.create(":memory:");
  const reader = await output.connect();
  try {
    const rows = await (
      await reader.runAndReadAll(
        `SELECT * FROM read_parquet('${path.join(root, "candidate-a", "official-parcel-observations.parquet").replaceAll("'", "''")}') ORDER BY native_id`,
      )
    ).getRowObjectsJson();
    const values = rows.map((row) =>
      typeof row.official_fields_json === "string"
        ? JSON.parse(row.official_fields_json)
        : row.official_fields_json,
    );
    expect(values[0]).toMatchObject({
      NAME1: null,
      NAME2: null,
      POSTALADDRESS: "SYNTHETIC OBSERVED MI 00000",
    });
    expect(values[2]).not.toHaveProperty("POSTALADDRESS");
    expect(JSON.stringify(values)).not.toContain(
      "SYNTHETIC_RESTRICTED_SENTINEL",
    );
    expect(JSON.stringify(values)).not.toContain(
      "SYNTHETIC_CREDENTIAL_SENTINEL",
    );
  } finally {
    reader.closeSync();
    output.closeSync();
  }
  await expect(
    exportOfficialParcelCandidate({
      source: config,
      profile,
      outputDir: path.join(root, "candidate-a"),
    }),
  ).rejects.toThrow();
});
