import { execFileSync } from "node:child_process";
export function sourceIdentity(cwd = process.cwd()) {
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  return {
    head: git(["rev-parse", "HEAD"]),
    tree: git(["rev-parse", "HEAD^{tree}"]),
    dirty: git(["status", "--porcelain"]) !== "",
  };
}
