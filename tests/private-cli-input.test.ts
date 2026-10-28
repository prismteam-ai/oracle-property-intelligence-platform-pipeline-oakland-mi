import { test, expect } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  statSync,
  readdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { withPrivateCliInput } from "../packages/hosted-runtime/src/private-cli-input.ts";
test("AWS can reopen owner-only JSON without exposing payload in arguments", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "prism-cli-test-"));
  try {
    const input = JSON.stringify({ synthetic: "test-only-payload" });
    const result = withPrivateCliInput(
      directory,
      ["--cli-input-json", "file:///dev/stdin"],
      input,
      (args) => {
        expect(JSON.stringify(args)).not.toContain("test-only-payload");
        const filename = new URL(args[1]!);
        expect(statSync(filename).mode & 0o777).toBe(0o600);
        expect(statSync(path.dirname(filename.pathname)).mode & 0o777).toBe(
          0o700,
        );
        expect(readFileSync(filename, "utf8")).toBe(input);
        return "completed";
      },
    );
    expect(result).toBe("completed");
    expect(readdirSync(directory)).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("failed CLI calls also remove private input and unrelated input is refused", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "prism-cli-test-"));
  try {
    expect(() =>
      withPrivateCliInput(directory, ["file:///dev/stdin"], "{}", () => {
        throw new Error("synthetic failure");
      }),
    ).toThrow("synthetic failure");
    expect(readdirSync(directory)).toEqual([]);
    expect(() =>
      withPrivateCliInput(directory, ["get-item"], "{}", () => "unexpected"),
    ).toThrow("Explicit bounded");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("a real child reopens the regular file while piped stdin remains unused, preserving unknown JSON fields", async () => {
  const { execFileSync } = await import("node:child_process");
  const directory = mkdtempSync(path.join(os.tmpdir(), "prism-cli-child-"));
  try {
    const payload = JSON.stringify({
      SecretId: "synthetic-secret-only",
      SecretString: JSON.stringify({
        unrelated: { retained: "synthetic-retain" },
        signingKey: "synthetic-signing-key",
      }),
    });
    const child = `const fs=require("node:fs");const args=process.argv.slice(1);if(args.some((value)=>value.includes("synthetic-signing-key")))process.exit(8);const file=new URL(args[1]);const input=JSON.parse(fs.readFileSync(file,"utf8"));const secret=JSON.parse(input.SecretString);if(secret.unrelated.retained!=="synthetic-retain"||secret.signingKey!=="synthetic-signing-key")process.exit(9);process.stdout.write(JSON.stringify({reopened:true,unknownFieldsPreserved:true}));`;
    const output = withPrivateCliInput(
      directory,
      ["--cli-input-json", "file:///dev/stdin"],
      payload,
      (args) =>
        execFileSync(process.execPath, ["-e", child, "--", ...args], {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        }),
    );
    expect(JSON.parse(output)).toEqual({
      reopened: true,
      unknownFieldsPreserved: true,
    });
    expect(readdirSync(directory)).toEqual([]);
    expect(() =>
      withPrivateCliInput(
        directory,
        ["--cli-input-json", "file:///dev/stdin"],
        payload,
        (args) =>
          execFileSync(
            process.execPath,
            ["-e", "process.exit(7)", "--", ...args],
            {
              stdio: ["pipe", "pipe", "pipe"],
            },
          ),
      ),
    ).toThrow();
    expect(readdirSync(directory)).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
