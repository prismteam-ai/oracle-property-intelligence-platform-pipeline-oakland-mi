import { test, expect } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildCurrentPublicSnapshot } from "../packages/publication/src/current-public-snapshot.ts";
import { verifyCurrentPublicCar } from "../packages/publication/src/current-public-car.ts";
import {
  fetchCurrentPublicDatabase,
  queryCurrentPublicDatabase,
} from "../packages/publication/src/current-public-consumer.ts";
import { loadRealSnapshot } from "../packages/query/src/real-loader.ts";
import { sha256 } from "../packages/county/src/model.ts";
import { currentPublicFixture } from "./current-public.fixture.ts";

test("synthetic current-public fixture is byte-identical, self-contained, source-qualified and tamper-evident", async () => {
  const fixture = await currentPublicFixture();
  const firstDirectory = path.join(fixture.root, "first");
  const first = await buildCurrentPublicSnapshot({
    ...fixture.options,
    outputDirectory: firstDirectory,
  });
  const second = await buildCurrentPublicSnapshot({
    ...fixture.options,
    outputDirectory: path.join(fixture.root, "second"),
  });
  expect(first.rootCid).toBe(second.rootCid);
  expect(first.files).toEqual(second.files);
  expect(first.car.sha256).toBe(second.car.sha256);
  expect(first.counts.properties).toBe(2);
  expect(first.counts.permits).toBe(1);
  const result = await queryCurrentPublicDatabase(firstDirectory);
  const roof = result.results.noviRoofs as { rows: { matches: string }[] };
  expect(Number(roof.rows[0]!.matches)).toBe(1);
  expect(result.oracleApiRequired).toBe(false);
  expect(result.sourceNetworkRequiredDuringQueries).toBe(false);
  const schema = JSON.parse(
    await readFile(path.join(firstDirectory, "schema.json"), "utf8"),
  );
  expect(
    schema.tables.some((name: string) =>
      /provider|session|lead|quota/.test(name),
    ),
  ).toBe(false);
  const original = await readFile(path.join(firstDirectory, "snapshot.car"));
  const corrupt = Buffer.from(original);
  corrupt[corrupt.length - 8] ^= 1;
  await writeFile(path.join(fixture.root, "corrupt.car"), corrupt);
  await expect(
    verifyCurrentPublicCar(
      path.join(fixture.root, "corrupt.car"),
      first.rootCid,
      first.files,
    ),
  ).rejects.toThrow();
});

test("provider inputs and unapproved source IDs fail before a public export can pass", async () => {
  const fixture = await currentPublicFixture();
  await expect(
    buildCurrentPublicSnapshot({
      ...fixture.options,
      outputDirectory: path.join(fixture.root, "provider"),
      snapshotOptions: {
        ...fixture.options.snapshotOptions,
        protectedProviderObservationsFile: "PROVIDER_SENTINEL_MUST_NOT_BE_READ",
      },
    }),
  ).rejects.toThrow("Restricted provider");
  await expect(
    buildCurrentPublicSnapshot({
      ...fixture.options,
      outputDirectory: path.join(fixture.root, "missing-policy"),
      sourcePolicies: fixture.options.sourcePolicies.filter(
        (policy) => policy.sourceId !== "official-novi-residential-sales-pdf",
      ),
    }),
  ).rejects.toThrow("unapproved source");
});

test("trusted projection hook runs before sealing; runtime stays locked and failed hooks return no connection", async () => {
  const fixture = await currentPublicFixture();
  let called = 0;
  const loaded = await loadRealSnapshot(
    fixture.base,
    {},
    (
      _manifest,
      connection,
      instance,
      _coverage,
      _runs,
      _owner,
      _digests,
      _permits,
      _counts,
      _intake,
      _full,
      _audit,
      temporaryDirectory,
    ) => ({ connection, instance, temporaryDirectory }),
    async (connection) => {
      called++;
      await connection.run("SET threads=1");
    },
  );
  expect(called).toBe(1);
  try {
    expect(
      (
        await (
          await loaded.connection.run(
            "SELECT current_setting('enable_external_access') AS value",
          )
        ).getRowObjectsJson()
      )[0]!.value,
    ).toBe(false);
    await expect(
      loaded.connection.run("SET enable_external_access=true"),
    ).rejects.toThrow();
  } finally {
    loaded.connection.closeSync();
    loaded.instance.closeSync();
  }
  const ordinary = await loadRealSnapshot(
    fixture.base,
    {},
    (_manifest, connection, instance) => ({ connection, instance }),
  );
  try {
    expect(
      (
        await (
          await ordinary.connection.run(
            "SELECT current_setting('enable_external_access') AS value,current_setting('memory_limit') AS memory",
          )
        ).getRowObjectsJson()
      )[0],
    ).toEqual({ value: false, memory: "976.5 MiB" });
    await expect(
      ordinary.connection.run("SET enable_external_access=true"),
    ).rejects.toThrow();
    expect(called).toBe(1);
  } finally {
    ordinary.connection.closeSync();
    ordinary.instance.closeSync();
  }
  let failed: DuckDBConnection | undefined;
  await expect(
    loadRealSnapshot(
      fixture.base,
      {},
      () => {
        throw new Error("must not construct");
      },
      async (connection) => {
        failed = connection;
        throw new Error("projection failed");
      },
    ),
  ).rejects.toThrow("projection failed");
  await expect(failed!.run("SELECT 1")).rejects.toThrow();
});

