The 12,288-byte `duckdb-v2-empty.seed` is an explicit reproducibility input, not a dataset. Its SHA-256 is `f8e87eed513f1d5b63d01d8838f8c2322006b0cd478f2b66bd4788515693b1b6`. It was generated with the lockfile-pinned `@duckdb/node-api` engine, reporting `v2.0.0`, by creating an empty database, running `CHECKPOINT`, and closing it. It contains zero non-system tables, views or macros. The builder verifies its hash, engine and empty catalog before copying it exclusively into each independent build directory.

DuckDB v2 generates a random database identifier when it creates a new physical database. An explicit empty seed fixes that non-factual identifier without editing any headers or checksums. Every factual table, row, view and query macro is computed anew from verified source inputs in each copy. Single-threaded, uncompressed physical storage was tested to avoid the FSST path; compact ZSTD Parquets are also supplied. The seed fixes the database identifier only. Large current-source builds exposed additional uninitialized string-segment slack even with uncompressed storage, so complete physical database reproducibility is NOT claimed merely from these settings. Deterministic Parquet/SQL/metadata exports and exact hash-bound frozen binary identity must be distinguished from physical database recomputation. Generating a different empty seed is a new declared build input and should produce a different physical database identity.

To inspect this asset with the cached dependency and Node runtime:

```js
import { DuckDBInstance } from "@duckdb/node-api";
const db = await DuckDBInstance.create(
  "packages/publication/assets/duckdb-v2-empty.seed",
  { access_mode: "READ_ONLY", enable_external_access: "false" },
);
const c = await db.connect();
console.log(
  await (
    await c.run(
      "SELECT version() AS version,(SELECT count(*) FROM duckdb_tables() WHERE NOT internal) AS tables,(SELECT count(*) FROM duckdb_views() WHERE NOT internal) AS views,(SELECT count(*) FROM duckdb_functions() WHERE NOT internal AND function_type IN ('macro','table_macro')) AS macros",
    )
  ).getRowObjectsJson(),
);
c.closeSync();
db.closeSync();
```

To generate a new empty input for independent inspection, use the same code with a new non-existing filename, omit `access_mode`, run `CHECKPOINT`, close it and hash it. Do not overwrite this asset while reproducing a published snapshot.

Engine-source basis: https://github.com/duckdb/duckdb/blob/main/src/storage/single_file_block_manager.cpp (`GenerateDBIdentifier`). The uncompressed setting also avoids the compressed-string checkpoint instability described in https://github.com/duckdb/duckdb/issues/23382. The bounded synthetic fixture passes exact bytes; the full real-data physical byte test currently fails. A release must state its actual measured reproducibility scope and must not generalize the fixture result.
