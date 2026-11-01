import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
async function sourceState() {
  const git = (args: string[]) =>
    execFileSync("git", args, { encoding: "utf8" }).trim();
  const files = git([
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .split("\0")
    .filter(Boolean)
    .sort();
  const graph = createHash("sha256");
  for (const file of files)
    graph.update(
      file +
        "\0" +
        createHash("sha256")
          .update(await readFile(file))
          .digest("hex") +
        "\n",
    );
  return {
    head: git(["rev-parse", "HEAD"]),
    tree: git(["rev-parse", "HEAD^{tree}"]),
    dirty: git(["status", "--porcelain"]) !== "",
    files: files.length,
    sourceGraphSha256: graph.digest("hex"),
  };
}
const initialSource = await sourceState();
const version = execFileSync("pnpm", ["--version"], {
  encoding: "utf8",
}).trim();
if (Number(process.versions.node.split(".")[0]) !== 24 || version !== "11.25.0")
  throw new Error("CI requires Node24 and pnpm11.25.0");
const steps = [
  "format:check",
  "lint",
  "typecheck",
  "test",
  "contract:check",
  "scan:source",
  "workflow:check",
  "build",
  "package:lambda",
  "cdk:check",
  "audit:production",
  "runtime:emulate",
  "runtime:alert:emulate",
  "test:browser",
  "docs:check",
];
const env = {
  ...process.env,
  CI: "true",
  PRISM_RELEASE_STAGE: "local",
  PRISM_DEPLOY_REGION: "us-east-2",
  AWS_REGION: "us-east-2",
  AWS_DEFAULT_REGION: "us-east-2",
  PRISM_DATA_MODE: "synthetic",
  PRISM_TEST_MODE: "synthetic",
};
for (const key of Object.keys(env))
  if (
    /^PRISM_(?:SNAPSHOT|PRIVATE_|OWNER_|OFFICIAL_PARCEL_|ENABLE_PROTECTED|REAL_|TROY_|ROCHESTER_)/.test(
      key,
    )
  )
    delete (env as Record<string, string | undefined>)[key];
await mkdir("ci-results", { recursive: true });
const results: {
  step: string;
  exit: number | null;
  elapsedMs: number;
  logSha256: string;
}[] = [];
for (const step of steps) {
  const started = performance.now();
  const result = spawnSync("pnpm", ["run", step], {
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 ** 2,
    timeout: 20 * 60000,
  });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  const sourceUnchanged =
    JSON.stringify(await sourceState()) === JSON.stringify(initialSource);
  await writeFile(`ci-results/${step.replaceAll(":", "-")}.log`, log);
  results.push({
    step,
    exit: result.status,
    elapsedMs: performance.now() - started,
    logSha256: createHash("sha256").update(log).digest("hex"),
  });
  await writeFile(
    "ci-results/summary.json",
    JSON.stringify(
      {
        version: 1,
        mode:
          process.env.GITHUB_ACTIONS === "true"
            ? "GITHUB_ACTIONS_ENVIRONMENT"
            : "LOCAL_CI_EQUIVALENT_NO_GITHUB_EXECUTION",
        node: process.versions.node,
        pnpm: version,
        source: initialSource,
        sourceUnchanged,
        allPassed:
          sourceUnchanged &&
          results.length === steps.length &&
          results.every((r) => r.exit === 0),
        completed: results.length,
        planned: steps.length,
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`${step}: ${result.status === 0 ? "PASS" : "FAIL"}`);
  if (result.status !== 0 || !sourceUnchanged) {
    console.error(log.slice(-20000));
    if (!sourceUnchanged)
      console.error(
        "Source changed during CI; entire campaign must be repeated",
      );
    process.exit(1);
  }
}