test("clean consumer verifies pinned public bytes and makes only two unauthenticated requests", async () => {
  const fixture = await currentPublicFixture();
  const directory = path.join(fixture.root, "candidate");
  await buildCurrentPublicSnapshot({
    ...fixture.options,
    outputDirectory: directory,
  });
  const index = await readFile(path.join(directory, "artifact-index.json"));
  const database = await readFile(
    path.join(directory, "oakland-public.duckdb"),
  );
  const seen: { url: string; headers: unknown }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    seen.push({ url, headers: init?.headers });
    return new Response(url.endsWith("artifact-index.json") ? index : database);
  };
  const clean = path.join(fixture.root, "clean-consumer");
  await fetchCurrentPublicDatabase({
    indexUrl: "https://example.invalid/ipfs/synthetic-root/artifact-index.json",
    indexSha256: sha256(index),
    outputDirectory: clean,
    fetchImpl,
  });
  expect(seen).toHaveLength(2);
  expect(seen.every((request) => request.headers === undefined)).toBe(true);
  expect((await queryCurrentPublicDatabase(clean)).readOnly).toBe(true);
  await expect(
    fetchCurrentPublicDatabase({
      indexUrl:
        "https://example.invalid/ipfs/synthetic-root/artifact-index.json",
      indexSha256: "0".repeat(64),
      outputDirectory: path.join(fixture.root, "bad-index"),
      fetchImpl,
    }),
  ).rejects.toThrow("index digest");
});

test("consumer bounds an untrusted index and removes its own failed partial download", async () => {
  const fixture = await currentPublicFixture();
  const directory = path.join(fixture.root, "candidate");
  await buildCurrentPublicSnapshot({
    ...fixture.options,
    outputDirectory: directory,
  });
  const index = await readFile(path.join(directory, "artifact-index.json"));
  const badDatabase = Buffer.from(
    await readFile(path.join(directory, "oakland-public.duckdb")),
  );
  badDatabase[badDatabase.length - 1] ^= 1;
  const target = path.join(fixture.root, "bad-database");
  const corruptFetch: typeof fetch = async (input) =>
    new Response(
      String(input).endsWith("artifact-index.json") ? index : badDatabase,
    );
  await expect(
    fetchCurrentPublicDatabase({
      indexUrl:
        "https://example.invalid/ipfs/synthetic-root/artifact-index.json",
      indexSha256: sha256(index),
      outputDirectory: target,
      fetchImpl: corruptFetch,
    }),
  ).rejects.toThrow("database digest/size");
  await expect(
    readFile(path.join(target, "oakland-public.duckdb")),
  ).rejects.toThrow();
  const huge = Buffer.alloc(1024 ** 2 + 1, 65);
  await expect(
    fetchCurrentPublicDatabase({
      indexUrl:
        "https://example.invalid/ipfs/synthetic-root/artifact-index.json",
      indexSha256: sha256(huge),
      outputDirectory: path.join(fixture.root, "huge-index"),
      fetchImpl: async () => new Response(huge),
    }),
  ).rejects.toThrow("index exceeds byte bound");
});

test("standalone clean worker reads public Parquets only and verifies every logical relation", async () => {
  const fixture = await currentPublicFixture();
  const directory = path.join(fixture.root, "public");
  await buildCurrentPublicSnapshot({
    ...fixture.options,
    outputDirectory: directory,
  });
  const index = await readFile(path.join(directory, "artifact-index.json"));
  const output = path.join(fixture.root, "clean-worker");
  const result = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/rebuild-current-public-database.ts",
      "--execute",
      "--directory",
      directory,
      "--index-sha256",
      sha256(index),
      "--output-directory",
      output,
    ],
    {
      cwd: process.cwd(),
      env: {
        PATH: "/usr/bin:/bin",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        TZ: "UTC",
        TMPDIR: fixture.root,
        MALLOC_PERTURB_: "165",
      },
      maxBuffer: 1024 ** 2,
    },
  );
  const report = JSON.parse(result.stdout);
  expect(report.physicalDatabaseRecomputeDeterminismClaimed).toBe(false);
  expect(report.logicalRelationParity).toHaveLength(14);
  expect(report.cleanEnvironmentKeys).toEqual([
    "LANG",
    "LC_ALL",
    "MALLOC_PERTURB_",
    "PATH",
    "TMPDIR",
    "TZ",
  ]);
  expect(report.publicationEffects).toBe(0);
});
