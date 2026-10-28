import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
export const ACTIONLINT_SHA256 =
  "c872d6db8c6bf83a8eaa704fc93999f027d55dffbc63b8a6abdccb47df5f4cd4";
const archiveSha256 =
  "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8";
const directory = path.resolve("data/tools"),
  binary = path.join(directory, "actionlint");
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
if (process.platform !== "linux" || process.arch !== "x64")
  throw new Error(
    "Pinned actionlint tooling currently supports Linux x64 only",
  );
await mkdir(directory, { recursive: true });
if (
  hash(await readFile(binary).catch(() => Buffer.from(""))) !==
  ACTIONLINT_SHA256
) {
  const response = await fetch(
    "https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz",
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok) throw new Error("Official actionlint download failed");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (hash(bytes) !== archiveSha256)
    throw new Error("Official actionlint archive hash differs");
  const archive = path.join(directory, "actionlint.tar.gz");
  await writeFile(archive, bytes);
  try {
    execFileSync("tar", ["-xzf", archive, "-C", directory, "actionlint"]);
  } finally {
    await rm(archive, { force: true });
  }
  if (hash(await readFile(binary)) !== ACTIONLINT_SHA256)
    throw new Error("actionlint binary hash differs");
  await chmod(binary, 0o755);
}
console.log(execFileSync(binary, ["--version"], { encoding: "utf8" }).trim());
