import { readdir, lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
/** Hash generated public frontend objects; excludes only this self-describing manifest. */
export async function writeReviewerAssetManifest(
  directory: string,
  buildId: string,
) {
  const files: { name: string; bytes: number; sha256: string }[] = [];
  let total = 0;
  async function visit(dir: string) {
    for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const file = path.join(dir, e.name);
      const s = await lstat(file);
      if (s.isSymbolicLink() || (s.isFile() && s.nlink > 1))
        throw new Error("Reviewer asset links rejected");
      if (s.isDirectory()) {
        await visit(file);
        continue;
      }
      if (!s.isFile()) throw new Error("Reviewer asset type rejected");
      const name = path.relative(directory, file).replaceAll(path.sep, "/");
      if (name === "assessment-asset-manifest.json") continue;
      total += s.size;
      if (total > 100_000_000 || files.length >= 512)
        throw new Error("Reviewer assets exceed bounds");
      const bytes = await readFile(file);
      files.push({
        name,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  await visit(directory);
  if (!files.some((x) => x.name === "index.html"))
    throw new Error("Reviewer frontend index missing");
  const raw =
    JSON.stringify(
      {
        version: 1,
        buildId,
        selfExcluded: "assessment-asset-manifest.json",
        files,
      },
      null,
      2,
    ) + "\n";
  await writeFile(path.join(directory, "assessment-asset-manifest.json"), raw);
  return createHash("sha256").update(raw).digest("hex");
}
