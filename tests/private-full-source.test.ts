import { it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import {
  FULL_SOURCE_COLUMNS,
  parseFullSourceConfigs,
} from "../packages/county/src/private-full-source.ts";
import { sha256 } from "../packages/county/src/model.ts";
it("validates finite source-proof configuration without accepting an unapproved source role", () => {
  const config = {
    role: "county-parcels",
    file: "/private/county-parcels.parquet",
    sha256: "a".repeat(64),
    sourceSchemaSha256: "b".repeat(64),
    sourceRecordCount: 490775,
    sourceValidationSha256: "c".repeat(64),
    sourceValidatedOffline: true,
  };
  expect(parseFullSourceConfigs([config])).toHaveLength(1);
  for (const values of [
    [{ ...config, sourceValidatedOffline: false }],
    [{ ...config, sourceSchemaSha256: "invalid" }],
    [{ ...config, sourceRecordCount: 1200001 }],
    [config, config],
    [{ ...config, role: "novi-footprints" }],
  ])
    expect(() => parseFullSourceConfigs(values)).toThrow("rejected");
});
it("full-source parquet exposes the agreed nine typed columns without evaluating source JSON", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-full-source-schema-")),
    file = path.join(root, "source.parquet"),
    instance = await DuckDBInstance.create(":memory:"),
    db = await instance.connect();
  try {
    await db.run(
      "CREATE TABLE full_source(" +
        FULL_SOURCE_COLUMNS.map((k) => k + " VARCHAR").join(",") +
        ")",
    );
    await db.run(
      `COPY full_source TO '${file.replaceAll("'", "''")}' (FORMAT PARQUET)`,
    );
    expect(sha256(await readFile(file))).toMatch(/^[a-f0-9]{64}$/);
    const schema = await (
      await db.run(
        `DESCRIBE SELECT * FROM read_parquet('${file.replaceAll("'", "''")}')`,
      )
    ).getRowObjectsJson();
    expect(schema.map((x) => x.column_name)).toEqual([...FULL_SOURCE_COLUMNS]);
    expect(schema.every((x) => x.column_type === "VARCHAR")).toBe(true);
  } finally {
    db.closeSync();
    instance.closeSync();
    await rm(root, { recursive: true, force: true });
  }
});
