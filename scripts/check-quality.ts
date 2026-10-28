import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
const action = process.argv[2];
const hash = (s: Uint8Array) => createHash("sha256").update(s).digest("hex");
if (action === "contract") {
  const raw = await readFile("packages/contracts/src/index.ts");
  const lock = JSON.parse(
    await readFile("packages/contracts/contract.lock.json", "utf8"),
  ) as { version: string; sha256: string };
  const version = raw.toString().match(/CONTRACT_VERSION\s*=\s*"([^"]+)"/)?.[1];
  if (hash(raw) !== lock.sha256 || version !== lock.version)
    throw new Error("Explicit shared contract lock drift");
  console.log("PASS_EXPLICIT_CONTRACT_VERSION_AND_HASH");
} else if (action === "source") {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  let bytes = 0;
  for (const name of files) {
    const meta = await stat(name);
    if (
      meta.size > 5 * 1024 ** 2 ||
      /\.(?:parquet|duckdb|sqlite|car|zip)$/i.test(name)
    )
      throw new Error("Bulk/private artifact must not be tracked: " + name);
    const raw = await readFile(name);
    bytes += raw.length;
    const text = raw.toString("utf8");
    if (
      /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,}\b/.test(
        text,
      )
    )
      throw new Error(
        "High-confidence credential pattern requires review: " + name,
      );
    if (
      /\.(?:ts|tsx)$/.test(name) &&
      /@ts-(?:ignore|nocheck)|\bas\s+any\b|:\s*any\b/.test(text)
    )
      throw new Error(
        "Suppressive TypeScript or explicit any is prohibited: " + name,
      );
  }
  console.log(
    JSON.stringify({
      status: "PASS_TRACKED_AND_NEW_SOURCE_SCAN",
      files: files.length,
      bytes,
      limitations:
        "Custom high-confidence pattern/bulk-artifact scan; not complete secret detection or protected-source exact-value/pixel review.",
    }),
  );
} else if (action === "docs") {
  const files = [
    "README.md",
    "IMPLEMENTATION.md",
    ...(await readdir("docs"))
      .filter((n) => n.endsWith(".md"))
      .map((n) => "docs/" + n),
  ];
  let links = 0;
  for (const file of files) {
    const raw = await readFile(file, "utf8");
    for (const match of raw.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1]!.split("#")[0]!;
      if (!target || /^[a-z]+:/i.test(target)) continue;
      await stat(path.resolve(path.dirname(file), target));
      links++;
    }
  }
  console.log(
    JSON.stringify({
      status: "PASS_ACTIVE_DOCUMENT_LINKS",
      files: files.length,
      links,
      historicalScope:
        "Historical references retain their baseline source identity and are not current operating instructions.",
    }),
  );
} else throw new Error("Expected contract|source|docs");
