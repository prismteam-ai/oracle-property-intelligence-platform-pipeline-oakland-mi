import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

export const NOTICE_FILE = "THIRD_PARTY_NOTICES.txt";
export const NOTICE_MANIFEST = "third-party-notices.json";
const noticeName = /^(?:licen[sc]e|notice|copying|copyright)(?:$|[._-])/i;
const noticeDirectory = /^(?:licen[sc]es?|notices?)$/i;
// These frozen AWS packages declare Apache-2.0 but omit its text in their tarball.
// Preserve the exact installed AWS SDK Apache text, with its source disclosed.
const awsApacheTextFallback = new Set([
  "@aws-sdk/credential-provider-http",
  "@aws-sdk/credential-provider-login",
  "@aws-sdk/nested-clients",
]);
type PackageMetadata = {
  name: string;
  version: string;
  license?: string;
  author?: string | { name?: string };
  homepage?: string;
};
type InstalledPackage = { folder: string; metadata: PackageMetadata };
const digest = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

async function packageForFile(
  file: string,
): Promise<InstalledPackage | undefined> {
  let folder = path.dirname(await realpath(file));
  while (true) {
    try {
      const metadata = JSON.parse(
        await readFile(path.join(folder, "package.json"), "utf8"),
      ) as PackageMetadata;
      if (
        typeof metadata.name === "string" &&
        typeof metadata.version === "string"
      )
        return { folder, metadata };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = path.dirname(folder);
    if (parent === folder) return undefined;
    folder = parent;
  }
}

async function licenseFiles(folder: string) {
  const files: string[] = [];
  for (const entry of (await readdir(folder, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name, "en"),
  )) {
    if (entry.isFile() && noticeName.test(entry.name)) files.push(entry.name);
    if (entry.isDirectory() && noticeDirectory.test(entry.name)) {
      for (const child of (
        await readdir(path.join(folder, entry.name), { withFileTypes: true })
      ).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
        if (child.isFile()) files.push(`${entry.name}/${child.name}`);
      }
    }
  }
  return files;
}

/** Only emitted bundle modules (plus explicitly copied runtime packages) belong here. */
export async function collectThirdPartyNotices(input: {
  root: string;
  modules: Iterable<string>;
}) {
  const root = await realpath(input.root);
  const packages = new Map<string, InstalledPackage>();
  const embeddedEvidence = new Map<
    string,
    { package: string; sourceMap: string; sha256: string }[]
  >();
  for (const moduleId of [...input.modules].sort()) {
    if (moduleId.includes("\0") || moduleId.startsWith("node:")) continue;
    const clean = moduleId.split("?")[0];
    const file = path.isAbsolute(clean) ? clean : path.resolve(root, clean);
    let found: InstalledPackage | undefined;
    try {
      if (!(await stat(file)).isFile()) continue;
      found = await packageForFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    // Local workspace packages are first-party source, not installed third parties.
    if (!found || !found.folder.split(path.sep).includes("node_modules"))
      continue;
    const key = `${found.metadata.name}@${found.metadata.version}`;
    const prior = packages.get(key);
    if (prior && prior.folder !== found.folder) {
      // pnpm can expose identical package copies through different peer contexts.
      if (JSON.stringify(prior.metadata) !== JSON.stringify(found.metadata))
        throw new Error(`Conflicting installed package metadata: ${key}`);
    } else packages.set(key, found);
    // MapLibre's published ESM/worker already embeds dependency code. Its frozen
    // source map identifies that code even though the final bundler sees one module.
    if (found.metadata.name === "maplibre-gl" && /\.m?js$/.test(file)) {
      const mapping = /sourceMappingURL=([a-zA-Z0-9._-]+\.map)\s*$/.exec(
        await readFile(file, "utf8"),
      );
      if (!mapping) continue;
      const mapFile = path.join(path.dirname(file), mapping[1]);
      if ((await stat(mapFile)).size > 16 * 1024 * 1024)
        throw new Error("Embedded dependency source map bound exceeded");
      const bytes = await readFile(mapFile);
      const sourceMap = JSON.parse(bytes.toString("utf8")) as {
        version: number;
        sources: string[];
      };
      if (
        sourceMap.version !== 3 ||
        !Array.isArray(sourceMap.sources) ||
        sourceMap.sources.length > 10000
      )
        throw new Error("Embedded dependency source map rejected");
      const names = new Set(
        sourceMap.sources.flatMap((source) => {
          if (typeof source !== "string")
            throw new Error("Embedded source path rejected");
          const match = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(
            source,
          );
          return match ? [match[1]] : [];
        }),
      );
      const resolve = createRequire(path.join(found.folder, "package.json"));
      for (const name of [...names].sort()) {
        let entry: string;
        try {
          entry = resolve.resolve(`${name}/package.json`);
        } catch {
          entry = resolve.resolve(name);
        }
        const embedded = await packageForFile(entry);
        if (!embedded || embedded.metadata.name !== name)
          throw new Error(`Embedded dependency identity missing: ${name}`);
        const embeddedKey = `${name}@${embedded.metadata.version}`;
        packages.set(embeddedKey, embedded);
        const evidence = embeddedEvidence.get(embeddedKey) ?? [];
        const item = {
          package: key,
          sourceMap: path
            .relative(found.folder, await realpath(mapFile))
            .split(path.sep)
            .join("/"),
          sha256: digest(bytes),
        };
        if (!evidence.some((e) => JSON.stringify(e) === JSON.stringify(item)))
          evidence.push(item);
        embeddedEvidence.set(embeddedKey, evidence);
      }
    }
  }
  const manifest: {
    name: string;
    version: string;
    license: string;
    author?: string;
    homepage?: string;
    embeddedEvidence?: { package: string; sourceMap: string; sha256: string }[];
    texts: { file: string; sha256: string; sourcePackage: string }[];
  }[] = [];
  const sections: string[] = [
    "Third-party notices for code included in this artifact.\n" +
      "Generated from emitted bundle modules and explicitly copied runtime packages.\n" +
      "Build tools absent from the artifact are excluded.\n",
  ];
  for (const [key, pkg] of [...packages].sort(([a], [b]) =>
    a.localeCompare(b, "en"),
  )) {
    const { metadata } = pkg;
    let textPackage = pkg;
    let files = await licenseFiles(pkg.folder);
    if (
      files.length === 0 &&
      awsApacheTextFallback.has(metadata.name) &&
      metadata.license === "Apache-2.0"
    ) {
      const candidate = path.join(
        root,
        "node_modules/@aws-sdk/client-dynamodb/package.json",
      );
      const installed = await packageForFile(candidate);
      if (
        !installed ||
        installed.metadata.name !== "@aws-sdk/client-dynamodb" ||
        installed.metadata.license !== "Apache-2.0"
      )
        throw new Error(
          `Installed AWS Apache license text unavailable: ${key}`,
        );
      textPackage = installed;
      files = (await licenseFiles(installed.folder)).filter((f) =>
        /^licen[sc]e(?:$|[._-])/i.test(f),
      );
    }
    let readmeLicense: { file: string; bytes: Buffer } | undefined;
    if (
      files.length === 0 &&
      metadata.name === "murmurhash-js" &&
      metadata.version === "1.0.0" &&
      metadata.license === "MIT"
    ) {
      const readme = await readFile(path.join(pkg.folder, "README.md"), "utf8");
      const section = /(?:^|\n)## License \(MIT\)\r?\n([\s\S]*?)(?=\n## |$)/
        .exec(readme)?.[0]
        .trimStart();
      if (
        !section ||
        !section.includes("Copyright (c) 2011 Gary Court") ||
        !section.includes("Permission is hereby granted") ||
        !section.includes('THE SOFTWARE IS PROVIDED "AS IS"')
      )
        throw new Error("Frozen murmurhash-js README license unavailable");
      readmeLicense = {
        file: "README.md#License-(MIT)",
        bytes: Buffer.from(section),
      };
    }
    if (files.length === 0 && !readmeLicense)
      throw new Error(
        `Redistributed package has no license/notice text: ${key}`,
      );
    const sourcePackage = `${textPackage.metadata.name}@${textPackage.metadata.version}`;
    const entry = {
      name: metadata.name,
      version: metadata.version,
      license:
        typeof metadata.license === "string"
          ? metadata.license
          : "SEE INCLUDED TEXT",
      ...(metadata.author
        ? {
            author:
              typeof metadata.author === "string"
                ? metadata.author
                : metadata.author.name,
          }
        : {}),
      ...(metadata.homepage ? { homepage: metadata.homepage } : {}),
      ...(embeddedEvidence.has(key)
        ? {
            embeddedEvidence: embeddedEvidence
              .get(key)!
              .sort((a, b) => a.sourceMap.localeCompare(b.sourceMap, "en")),
          }
        : {}),
      texts: [] as { file: string; sha256: string; sourcePackage: string }[],
    };
    sections.push(
      `\n===== ${key} =====\nLicense: ${entry.license}\n` +
        (entry.author ? `Author: ${entry.author}\n` : "") +
        (entry.homepage ? `Homepage: ${entry.homepage}\n` : ""),
    );
    const texts: { file: string; bytes: Buffer }[] = await Promise.all(
      files.map(async (file) => ({
        file,
        bytes: await readFile(path.join(textPackage.folder, file)),
      })),
    );
    if (readmeLicense) texts.push(readmeLicense);
    for (const { file, bytes } of texts) {
      entry.texts.push({ file, sha256: digest(bytes), sourcePackage });
      sections.push(
        `\n--- ${sourcePackage}: ${file} ---\n${bytes.toString("utf8")}\n`,
      );
    }
    manifest.push(entry);
  }
  if (manifest.length === 0)
    sections.push(
      "\nNo installed third-party package modules were emitted in this artifact.\n",
    );
  const notices = sections.join("");
  return {
    notices,
    manifest:
      JSON.stringify(
        {
          schemaVersion: 1,
          noticesSha256: digest(notices),
          packages: manifest,
        },
        null,
        2,
      ) + "\n",
    packageCount: manifest.length,
  };
}

export function thirdPartyNoticesPlugin(root = process.cwd()): Plugin {
  return {
    name: "prism-third-party-notices",
    async generateBundle(_options, bundle) {
      const modules = Object.values(bundle).flatMap((item) =>
        item.type === "chunk" ? Object.keys(item.modules) : [],
      );
      const result = await collectThirdPartyNotices({ root, modules });
      this.emitFile({
        type: "asset",
        fileName: NOTICE_FILE,
        source: result.notices,
      });
      this.emitFile({
        type: "asset",
        fileName: NOTICE_MANIFEST,
        source: result.manifest,
      });
    },
  };
}
