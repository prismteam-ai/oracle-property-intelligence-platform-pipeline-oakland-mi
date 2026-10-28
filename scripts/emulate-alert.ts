import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { sourceIdentity } from "../packages/hosted-runtime/src/source-identity.ts";
const image =
  "public.ecr.aws/lambda/nodejs@sha256:92b7cccd985332238af80ac8da42d6965d418552e88955e315da4e3c0c76ca79";
const report = JSON.parse(
  await readFile("dist-lambda/package-report.json", "utf8"),
) as {
  zipSha256: string;
  identity: { head: string; tree: string; stage: string };
};
const source = sourceIdentity();
const archive = path.resolve("oracle-lambda.zip");
if (
  createHash("sha256")
    .update(await readFile(archive))
    .digest("hex") !== report.zipSha256 ||
  source.head !== report.identity.head ||
  source.tree !== report.identity.tree ||
  (report.identity.stage === "review" && source.dirty)
)
  throw new Error("Alert emulation must match the measured source/package");
execFileSync("docker", ["image", "inspect", image], { stdio: "pipe" });
const root = path.resolve("data/alert-emulation");
await mkdir(root, { recursive: true });
const directory = await mkdtemp(path.join(root, "archive-"));
const name = `prism-oracle-alert-rie-${process.pid}`;
let container: string | undefined;
const privateCanary = "synthetic-private-alarm-reason-do-not-log";
try {
  execFileSync("unzip", ["-q", archive, "-d", directory]);
  container = execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "-d",
      "--name",
      name,
      "--network",
      "none",
      "--memory",
      "128m",
      "--cpus",
      "0.1",
      "--pids-limit",
      "128",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,size=16777216",
      "--mount",
      `type=bind,src=${directory},dst=/var/task,readonly`,
      "-e",
      "PRISM_PAGERDUTY_ENABLED=0",
      "-e",
      "AWS_REGION=us-east-2",
      image,
      "index.alertHandler",
    ],
    { encoding: "utf8", stdio: "pipe" },
  ).trim();
  const event = {
    source: "aws.cloudwatch",
    alarmArn: "arn:aws:cloudwatch:us-east-2:234567890123:alarm:OracleSynthetic",
    region: "us-east-2",
    alarmData: { state: { value: "ALARM", reason: privateCanary } },
  };
  const script =
    "const r=await fetch('http://127.0.0.1:8080/2015-03-31/functions/function/invocations',{method:'POST',body:process.argv[1]});process.stdout.write(await r.text());";
  const started = performance.now();
  const result = JSON.parse(
    execFileSync(
      "docker",
      [
        "exec",
        container,
        "node",
        "--input-type=module",
        "-e",
        script,
        JSON.stringify(event),
      ],
      { encoding: "utf8", timeout: 30000, stdio: "pipe" },
    ),
  ) as { statusCode?: number; body?: string };
  const elapsedMs = performance.now() - started;
  if (
    result.statusCode !== 202 ||
    JSON.parse(result.body ?? "{}").status !==
      "EXTERNAL_ORGANIZATION_DEPENDENCY_BLOCKED" ||
    elapsedMs > 10000
  )
    throw new Error("Packaged bounded disabled alert entrypoint failed");
  const captured = spawnSync("docker", ["logs", container], {
    encoding: "utf8",
  });
  if (captured.status !== 0) throw new Error("Native alert log capture failed");
  const logs = (captured.stdout ?? "") + (captured.stderr ?? "");
  if (logs.includes(privateCanary))
    throw new Error("Native alert log contains a private fixture canary");
  console.log(
    JSON.stringify({
      status: "PASS_PACKAGED_NATIVE_ALERT_DISABLED_MODE",
      image,
      archiveSha256: report.zipSha256,
      source,
      memoryMiB: 128,
      cpuLimit: 0.1,
      elapsedMsIncludingDockerClient: elapsedMs,
      network: "none",
      secretOrProviderCalls: 0,
      privateCanaryAbsent: true,
      livePagerDutyProof: false,
    }),
  );
} finally {
  if (container)
    spawnSync("docker", ["rm", "-f", container], { stdio: "pipe" });
  await rm(directory, { recursive: true, force: true });
}
