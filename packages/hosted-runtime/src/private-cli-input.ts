import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
/** AWS CLI must reopen a real private file; Node's piped stdin may be a socket. */
export function withPrivateCliInput<T>(
  directory: string,
  args: string[],
  input: string | undefined,
  run: (args: string[]) => T,
): T {
  if (input === undefined) return run(args);
  if (
    !args.includes("file:///dev/stdin") ||
    Buffer.byteLength(input) > 1_000_000
  )
    throw new Error("Explicit bounded private CLI input required");
  const scratch = mkdtempSync(path.join(directory, "cli-input-"));
  try {
    const filename = path.join(scratch, "input.json");
    writeFileSync(filename, input, { mode: 0o600, flag: "wx" });
    return run(
      args.map((a) => (a === "file:///dev/stdin" ? `file://${filename}` : a)),
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
