/** Freeze a verified public-only DB, then prove two exact wraps of its bytes. */
import { chmod, link, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256, stableJson } from "../../county/src/model.ts";
import { CURRENT_PUBLIC_PROFILE } from "./current-public-snapshot.ts";
import {
  packCurrentPublicDirectory,
  publicFileDigest,
  type CurrentPublicFile,
} from "./current-public-car.ts";
import { PUBLIC_DATABASE_RELATIONS } from "./current-public-database.ts";
import type { rebuildCurrentPublicDatabaseIsolated } from "./current-public-isolation.ts";
type CanonicalProof = Awaited<
  ReturnType<typeof rebuildCurrentPublicDatabaseIsolated>
>;
type SourceManifest = {
  version: string;
  contractVersion: string;
  baseWorkingProjection: unknown;
  counts: Record<string, number>;
  run: unknown;
  priorPublications: unknown[];
  files: CurrentPublicFile[];
};
export interface CurrentPublicFinalizeOptions {
  sourceDirectory: string;
  canonicalDatabaseFile: string;
  canonicalProofFile: string;
  publicInputIndexFile: string;
  outputDirectory: string;
  recipe: {
    sourceCommit: string;
    sourceTree: string;
    sourceFilesSha256: Record<string, string>;
    publicInputFreezeSha256: string;
  };
}
async function immutableLink(source: string, target: string) {
  await chmod(source, 0o444);
  await link(source, target);
}
async function json(directory: string, name: string, value: unknown) {
  await writeFile(path.join(directory, name), stableJson(value) + "\n", {
    flag: "wx",
    mode: 0o444,
  });
}
export async function finalizeCurrentPublicSnapshot(
  options: CurrentPublicFinalizeOptions,
) {
  if (
    !/^[a-f0-9]{40}$/.test(options.recipe.sourceCommit) ||
    !/^[a-f0-9]{40}$/.test(options.recipe.sourceTree) ||
    !/^[a-f0-9]{64}$/.test(options.recipe.publicInputFreezeSha256) ||
    Object.entries(options.recipe.sourceFilesSha256).some(
      ([name, digest]) =>
        !/^[a-zA-Z0-9_./-]+$/.test(name) ||
        name.includes("..") ||
        !/^[a-f0-9]{64}$/.test(digest),
    )
  )
    throw new Error("Exact frozen source recipe required");
  const source = JSON.parse(
    await readFile(
      path.join(options.sourceDirectory, "publication-manifest.json"),
      "utf8",
    ),
  ) as SourceManifest;
  if (
    source.version !== CURRENT_PUBLIC_PROFILE ||
    !Array.isArray(source.files) ||
    source.files.length > 64 ||
    new Set(source.files.map((file) => file.name)).size !==
      source.files.length ||
    source.files.some((file) => !/^[a-z0-9][a-z0-9.-]+$/.test(file.name))
  )
    throw new Error("Verified source publication input required");
  const proof = JSON.parse(
    await readFile(options.canonicalProofFile, "utf8"),
  ) as CanonicalProof;
  const database = await publicFileDigest(options.canonicalDatabaseFile);
  if (
    proof.isolation?.directNetworkDenied !== "ENETUNREACH" ||
    proof.originalPrivateInputsMounted !== false ||
    proof.hostAndWorkerNetworkNamespacesDiffer !== true ||
    proof.physicalDatabaseRecomputeDeterminismClaimed !== false ||
    database.sha256 !== proof.database.sha256 ||
    database.bytes !== proof.database.bytes
  )
    throw new Error("Successful isolated canonical database proof required");
  const inputIndex = await readFile(options.publicInputIndexFile);
  if (sha256(inputIndex) !== proof.sourceIndexSha256)
    throw new Error("Frozen public input index differs from canonical build");
  for (const relation of PUBLIC_DATABASE_RELATIONS) {
    const name = relation.replaceAll("_", "-") + ".parquet";
    const expected = source.files.find((file) => file.name === name);
    const actual = proof.logicalRelationParity.filter(
      (file) => file.name === name,
    );
    if (
      !expected ||
      actual.length !== 1 ||
      actual[0]!.sha256 !== expected.sha256 ||
      actual[0]!.bytes !== expected.bytes ||
      Number(actual[0]!.rows) !== source.counts[relation]
    )
      throw new Error("Canonical full relation parity required: " + relation);
  }
  const sourceFiles = source.files.filter(
    (file) =>
      !["artifact-index.json", "oakland-public.duckdb"].includes(file.name),
  );
  for (const file of sourceFiles) {
    const actual = await publicFileDigest(
      path.join(options.sourceDirectory, file.name),
    );
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256)
      throw new Error("Frozen source payload changed");
  }
  await mkdir(options.outputDirectory, { mode: 0o700 });
  const first = path.join(options.outputDirectory, "wrap-a"),
    second = path.join(options.outputDirectory, "wrap-b"),
    upload = path.join(options.outputDirectory, "upload");
  await mkdir(first);
  await mkdir(second);
  await mkdir(upload);
  for (const file of sourceFiles)
    if (file.name !== "schema.json")
      await immutableLink(
        path.join(options.sourceDirectory, file.name),
        path.join(first, file.name),
      );
  await immutableLink(
    options.canonicalDatabaseFile,
    path.join(first, "oakland-public.duckdb"),
  );
  const schema = JSON.parse(
    await readFile(path.join(options.sourceDirectory, "schema.json"), "utf8"),
  );
  schema.reproducibility = {
    ...schema.reproducibility,
    mode: "immutable_hash_bound_canonical_database_and_logical_source_parity",
    physicalDatabaseRecomputeDeterminism: false,
    canonicalDatabaseSha256: database.sha256,
    fullCatalogSha256: proof.fullCatalogSha256,
    publicInputIndexSha256: proof.sourceIndexSha256,
    qualification:
      "The first successful public-only OS-isolated DB is frozen and never rewritten. All tables/rows/columns are verified against source-derived public Parquets. Re-encoding this DuckDB engine can vary unused string-buffer bytes; no physical-recompute equality is claimed. Exact wrapping uses the same frozen binary bytes.",
  };
  await json(first, "schema.json", schema);
  await writeFile(
    path.join(first, "public-build-input-index.json"),
    inputIndex,
    { flag: "wx", mode: 0o444 },
  );
  const publicProof = {
    version: proof.version,
    database: proof.database,
    sourceIndexSha256: proof.sourceIndexSha256,
    seedSha256: proof.seedSha256,
    physicalDatabaseRecomputeDeterminismClaimed: false,
    cleanEnvironmentKeys: proof.cleanEnvironmentKeys,
    isolation: proof.isolation,
    isolationMechanism: proof.isolationMechanism,
    originalPrivateInputsMounted: false,
    mountedPublicInputNames: proof.mountedPublicInputNames,
    hostAndWorkerNetworkNamespacesDiffer: true,
    logicalRelationParity: proof.logicalRelationParity,
    fullCatalog: proof.fullCatalog,
    fullCatalogSha256: proof.fullCatalogSha256,
    coreQueriesRequireExternalFiles: false,
    sourceNetworkRequests: 0,
    publicationEffects: 0,
  };
  await json(first, "canonical-database-proof.json", publicProof);
  await json(first, "source-recipe.json", {
    version: CURRENT_PUBLIC_PROFILE,
    ...options.recipe,
    physicalDatabaseRecomputeDeterminism: false,
    publicInputsAreSourceDerivedParquets: true,
  });
  const names = [
    ...sourceFiles.map((file) => file.name),
    "oakland-public.duckdb",
    "public-build-input-index.json",
    "canonical-database-proof.json",
    "source-recipe.json",
  ].sort();
  const artifacts = [];
  for (const name of names)
    artifacts.push({
      name,
      ...(await publicFileDigest(path.join(first, name))),
    });
  const digest = sha256(stableJson(artifacts));
  const wrapA = await packCurrentPublicDirectory(first, names);
  for (const name of names)
    await immutableLink(path.join(first, name), path.join(second, name));
  const wrapB = await packCurrentPublicDirectory(second, names);
  if (
    wrapA.rootCid !== wrapB.rootCid ||
    wrapA.car.sha256 !== wrapB.car.sha256 ||
    stableJson(wrapA.files) !== stableJson(wrapB.files)
  )
    throw new Error("Exact frozen-byte directory/CAR wrapping differs");
  for (const file of wrapA.files)
    await immutableLink(
      path.join(first, file.name),
      path.join(upload, file.name),
    );
  const payloadBytes = wrapA.files.reduce((sum, file) => sum + file.bytes, 0);
  const publication = {
    version: CURRENT_PUBLIC_PROFILE,
    state: "CANONICAL_FROZEN_AND_TWO_WRAPS_VERIFIED_NOT_YET_PUBLISHED",
    contractVersion: source.contractVersion,
    snapshotId: "oakland-public-" + digest.slice(0, 20),
    datasetDigest: digest,
    baseWorkingProjection: source.baseWorkingProjection,
    run: source.run,
    priorPublications: source.priorPublications,
    counts: source.counts,
    ...wrapA,
    publicationEffects: 0,
    providerRestrictedRowsIncluded: false,
    publicManifestOutsideOwnDag: true,
    carAvailability:
      "Exact CAR is a separate public asset outside its own DAG.",
    verification: {
      canonicalDatabaseFrozen: true,
      physicalDatabaseRecomputeDeterminism: false,
      allPublicDatabaseRelationsVerified: true,
      independentOperatorRetrieval: "PENDING_PUBLICATION",
      twoFrozenByteWraps: {
        rootCidA: wrapA.rootCid,
        rootCidB: wrapB.rootCid,
        carSha256A: wrapA.car.sha256,
        carSha256B: wrapB.car.sha256,
        pass: true,
      },
    },
    payloadBytes,
  };
  await json(options.outputDirectory, "publication-manifest.json", publication);
  return {
    publication,
    localPaths: {
      uploadDirectory: upload,
      carFile: path.join(first, "snapshot.car"),
      secondCarFile: path.join(second, "snapshot.car"),
      manifestFile: path.join(
        options.outputDirectory,
        "publication-manifest.json",
      ),
      canonicalDatabase: options.canonicalDatabaseFile,
    },
    canonicalDatabaseUnchanged:
      (await publicFileDigest(options.canonicalDatabaseFile)).sha256 ===
      database.sha256,
  };
}
