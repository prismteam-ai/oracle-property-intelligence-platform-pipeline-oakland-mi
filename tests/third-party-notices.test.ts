import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { collectThirdPartyNotices } from "../scripts/third-party-notices";
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "prism-notices-"));
  roots.push(root);
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "application", version: "1" }),
  );
  return root;
}
async function pkg(
  root: string,
  name: string,
  license = "MIT",
  texts: Record<string, string> = {
    LICENSE: "Exact fixture copyright and permission text.\n",
  },
) {
  const folder = path.join(root, "node_modules", name);
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name,
      version: "1.2.3",
      license,
      author: "Fixture author",
    }),
  );
  await writeFile(path.join(folder, "index.js"), "export const fixture = 1;\n");
  for (const [file, text] of Object.entries(texts))
    await writeFile(path.join(folder, file), text);
  return path.join(folder, "index.js");
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});

test("notices follow actual emitted packages, preserve LICENSE/NOTICE bytes and sort deterministically", async () => {
  const root = await fixture();
  const a = await pkg(root, "a", "Apache-2.0", {
    LICENSE: "Fixture license A\r\n",
    NOTICE: "Required original notice A\n",
  });
  const z = await pkg(root, "z");
  await pkg(root, "unused-build-only-lightningcss", "MPL-2.0");
  const first = await collectThirdPartyNotices({
    root,
    modules: [z, a, a, "\0virtual", "node:fs"],
  });
  const second = await collectThirdPartyNotices({ root, modules: [a, z] });
  expect(second).toEqual(first);
  expect(first.notices).toContain("Fixture license A\r\n");
  expect(first.notices).toContain("Required original notice A\n");
  expect(first.notices).not.toContain(root);
  expect(first.notices).not.toContain("lightningcss");
  const manifest = JSON.parse(first.manifest);
  expect(manifest.packages.map((p: { name: string }) => p.name)).toEqual([
    "a",
    "z",
  ]);
  expect(manifest.packages[0].texts[0]).toEqual({
    file: "LICENSE",
    sourcePackage: "a@1.2.3",
    sha256: createHash("sha256").update("Fixture license A\r\n").digest("hex"),
  });
  expect(manifest.noticesSha256).toBe(
    createHash("sha256").update(first.notices).digest("hex"),
  );
  expect(first.manifest).not.toContain(root);
});

test("same frozen dependency bytes in another root produce identical notices and manifests", async () => {
  const one = await fixture(),
    two = await fixture();
  const a = await pkg(one, "fixture"),
    b = await pkg(two, "fixture");
  expect(await collectThirdPartyNotices({ root: one, modules: [a] })).toEqual(
    await collectThirdPartyNotices({ root: two, modules: [b] }),
  );
});

test("unknown redistributed package with no license text fails closed", async () => {
  const root = await fixture(),
    module = await pkg(root, "missing", "MIT", {});
  await expect(
    collectThirdPartyNotices({ root, modules: [module] }),
  ).rejects.toThrow("no license/notice text");
});

test("first-party workspace-only output has an explicit empty third-party inventory", async () => {
  const root = await fixture();
  const folder = path.join(root, "packages", "contracts");
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name: "@prism/contracts",
      version: "0.1.0",
      private: true,
    }),
  );
  await writeFile(path.join(folder, "index.js"), "export const local = true;");
  const result = await collectThirdPartyNotices({
    root,
    modules: [path.join(folder, "index.js")],
  });
  expect(result.packageCount).toBe(0);
  expect(JSON.parse(result.manifest).packages).toEqual([]);
  expect(result.notices).toContain("No installed third-party package modules");
});

test("only the three explicit AWS Apache omissions use a disclosed installed AWS text source", async () => {
  const root = await fixture();
  const source = await pkg(root, "@aws-sdk/client-dynamodb", "Apache-2.0", {
    LICENSE: "Exact installed AWS Apache-2.0 fixture\n",
  });
  const modules = await Promise.all(
    [
      "credential-provider-http",
      "credential-provider-login",
      "nested-clients",
    ].map((name) => pkg(root, `@aws-sdk/${name}`, "Apache-2.0", {})),
  );
  const result = await collectThirdPartyNotices({ root, modules });
  expect(result.packageCount).toBe(3);
  const manifest = JSON.parse(result.manifest);
  expect(
    manifest.packages.every(
      (p: { texts: { sourcePackage: string }[] }) =>
        p.texts[0].sourcePackage === "@aws-sdk/client-dynamodb@1.2.3",
    ),
  ).toBe(true);
  expect(result.notices).toContain("Exact installed AWS Apache-2.0 fixture");
  expect(result.manifest).not.toContain(source);
  const wrong = await pkg(
    root,
    "@aws-sdk/not-an-approved-fallback",
    "Apache-2.0",
    {},
  );
  await expect(
    collectThirdPartyNotices({ root, modules: [wrong] }),
  ).rejects.toThrow("no license/notice text");
});

