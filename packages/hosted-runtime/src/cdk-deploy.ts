import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ReleasePins } from "./release.ts";
/** Only called after the operator has validated source, account, data, cost and private outputs. */
export async function deployWithCdk(
  pins: ReleasePins,
  operations: string,
): Promise<void> {
  const args = [
    "exec",
    "cdk",
    "deploy",
    pins.stackName,
    "--toolkit-stack-name",
    "PrismAssessmentReviewToolkit",
    "--app",
    "cdk.out",
    "--require-approval",
    "never",
    "--no-lookups",
    "--progress",
    "events",
    "--outputs-file",
    path.join(operations, "cdk-outputs.private.json"),
  ];
  let failed = false;
  try {
    const stdout = execFileSync("pnpm", args, {
      encoding: "utf8",
      timeout: 1200000,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        AWS_REGION: pins.region,
        AWS_DEFAULT_REGION: pins.region,
        CDK_DEFAULT_ACCOUNT: pins.expectedAccountId,
        CDK_DEFAULT_REGION: pins.region,
      },
    });
    await writeFile(path.join(operations, "cdk-deploy.private.log"), stdout, {
      mode: 0o600,
    });
  } catch (error) {
    const output =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr)
        : "CDK deployment failed";
    await writeFile(
      path.join(operations, "cdk-deploy-failure.private.log"),
      output,
      { mode: 0o600 },
    );
    failed = true;
  }
  if (failed)
    throw new Error("CDK deployment failed; private operator log retained");
}
