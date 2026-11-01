import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateConcurrencyProof } from "./concurrency.ts";
/** Resolve existing ancestors while preserving absent protected path suffixes. */
async function canonicalProtectedRoot(root: string): Promise<string> {
  let current = path.resolve(root);
  const suffix: string[] = [];
  for (;;) {
    try {
      return path.join(await realpath(current), ...suffix);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}
/** Private parent-collected metadata only; no SDK or credential access. */
export async function loadConcurrencyProof(
  file: string,
  expectedAccountId: string,
  protectedRoots: readonly string[],
  nowMs = Date.now(),
) {
  const absolute = path.resolve(file);
  let current = absolute;
  for (;;) {
    if ((await lstat(current)).isSymbolicLink())
      throw new Error("Concurrency proof links are forbidden");
    try {
      await lstat(path.join(current, ".git"));
      throw new Error("Concurrency proof must be outside Git");
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        ["ENOENT", "ENOTDIR"].includes(String(error.code))
      ))
        throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const canonical = await realpath(absolute);
  for (const root of protectedRoots) {
    const protectedPath = await canonicalProtectedRoot(root);
    if (
      canonical === protectedPath ||
      canonical.startsWith(protectedPath + path.sep)
    )
      throw new Error(
        "Concurrency proof must be outside repositories and Return",
      );
  }
  const stat = await lstat(absolute);
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    (process.getuid && stat.uid !== process.getuid()) ||
    stat.size > 32768
  )
    throw new Error(
      "Concurrency proof requires owner0600 regular private metadata file",
    );
  const bytes = await readFile(absolute);
  return {
    ...validateConcurrencyProof(
      JSON.parse(bytes.toString("utf8")),
      expectedAccountId,
      nowMs,
    ),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