test("published MapLibre source maps identify embedded dependency notices without treating build tools as runtime", async () => {
  const root = await fixture();
  const module = await pkg(root, "maplibre-gl", "BSD-3-Clause");
  await pkg(root, "embedded-renderer", "ISC", {
    LICENSE: "Embedded renderer exact license",
  });
  const map = JSON.stringify({
    version: 3,
    sources: ["../src/own.ts", "../node_modules/embedded-renderer/index.js"],
  });
  await writeFile(
    module,
    "export const map = true;\n//# sourceMappingURL=index.js.map",
  );
  await writeFile(module + ".map", map);
  const result = await collectThirdPartyNotices({ root, modules: [module] });
  const manifest = JSON.parse(result.manifest);
  expect(manifest.packages.map((p: { name: string }) => p.name)).toEqual([
    "embedded-renderer",
    "maplibre-gl",
  ]);
  expect(manifest.packages[0].embeddedEvidence).toEqual([
    {
      package: "maplibre-gl@1.2.3",
      sourceMap: "index.js.map",
      sha256: createHash("sha256").update(map).digest("hex"),
    },
  ]);
  expect(result.notices).toContain("Embedded renderer exact license");
});

test("unknown embedded dependency without text still fails rather than disappearing", async () => {
  const root = await fixture();
  const module = await pkg(root, "maplibre-gl", "BSD-3-Clause");
  await pkg(root, "embedded-no-license", "MIT", {});
  await writeFile(module, "//# sourceMappingURL=index.js.map");
  await writeFile(
    module + ".map",
    JSON.stringify({
      version: 3,
      sources: ["../node_modules/embedded-no-license/index.js"],
    }),
  );
  await expect(
    collectThirdPartyNotices({ root, modules: [module] }),
  ).rejects.toThrow("no license/notice text");
});

test("frozen murmurhash README license section is copied exactly with provenance", async () => {
  const root = await fixture();
  const module = await pkg(root, "murmurhash-js", "MIT", {});
  const folder = path.dirname(module);
  await writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({ name: "murmurhash-js", version: "1.0.0", license: "MIT" }),
  );
  const section =
    '## License (MIT)\n\nCopyright (c) 2011 Gary Court\nPermission is hereby granted fixture text.\nTHE SOFTWARE IS PROVIDED "AS IS"\n';
  await writeFile(
    path.join(folder, "README.md"),
    "# Unrelated API guide\n" + section,
  );
  const result = await collectThirdPartyNotices({ root, modules: [module] });
  const manifest = JSON.parse(result.manifest);
  expect(result.notices).toContain(section);
  expect(result.notices).not.toContain("Unrelated API guide");
  expect(manifest.packages[0].texts[0]).toEqual({
    file: "README.md#License-(MIT)",
    sha256: createHash("sha256").update(section).digest("hex"),
    sourcePackage: "murmurhash-js@1.0.0",
  });
});
test("exact Powertools omission uses hash-pinned upstream MIT-0 and rejects changed license bytes", async () => {
  const root = await fixture();
  const module = await pkg(root, "@aws-lambda-powertools/logger", "MIT-0", {});
  await writeFile(
    path.join(path.dirname(module), "package.json"),
    JSON.stringify({
      name: "@aws-lambda-powertools/logger",
      version: "2.36.0",
      license: "MIT-0",
    }),
  );
  await mkdir(path.join(root, "third-party/licenses"), { recursive: true });
  const destination = path.join(
    root,
    "third-party/licenses/powertools-2.36.0-LICENSE.txt",
  );
  await copyFile(
    new URL(
      "../third-party/licenses/powertools-2.36.0-LICENSE.txt",
      import.meta.url,
    ),
    destination,
  );
  const result = await collectThirdPartyNotices({ root, modules: [module] });
  expect(result.manifest).toContain(
    "aws-powertools/powertools-lambda-typescript@0595159ed90c72cc9a004a98923b9778b876726a",
  );
  await writeFile(destination, "substituted license");
  await expect(
    collectThirdPartyNotices({ root, modules: [module] }),
  ).rejects.toThrow("upstream MIT-0 text differs");
});
test("emitter omission is explicitly a standard SPDX template, never a fabricated recovered copyright", async () => {
  const root = await fixture();
  const module = await pkg(root, "emitter-listener", "BSD-2-Clause", {});
  await writeFile(
    path.join(path.dirname(module), "package.json"),
    JSON.stringify({
      name: "emitter-listener",
      version: "1.1.2",
      license: "BSD-2-Clause",
      author: "Synthetic fixture author",
    }),
  );
  await mkdir(path.join(root, "third-party/licenses"), { recursive: true });
  await copyFile(
    new URL(
      "../third-party/licenses/emitter-listener-1.1.2-SPDX-BSD-2-Clause.txt",
      import.meta.url,
    ),
    path.join(
      root,
      "third-party/licenses/emitter-listener-1.1.2-SPDX-BSD-2-Clause.txt",
    ),
  );
  const result = await collectThirdPartyNotices({ root, modules: [module] });
  expect(result.notices).toContain("<year> <owner>");
  expect(result.notices).toContain("not a recovered upstream copyright notice");
  expect(
    JSON.parse(result.manifest).packages[0].licenseTextDisclosure,
  ).toContain("placeholders unchanged");
});
