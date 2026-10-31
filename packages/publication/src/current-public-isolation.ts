/** A public-file-only filesystem and network namespace; no credential roots bind. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdir, readFile, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "../../county/src/model.ts";
import { PUBLIC_DATABASE_RELATIONS } from "./current-public-database.ts";
import type { rebuildCurrentPublicDatabase } from "./current-public-database.ts";
export async function rebuildCurrentPublicDatabaseIsolated(options: {
  directory: string;
  indexSha256: string;
  outputDirectory: string;
}) {
  const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const publicDirectory = await realpath(options.directory);
  const index = await readFile(
    path.join(publicDirectory, "artifact-index.json"),
  );
  if (
    !/^[a-f0-9]{64}$/.test(options.indexSha256) ||
    sha256(index) !== options.indexSha256
  )
    throw new Error("Pinned public index identity required before isolation");
  const names = [
    "artifact-index.json",
    ...PUBLIC_DATABASE_RELATIONS.map(
      (name) => name.replaceAll("_", "-") + ".parquet",
    ),
  ];
  for (const name of names) {
    const entry = await lstat(path.join(publicDirectory, name));
    if (!entry.isFile() || entry.isSymbolicLink())
      throw new Error("Public regular input files required");
  }
  await mkdir(options.outputDirectory, { mode: 0o700 });
  const output = await realpath(options.outputDirectory);
  const hostNetworkNamespace = await readlink("/proc/self/ns/net");
  const args = [
    "--unshare-user",
    "--unshare-net",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--die-with-parent",
    "--new-session",
    "--ro-bind",
    "/usr",
    "/usr",
    "--ro-bind",
    "/lib",
    "/lib",
    "--ro-bind",
    "/lib64",
    "/lib64",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--dir",
    "/app",
    "--dir",
    "/runtime",
    "--dir",
    "/public",
    "--ro-bind",
    process.execPath,
    "/runtime/node",
  ];
  for (const name of [
    "packages",
    "scripts",
    "node_modules",
    "package.json",
    "tsconfig.json",
  ])
    args.push("--ro-bind", path.join(projectRoot, name), "/app/" + name);
  for (const name of names)
    args.push("--ro-bind", path.join(publicDirectory, name), "/public/" + name);
  args.push(
    "--bind",
    output,
    "/output",
    "--clearenv",
    "--setenv",
    "PATH",
    "/runtime:/usr/bin:/bin",
    "--setenv",
    "LANG",
    "C.UTF-8",
    "--setenv",
    "LC_ALL",
    "C.UTF-8",
    "--setenv",
    "TZ",
    "UTC",
    "--setenv",
    "TMPDIR",
    "/tmp",
    "--setenv",
    "MALLOC_PERTURB_",
    "165",
    "--chdir",
    "/app",
    "/runtime/node",
    "--import",
    "tsx",
    "scripts/rebuild-current-public-database.ts",
    "--execute",
    "--require-os-isolation",
    "--directory",
    "/public",
    "--index-sha256",
    options.indexSha256,
    "--output-directory",
    "/output/database",
  );
  const result = await promisify(execFile)("/usr/bin/bwrap", args, {
    env: {},
    maxBuffer: 1024 ** 2,
  });
  const report = JSON.parse(result.stdout) as Awaited<
    ReturnType<typeof rebuildCurrentPublicDatabase>
  >;
  if (
    !report.isolation ||
    report.isolation.networkNamespace === hostNetworkNamespace ||
    report.isolation.directNetworkDenied !== "ENETUNREACH"
  )
    throw new Error("Independent network namespace not proven");
  return {
    ...report,
    isolationMechanism:
      "bubblewrap read-only public input/source/runtime mounts; separate user,pid,network,ipc,uts namespaces; clearenv",
    originalPrivateInputsMounted: false,
    mountedPublicInputNames: names,
    writableOwnedOutput: output,
    actualDatabasePath: path.join(output, "database/oakland-public.duckdb"),
    hostAndWorkerNetworkNamespacesDiffer: true,
    workerStderr: result.stderr,
  };
}
