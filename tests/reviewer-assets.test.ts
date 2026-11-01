import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { writeReviewerAssetManifest } from "../packages/hosted-runtime/src/reviewer-assets.ts";
it("binds nested public assets without a recursive self-hash and rejects external links", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-reviewer-assets-"));
  await mkdir(path.join(root, "assets"));
  await writeFile(path.join(root, "index.html"), "<html>review</html>");
  await writeFile(path.join(root, "assets", "app.js"), "export default 1;");
  const first = await writeReviewerAssetManifest(root, "test-build");
  const raw = await readFile(path.join(root, "assessment-asset-manifest.json"));
  expect(createHash("sha256").update(raw).digest("hex")).toBe(first);
  const m = JSON.parse(raw.toString());
  expect(m.files.map((x: { name: string }) => x.name).sort()).toEqual([
    "assets/app.js",
    "index.html",
  ]);
  expect(await writeReviewerAssetManifest(root, "test-build")).toBe(first);
  const external = await mkdtemp(
    path.join(tmpdir(), "prism-private-sentinel-"),
  );
  await writeFile(
    path.join(external, "excluded.txt"),
    "SYNTHETIC_PRIVATE_SENTINEL",
  );
  await symlink(external, path.join(root, "external"));
  await expect(writeReviewerAssetManifest(root, "test-build")).rejects.toThrow(
    "links",
  );
});
