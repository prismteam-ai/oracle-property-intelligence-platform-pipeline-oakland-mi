import { expect, test } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  buildCountySnapshot,
  type ArtifactManifest,
} from "../packages/county/src/build.ts";
import {
  PUBLIC_PARCEL_FIELDS,
  PUBLIC_ADDRESS_FIELDS,
  sha256,
  type SourceLayer,
} from "../packages/county/src/model.ts";
import {
  rehearsePublication,
  verifiedPreviousPublication,
} from "../packages/publication/src/local.ts";
import {
  PublicRunHistorySchema,
  appendPublicRun,
  reconcilePublicRecords,
} from "../packages/publication/src/run-history.ts";
const execute = promisify(execFile),
  baseURL =
    "https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/";
const json = async (p: string, v: unknown) =>
  writeFile(p, JSON.stringify(v, null, 2) + "\n");
async function observation(
  root: string,
  n: number,
  ids: number[],
  changed: boolean,
) {
  const dir = path.join(root, "source-" + n);
  await mkdir(dir);
  const startedAt = `2026-01-${String(n).padStart(2, "0")}T00:00:00.000Z`,
    completedAt = startedAt.replace("00:00:00", "00:10:00");
  const layers = {} as Record<
    "tax_parcel" | "site_address",
    SourceLayer & { censusSha256: string; finalCensusSha256: string }
  >;
  let bytes = 0;
  for (const key of ["tax_parcel", "site_address"] as const) {
    const parcel = key === "tax_parcel",
      oid = parcel ? "OBJECTID_12" : "OBJECTID",
      fields = parcel ? PUBLIC_PARCEL_FIELDS : PUBLIC_ADDRESS_FIELDS;
    const features = ids.map((i) => ({
      attributes: parcel
        ? {
            OBJECTID_12: i,
            OBJECTID: i,
            KEYPIN: "SYNTHETIC-" + i,
            PIN: "SYNTHETIC-" + i,
            REVISIONDATE: 1767225600000,
            CVTTAXCODE: "SYNTHETIC",
            CVTTAXDESCRIPTION: "Synthetic fixture jurisdiction",
            CLASSCODE: "unknown",
            SITEADDRESS:
              changed && i === 2
                ? "Synthetic changed site"
                : "Synthetic site " + i,
            SITECITY: "Synthetic town",
            SITESTATE: "MI",
            SITEZIP5: "00000",
          }
        : {
            OBJECTID: i,
            TYPE: "SYNTHETIC",
            PIN: "SYNTHETIC-" + i,
            SITESTREETADDRESS:
              changed && i === 2
                ? "Synthetic changed site"
                : "Synthetic site " + i,
            SITECITY: "Synthetic town",
            SITESTATE: "MI",
            SITEZIPCODE: "00000",
          },
      ...(parcel ? {} : { geometry: { x: -83.2 - i / 1000, y: 42.6 } }),
    }));
    const body = JSON.stringify({ features }),
      file = path.join(dir, key + ".json"),
      census = path.join(dir, key + "-ids.json");
    await writeFile(file, body, { mode: 0o600 });
    await json(census, { objectIds: ids });
    const censusHash = sha256(await readFile(census));
    bytes += Buffer.byteLength(body);
    layers[key] = {
      source: baseURL + (parcel ? "1" : "0"),
      oidField: oid,
      fields: [...fields],
      publicFields: [...fields],
      privateFields: [],
      count: ids.length,
      complete: true,
      objectIdsPath: census,
      pages: [
        {
          path: file,
          sha256: sha256(body),
          observedAt: startedAt,
          index: 0,
          records: ids.length,
        },
      ],
      schemaDigest: sha256("synthetic public field schema"),
      censusSha256: censusHash,
      finalCensusSha256: censusHash,
    };
  }
  return { dir, layers, startedAt, completedAt, bytes };
}
async function baseline(root: string) {
  const obs = await observation(root, 1, [1, 2, 3], false),
    out = path.join(root, "run-01"),
    privateOut = path.join(root, "private-01"),
    source = path.join(obs.dir, "source.json");
  await json(source, {
    version: "synthetic-regression-only",
    layers: { parcel: obs.layers.tax_parcel, address: obs.layers.site_address },
    termsDigest: sha256("synthetic terms"),
    fieldClassificationDigest: sha256("synthetic classification"),
    runs: [
      {
        id: "run-01",
        kind: "full-baseline",
        complete: true,
        startedAt: obs.startedAt,
        completedAt: obs.completedAt,
        layers: Object.fromEntries(
          [
            ["parcel", obs.layers.tax_parcel],
            ["address", obs.layers.site_address],
          ].map(([k, l]) => [
            k,
            {
              source: (l as SourceLayer).source,
              count: 3,
              received: 3,
              complete: true,
            },
          ]),
        ),
      },
    ],
  });
  await buildCountySnapshot({
    sourceManifest: source,
    outputDir: out,
    privateOutputDir: privateOut,
  });
  await rehearsePublication(out);
  return out;
}
async function buildRun(root: string, n: number, previous: string) {
  const obs = await observation(root, n, [2, 3, 4], true),
    prior = await verifiedPreviousPublication(previous),
    runId = "run-" + String(n).padStart(2, "0"),
    output = path.join(root, runId),
    evidence = path.join(root, "evidence-" + n),
    privateOut = path.join(root, "private-" + n);
  const plan = path.join(obs.dir, "plan.json"),
    state = path.join(obs.dir, "state.json");
  await json(plan, {
    version: "synthetic-complete-cli-regression-only",
    runId,
    complete: true,
    requestCap: 600,
    startedAt: obs.startedAt,
    completedAt: obs.completedAt,
    baselineArtifactManifestSha256: prior.artifactManifestSha256,
    baselineDatasetDigest: prior.manifest.digest,
    baselineSnapshotId: prior.manifest.snapshotId,
    priorRootCid: prior.rootCid,
    fieldClassificationDigest: sha256("synthetic classification"),
    termsDigest: sha256("synthetic terms"),
    layers: obs.layers,
    rights: {
      tax_parcel: {
        sameAcceptedLicense: true,
        publicAccess: true,
        licenseInfoSha256: sha256("synthetic license"),
      },
      site_address: {
        sameAcceptedLicense: true,
        publicAccess: true,
        licenseInfoSha256: sha256("synthetic license"),
      },
    },
  });
  await json(state, {
    cap: 600,
    byteCap: 1024 ** 3,
    responseBytesKnown: obs.bytes,
    unknownFailureMaxBytes: 0,
    events: ["tax_parcel", "site_address"].map((key, i) => ({
      sequence: i + 1,
      state: "complete",
      status: 200,
      purpose: key + " synthetic page",
      requestUrlSha256: sha256(key),
    })),
  });
  const args = [
    "--import",
    "tsx",
    fileURLToPath(new URL("../scripts/build-county-run.ts", import.meta.url)),
    "--plan",
    plan,
    "--request-state",
    state,
    "--baseline",
    previous,
    "--out",
    output,
    "--private-out",
    privateOut,
    "--evidence",
    evidence,
  ];
  const invoke = () =>
    execute(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, AWS_EC2_METADATA_DISABLED: "true" },
      maxBuffer: 1024 ** 2,
    });
  await invoke();
  return {
    output,
    previous,
    privateOut,
    invoke,
    args,
    proof: JSON.parse(
      await readFile(
        path.join(evidence, runId + "-reconciliation-and-car-proof.json"),
        "utf8",
      ),
    ) as {
      factDelta: {
        added: number;
        changed: number;
        deleted: number;
        unchanged: number;
      };
      priorHistoryRowsPreserved: boolean;
    },
  };
}
test("complete CLI builds arbitrary runs1,2,3,4,10 with changed/deleted/no-change facts, exact retries and immutable CID lineage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "prism-n-run-pipeline-"));
  let previous = await baseline(root);
  const original = await verifiedPreviousPublication(previous),
    roots = [original.rootCid];
  let latest: Awaited<ReturnType<typeof buildRun>> | undefined;
  for (const n of [2, 3, 4, 10]) {
    latest = await buildRun(root, n, previous);
    const verified = await verifiedPreviousPublication(latest.output);
    roots.push(verified.rootCid);
    expect(verified.history.map((r) => r.id)).toEqual(
      [1, 2, 3, 4, 10]
        .filter((i) => i <= n)
        .map((i) => "run-" + String(i).padStart(2, "0")),
    );
    expect(verified.catalog.map((c) => c.rootCid)).toEqual(roots);
    expect(latest.proof.priorHistoryRowsPreserved).toBe(true);
    if (n === 2) {
      expect(latest.proof.factDelta).toEqual({
        added: 2,
        changed: 2,
        deleted: 2,
        unchanged: 2,
      });
      const tombstones = JSON.parse(
        await readFile(
          path.join(latest.privateOut, "source-tombstones.json"),
          "utf8",
        ),
      );
      expect(tombstones.layers).toEqual({
        tax_parcel: ["1"],
        site_address: ["1"],
      });
    } else
      expect(latest.proof.factDelta).toEqual({
        added: 0,
        changed: 0,
        deleted: 0,
        unchanged: 6,
      });
    const before = await readFile(path.join(latest.output, "snapshot.car")),
      pubBefore = await readFile(
        path.join(latest.output, "publication-manifest.json"),
      );
    const replay = JSON.parse((await latest.invoke()).stdout);
    expect(replay.idempotentReplay).toBe(true);
    expect(await readFile(path.join(latest.output, "snapshot.car"))).toEqual(
      before,
    );
    expect(
      await readFile(path.join(latest.output, "publication-manifest.json")),
    ).toEqual(pubBefore);
    previous = latest.output;
  }
  const result = await verifiedPreviousPublication(latest!.output),
    history = result.history;
  expect(appendPublicRun(history, history.at(-1))).toEqual(history);
  const conflict = structuredClone(history.at(-1)!);
  conflict.completedAt = conflict.at = "2026-01-10T00:11:00.000Z";
  expect(() => appendPublicRun(history, conflict)).toThrow(/Immutable run ID/);
  for (const mutate of [
    (h: typeof history) => h.push(structuredClone(h[0]!)),
    (h: typeof history) => {
      [h[2], h[3]] = [h[3]!, h[2]!];
    },
    (h: typeof history) => {
      h.at(-1)!.id = "run-0004";
    },
    (h: typeof history) => {
      (h[0] as unknown as Record<string, unknown>).privateMetadata = {
        owner: "SYNTHETIC_PRIVATE_CANARY",
      };
    },
  ]) {
    const changed = structuredClone(history);
    mutate(changed);
    expect(() => PublicRunHistorySchema.parse(changed)).toThrow();
  }
  const opaque = structuredClone(history.at(-1)!);
  opaque.id = "refresh-2026-01-11-a";
  opaque.startedAt = "2026-01-11T00:00:00.000Z";
  opaque.completedAt = opaque.at = "2026-01-11T00:10:00.000Z";
  if ("version" in opaque) {
    opaque.previousRunId = history.at(-1)!.id;
    opaque.priorDatasetSnapshotId = history.at(-1)!.snapshotId;
    opaque.priorDatasetDigest = history.at(-1)!.digest;
  }
  expect(appendPublicRun(history, opaque).at(-1)?.id).toBe(
    "refresh-2026-01-11-a",
  );
  const partial = path.join(root, "incomplete-output");
  await mkdir(partial);
  await writeFile(path.join(partial, "sentinel"), "do not overwrite");
  const partialArgs = [...latest!.args];
  partialArgs[partialArgs.indexOf("--out") + 1] = partial;
  await expect(
    execute(process.execPath, partialArgs, {
      cwd: process.cwd(),
      maxBuffer: 1024 ** 2,
    }),
  ).rejects.toThrow();
  expect(await readFile(path.join(partial, "sentinel"), "utf8")).toBe(
    "do not overwrite",
  );
  await expect(
    readFile(path.join(partial, "artifact-manifest.json")),
  ).rejects.toThrow();
  const current = latest!.output,
    files = ["runs.json", "run-manifest.json", "artifact-manifest.json"],
    saved = await Promise.all(
      files.map((f) => readFile(path.join(current, f))),
    );
  async function rejectRehashed(
    mutate: (runs: unknown[], run: Record<string, unknown>) => void,
  ) {
    const runs = JSON.parse(saved[0]!.toString()),
      run = JSON.parse(saved[1]!.toString()),
      artifact = JSON.parse(saved[2]!.toString()) as ArtifactManifest;
    mutate(runs, run);
    await json(path.join(current, "runs.json"), runs);
    const bytes = await readFile(path.join(current, "runs.json"));
    run.runsSha256 = sha256(bytes);
    artifact.files = artifact.files.map((f) =>
      f.name === "runs.json"
        ? { ...f, bytes: bytes.length, sha256: sha256(bytes) }
        : f,
    );
    await json(path.join(current, "run-manifest.json"), run);
    await json(path.join(current, "artifact-manifest.json"), artifact);
    await expect(
      rehearsePublication(current, {
        profile: "run-history-v3",
        previousPublicationDirectory: latest!.previous,
      }),
    ).rejects.toThrow();
    await Promise.all(
      files.map((f, i) => writeFile(path.join(current, f), saved[i]!)),
    );
  }
  await rejectRehashed((runs) => {
    (runs[0] as Record<string, unknown>).privateMetadata = {
      contact: "SYNTHETIC_PRIVATE_CANARY",
    };
  });
  await rejectRehashed((_runs, run) => {
    (run.predecessors as { rootCid: string }[])[0]!.rootCid = roots.at(-2)!;
  });
  await rejectRehashed((_runs, run) => {
    run.previousArtifactManifestSha256 = "f".repeat(64);
  });
  await rejectRehashed((_runs, run) => {
    run.schemaOrProvenanceChanged = false;
  });
  expect((await verifiedPreviousPublication(current)).rootCid).toBe(
    roots.at(-1),
  );
}, 60000);
test("source deltas and tombstones reconcile seeded changed/removal/addition sets without record loss", () => {
  for (let seed = 1; seed <= 80; seed++) {
    const old = Array.from({ length: 12 }, (_, i) => ({
        nativeId: String(i + 1),
        contentHash: sha256("old:" + i),
      })),
      current = old
        .filter((_, i) => (i + seed) % 5 !== 0)
        .map((r, i) => ({
          ...r,
          contentHash:
            (i + seed) % 4 === 0
              ? sha256("changed:" + r.nativeId)
              : r.contentHash,
        }));
    current.push({
      nativeId: String(100 + seed),
      contentHash: sha256("new:" + seed),
    });
    const result = reconcilePublicRecords(old, current);
    expect(
      result.delta.added + result.delta.changed + result.delta.unchanged,
    ).toBe(current.length);
    expect(
      result.delta.deleted + result.delta.changed + result.delta.unchanged,
    ).toBe(old.length);
    expect(result.deletedNativeIds).toEqual(
      old
        .filter((r) => !current.some((c) => c.nativeId === r.nativeId))
        .map((r) => r.nativeId)
        .sort(),
    );
    expect(result.tombstones.nativeIdsSha256).toBe(
      sha256(result.deletedNativeIds.join("\n")),
    );
    expect(reconcilePublicRecords(current, current).delta).toEqual({
      added: 0,
      changed: 0,
      deleted: 0,
      unchanged: current.length,
    });
  }
  expect(() =>
    reconcilePublicRecords(
      [
        { nativeId: "1", contentHash: sha256("a") },
        { nativeId: "1", contentHash: sha256("b") },
      ],
      [],
    ),
  ).toThrow(/duplicate/);
});
