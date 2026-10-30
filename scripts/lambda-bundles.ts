import path from "node:path";
import type { BuildOptions, Metafile } from "esbuild";
import type { RuntimeIdentity } from "../packages/hosted-runtime/src/release.ts";

export const lambdaBundles = [
  {
    entry: "apps/api/src/lambda.ts",
    file: "index.mjs",
    metafile: "bundle-metafile.json",
    handler: "index.handler",
  },
  {
    entry: "apps/api/src/alert-lambda.ts",
    file: "alert.mjs",
    metafile: "alert-bundle-metafile.json",
    handler: "alert.alertHandler",
  },
] as const;

/** Both ZIP entries use the same runtime options and source identity. */
export function lambdaBundleOptions(
  root: string,
  out: string,
  identity: RuntimeIdentity,
  bundle: (typeof lambdaBundles)[number],
): BuildOptions {
  return {
    entryPoints: [path.join(root, bundle.entry)],
    outfile: path.join(out, bundle.file),
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
  };
}

/** License inventory covers emitted code from every independently built entry. */
export function emittedBundleModules(metafiles: readonly Metafile[]) {
  return [
    ...new Set(
      metafiles.flatMap((metafile) =>
        Object.values(metafile.outputs).flatMap((output) =>
          Object.entries(output.inputs)
            .filter(([, value]) => value.bytesInOutput > 0)
            .map(([name]) => name),
        ),
      ),
    ),
  ];
}

/** Require both emitted entries/metafiles before making a ZIP identity claim. */
export function lambdaEntrypointInventory(
  files: readonly { name: string; bytes: number; sha256: string }[],
) {
  return lambdaBundles.map(({ file, metafile, handler }) => {
    const emitted = files.find((value) => value.name === file);
    const graph = files.find((value) => value.name === metafile);
    if (!emitted?.bytes || !graph?.bytes)
      throw new Error(`Lambda entry or metafile missing: ${file}`);
    return {
      file,
      metafile,
      handler,
      bytes: emitted.bytes,
      sha256: emitted.sha256,
    };
  });
}
