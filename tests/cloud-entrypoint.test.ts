import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, chmod, access, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
it("dry-run and rejected execution never invoke the account CLI", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "prism-no-cloud-")),
    marker = path.join(directory, "aws-called");
  await writeFile(
    path.join(directory, "aws"),
    `#!/bin/sh\ntouch '${marker}'\nexit 99\n`,
  );
  await chmod(path.join(directory, "aws"), 0o700);
  const env = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH}`,
    PRISM_CLOUD_EXECUTION_APPROVED: "",
    PRISM_EXPECTED_ACCOUNT_ID: "234567890123",
    AWS_REGION: "us-east-2",
  };
  const run = (args: string[], extra: Record<string, string> = {}) =>
    execFileSync(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "scripts/cloud.ts", ...args],
      {
        encoding: "utf8",
        env: { ...env, ...extra },
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10000,
      },
    );
  try {
    expect(JSON.parse(run(["deploy"]))).toMatchObject({
      mode: "dry_run",
      region: "us-east-1",
      cloudServiceCalls: 0,
    });
    expect(() => run(["deploy", "--execute"])).toThrow();
    expect(() =>
      run(["deploy", "--execute"], { PRISM_CLOUD_EXECUTION_APPROVED: "yes" }),
    ).toThrow();
    await expect(access(marker)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
