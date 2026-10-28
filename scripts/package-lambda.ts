import { sourceIdentity } from "../packages/hosted-runtime/src/source-identity.ts";
import {
  runtimeIdentity,
  STAGING_REGION,
  validatedRegion,
} from "../packages/hosted-runtime/src/release.ts";
import { CONTRACT_VERSION } from "../packages/contracts/src/index.ts";
import { build } from "esbuild";
import { createRequire } from "node:module";
import {
  cp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  stat,
  chmod,
  utimes,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  collectThirdPartyNotices,
  NOTICE_FILE,
  NOTICE_MANIFEST,
} from "./third-party-notices.ts";
const root = process.cwd(),
  out = path.resolve(root, "dist-lambda");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const stage = process.env.PRISM_RELEASE_STAGE ?? "local";
if (stage !== "local" && stage !== "review")
  throw new Error("Unknown release stage");
const identity = runtimeIdentity(
  "oracle",
  sourceIdentity(root),
  {
    version: CONTRACT_VERSION,
    sha256: createHash("sha256")
      .update(
        await readFile(path.join(root, "packages/contracts/src/index.ts")),
      )
      .digest("hex"),
  },
  stage,
  validatedRegion(process.env.PRISM_DEPLOY_REGION ?? STAGING_REGION, [
    process.env.AWS_REGION,
    process.env.AWS_DEFAULT_REGION,
  ]),
);
const result = await build({
  entryPoints: [path.join(root, "apps/api/src/lambda.ts")],
  outfile: path.join(out, "index.mjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  banner: {
    js: "import { createRequire as _createRequire } from 'node:module';const require = _createRequire(import.meta.url);",
  },
  external: ["@duckdb/node-api"],
  define: { __PRISM_BUILD_METADATA__: JSON.stringify(identity) },
  minify: false,
  sourcemap: false,
  metafile: true,
});
await writeFile(
  path.join(out, "bundle-metafile.json"),
  JSON.stringify(result.metafile),
);
const copied = new Set<string>();
const copiedPackageFiles: string[] = [];
async function copyPackage(name: string, from: string) {
  if (copied.has(name)) return;
  copied.add(name);
  const resolver = createRequire(path.join(from, "package.json"));
  let main: string;
  try {
    main = resolver.resolve(`${name}/package.json`);
  } catch {
    main = resolver.resolve(name);
  }
  let folder = path.dirname(main);
  while (
    JSON.parse(
      await readFile(path.join(folder, "package.json"), "utf8").catch(
        () => '{"name":""}',
      ),
    ).name !== name
  ) {
    const up = path.dirname(folder);
    if (up === folder) throw new Error(`Package not found: ${name}`);
    folder = up;
  }
  const pkg = JSON.parse(
    await readFile(path.join(folder, "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  copiedPackageFiles.push(path.join(folder, "package.json"));
  await cp(folder, path.join(out, "node_modules", name), {
    recursive: true,
    dereference: true,
    filter: (p) => !p.includes("/node_modules/", folder.length),
  });
  for (const dep of Object.keys(pkg.dependencies ?? {}))
    await copyPackage(dep, folder);
  if (name === "@duckdb/node-bindings")
    await copyPackage("@duckdb/node-bindings-linux-x64", folder);
}
await copyPackage("@duckdb/node-api", root);
const notices = await collectThirdPartyNotices({
  root,
  modules: [
    ...Object.values(result.metafile!.outputs).flatMap((output) =>
      Object.entries(output.inputs)
        .filter(([, value]) => value.bytesInOutput > 0)
        .map(([name]) => name),
    ),
    ...copiedPackageFiles,
  ],
});
await writeFile(path.join(out, NOTICE_FILE), notices.notices);
await writeFile(path.join(out, NOTICE_MANIFEST), notices.manifest);

await writeFile(
  path.join(out, "package.json"),
  JSON.stringify({
    name: "prism-oracle-lambda",
    private: true,
    type: "module",
    engines: { node: "24.x" },
  }),
);
async function inventory(
  dir: string,
): Promise<{ name: string; bytes: number; sha256: string }[]> {
  let files: { name: string; bytes: number; sha256: string }[] = [];
  for (const entry of (await readdir(dir)).sort()) {
    const p = path.join(dir, entry);
    if ((await stat(p)).isDirectory()) files = files.concat(await inventory(p));
    else {
      const bytes = await readFile(p);
      files.push({
        name: path.relative(out, p),
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  return files;
}
const files = await inventory(out),
  total = files.reduce((a, f) => a + f.bytes, 0);
if (total > 250 * 1024 * 1024)
  throw new Error("Lambda uncompressed package exceeds 250MiB limit");
const zip = path.join(root, "oracle-lambda.zip");
await rm(zip, { force: true });
for (const f of files) {
  await chmod(path.join(out, f.name), 0o644);
  await utimes(
    path.join(out, f.name),
    new Date("1980-01-01T00:00:00Z"),
    new Date("1980-01-01T00:00:00Z"),
  );
}
execFileSync("zip", ["-X", "-q", zip, "-@"], {
  cwd: out,
  input: files.map((f) => f.name).join("\n") + "\n",
});
const zipped = await readFile(zip);
const report = {
  runtime: "nodejs24.x",
  identity,
  architecture: "x86_64",
  os: "Linux glibc; Amazon Linux 2023 verified separately by emulator",
  uncompressedBytes: total,
  zipBytes: zipped.length,
  zipSha256: createHash("sha256").update(zipped).digest("hex"),
  files,
  noticePackageCount: notices.packageCount,
  snapshotPackaging:
    "S3 integrity-verified cache; snapshot data excluded from deployment zip",
  emulationOnlyEnvironment: "PRISM_RUNTIME_EMULATION=1 never configured by CDK",
};
await writeFile(
  path.join(out, "package-report.json"),
  JSON.stringify(report, null, 2),
);
const evidence = process.env.PRISM_PACKAGE_EVIDENCE;
if (evidence) await writeFile(evidence, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    uncompressedBytes: total,
    zipBytes: zipped.length,
    zipSha256: report.zipSha256,
    fileCount: files.length,
  }),
);
