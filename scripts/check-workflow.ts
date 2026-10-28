import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";
const binary = "data/tools/actionlint";
const bytes = await readFile(binary);
if (
  createHash("sha256").update(bytes).digest("hex") !==
  "c872d6db8c6bf83a8eaa704fc93999f027d55dffbc63b8a6abdccb47df5f4cd4"
)
  throw new Error(
    "Run pnpm tooling:install to obtain the exact reviewed actionlint binary",
  );
const raw = await readFile(".github/workflows/ci.yml", "utf8");
const workflow = parse(raw) as {
  on: unknown;
  permissions: { contents: string };
  jobs: Record<string, { steps: { uses?: string; run?: string }[] }>;
};
if (
  !workflow.on ||
  typeof workflow.on !== "object" ||
  Object.keys(workflow.on).sort().join(",") !== "pull_request,workflow_dispatch"
)
  throw new Error(
    "Only pull-request and manual verification triggers are supported",
  );
if (
  workflow.permissions.contents !== "read" ||
  JSON.stringify(workflow.permissions) !== '{"contents":"read"}'
)
  throw new Error("CI requires contents:read and no additional permissions");
for (const job of Object.values(workflow.jobs))
  for (const step of job.steps)
    if (
      step.uses &&
      !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+@[a-f0-9]{40}$/.test(step.uses)
    )
      throw new Error("CI actions must be immutable full SHA pins");
if (!raw.includes("pnpm ci:verify") || !raw.includes("--frozen-lockfile"))
  throw new Error(
    "Workflow must execute canonical local CI with a frozen install",
  );
execFileSync(
  binary,
  ["-shellcheck=", "-pyflakes=", ".github/workflows/ci.yml"],
  { stdio: "inherit" },
);
console.log("PASS_PINNED_ACTIONLINT_AND_WORKFLOW_PARITY");
