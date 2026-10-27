import { lstat, readlink, realpath } from "node:fs/promises";
import path from "node:path";
function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
export async function canonicalDestination(
  candidate: string,
  depth = 0,
): Promise<string> {
  if (depth > 64) throw new Error("Too many symlink indirections");
  const absolute = path.resolve(candidate);
  try {
    return await realpath(absolute);
  } catch (error) {
    if (!missing(error)) throw error;
  }
  let current = absolute;
  const tail: string[] = [];
  for (;;) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        const target = await readlink(current);
        return canonicalDestination(
          path.resolve(path.dirname(current), target, ...tail),
          depth + 1,
        );
      }
      return path.resolve(await realpath(current), ...tail);
    } catch (error) {
      if (!missing(error)) throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}
export async function assertPrivateDestination(
  candidate: string,
  protectedRoots: readonly string[],
): Promise<string> {
  const resolved = await canonicalDestination(candidate);
  let ancestor = resolved;
  for (;;) {
    try {
      await lstat(path.join(ancestor, ".git"));
      throw new Error("Raw real output must not enter a Git repository");
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      ))
        throw error;
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  try {
    const info = await lstat(resolved);
    if (info.isFile() && info.nlink > 1)
      throw new Error("Raw real output must not overwrite a hard-linked file");
  } catch (error) {
    if (!missing(error)) throw error;
  }

  for (const root of protectedRoots) {
    const protectedPath = await canonicalDestination(root);
    if (
      resolved === protectedPath ||
      resolved.startsWith(protectedPath + path.sep)
    )
      throw new Error(
        "Raw real output must be outside all repositories and the return bundle, including symlink targets",
      );
  }
  return resolved;
}
