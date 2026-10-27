import {
  validatePrivateManifest,
  type PrivateManifest,
} from "../packages/hosted-runtime/src/private-cache.ts";
import { assertPrivateDestination } from "../packages/receipts/src/private-paths.ts";
import { authenticatedSmoke } from "../packages/hosted-runtime/src/smoke.ts";
/** Plans are safe locally. Execution is a separate, human-authorized future operation. */
import { execFileSync } from "node:child_process";
import { writeFile, readFile, mkdtemp, rm, lstat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { verifySnapshotDirectory } from "../packages/query/src/real.ts";
import { readFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
const action = process.argv[2] ?? "deploy",
  execute = process.argv.includes("--execute");
const stack = process.env.PRISM_STACK_NAME ?? "PrismOracleReview";
const plan: Record<string, string[][]> = {
  deploy: [
    ["pnpm", "package:lambda"],
    ["pnpm", "build"],
    [
      "pnpm",
      "exec",
      "cdk",
      "deploy",
      "--app",
      "pnpm exec tsx infra/cdk/app.ts",
      stack,
      "--require-approval",
      "any-change",
    ],
  ],
  destroy: [
    [
      "pnpm",
      "exec",
      "cdk",
      "destroy",
      "--app",
      "pnpm exec tsx infra/cdk/app.ts",
      stack,
      "--force",
    ],
  ],
  evidence: [
    ["aws", "cloudformation", "describe-stacks", "--stack-name", stack],
  ],
  "rotate-access": [],
  smoke: [],
};
if (!Object.hasOwn(plan, action))
  throw new Error("Expected deploy|destroy|evidence|rotate-access|smoke");
if (!execute) {
  console.log(
    JSON.stringify(
      {
        mode: "dry_run",
        action,
        commands: plan[action],
        afterProvision:
          action === "deploy"
            ? [
                "Upload only the exact verified public-safe manifest file set to accepted/<snapshotId>/",
                "Upload built static files to the private site bucket",
                "Invalidate only / and /index.html",
                "Configure review access with rotate-access, then authenticated smoke",
              ]
            : undefined,
        requirements:
          action === "rotate-access"
            ? [
                "PRISM_ACCESS_SECRET_ARN",
                "new review code via stdin; never argv/logged",
              ]
            : action === "smoke"
              ? ["PRISM_REVIEW_URL (HTTPS)", "review code via stdin"]
              : [
                  "Future explicit cloud authorization",
                  "confirmed account/region",
                  "reviewed resources and retention",
                  "PRISM_SNAPSHOT_DIR exact public-safe artifact and PRISM_CRM_REVIEW_URL",
                  "Optional protected upload only with PRISM_PRIVATE_OPERATIONAL_DIR plus separate PRISM_PRIVATE_PROMOTION_APPROVED=yes (rights/access approval)",
                ],
        retention:
          "Buckets, table and logs RETAIN; destroy removes stack but operator must explicitly review and remove retained resources separately.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (process.env.PRISM_CLOUD_EXECUTION_APPROVED !== "yes")
  throw new Error(
    "Cloud execution is disabled: explicit future authorization required",
  );
if (action === "deploy") {
  const directory = process.env.PRISM_SNAPSHOT_DIR,
    crmUrl = process.env.PRISM_CRM_REVIEW_URL;
  if (!directory || !crmUrl || !/^https:\/\/[A-Za-z0-9.-]+\/?$/.test(crmUrl))
    throw new Error(
      "Verified snapshot directory and exact CRM HTTPS review origin required",
    );
  const verified = await verifySnapshotDirectory(directory),
    prefix = `accepted/${verified.manifest.snapshotId}/`;
  const manifestDigest = createHash("sha256")
    .update(
      await readFile(path.join(verified.directory, "artifact-manifest.json")),
    )
    .digest("hex");
  const privatePath = process.env.PRISM_PRIVATE_OPERATIONAL_DIR;
  let privateReady:
    | {
        directory: string;
        manifest: PrivateManifest;
        digest: string;
        prefix: string;
      }
    | undefined;
  if (privatePath) {
    if (process.env.PRISM_PRIVATE_PROMOTION_APPROVED !== "yes")
      throw new Error(
        "Protected promotion needs separate explicit rights/access approval",
      );
    const directory = await assertPrivateDestination(privatePath, [
      verified.directory,
    ]);
    const manifestPath = path.join(
        directory,
        "private-operational-manifest.json",
      ),
      manifestStat = await lstat(manifestPath);
    if (
      !manifestStat.isFile() ||
      manifestStat.isSymbolicLink() ||
      manifestStat.nlink > 1 ||
      manifestStat.size > 1024 * 1024
    )
      throw new Error("Unsafe private promotion manifest");
    const raw = await readFile(manifestPath);
    if (raw.length > 1024 * 1024) throw new Error("Private manifest too large");
    const m: unknown = JSON.parse(raw.toString("utf8"));
    validatePrivateManifest(m, verified.manifest.snapshotId);
    for (const f of m.files) {
      const file = path.join(directory, f.name),
        meta = await lstat(file);
      if (
        !meta.isFile() ||
        meta.isSymbolicLink() ||
        meta.nlink > 1 ||
        meta.size !== f.bytes
      )
        throw new Error("Unsafe private promotion file");
      const bytes = await readFile(file);
      if (
        bytes.length !== f.bytes ||
        createHash("sha256").update(bytes).digest("hex") !== f.sha256
      )
        throw new Error("Protected promotion integrity failure");
    }
    privateReady = {
      directory,
      manifest: m,
      digest: createHash("sha256").update(raw).digest("hex"),
      prefix: `operational/${verified.manifest.snapshotId}/`,
    };
  }
  const temporary = await mkdtemp(path.join(tmpdir(), "prism-deploy-")),
    outputs = path.join(temporary, "outputs.json");
  try {
    execFileSync("pnpm", ["package:lambda"], { stdio: "inherit" });
    execFileSync("pnpm", ["build"], {
      stdio: "inherit",
      env: { ...process.env, VITE_CRM_URL: crmUrl },
    });
    execFileSync(
      "pnpm",
      [
        "exec",
        "cdk",
        "deploy",
        "--app",
        "pnpm exec tsx infra/cdk/app.ts",
        stack,
        "--require-approval",
        "any-change",
        "--outputs-file",
        outputs,
        "--context",
        `snapshotPrefix=${prefix}`,
        "--context",
        `snapshotManifestSha256=${manifestDigest}`,
        "--context",
        `buildId=${process.env.PRISM_BUILD_ID ?? verified.manifest.snapshotId}`,
        ...(privateReady
          ? [
              "--context",
              "enableProtectedView=true",
              "--context",
              `privateSnapshotPrefix=${privateReady.prefix}`,
              "--context",
              `privateManifestSha256=${privateReady.digest}`,
            ]
          : []),
      ],
      { stdio: "inherit" },
    );
    const all = JSON.parse(await readFile(outputs, "utf8")) as Record<
        string,
        Record<string, string>
      >,
      o = all[stack];
    if (!o?.StaticBucket || !o.SnapshotBucket || !o.DistributionId)
      throw new Error("Deployment outputs incomplete; no upload attempted");
    // Public bucket receives only the exact accepted public-safe file set.
    for (const name of [
      ...verified.manifest.files.map((f) => f.name),
      "artifact-manifest.json",
    ])
      execFileSync(
        "aws",
        [
          "s3",
          "cp",
          path.join(verified.directory, name),
          `s3://${o.SnapshotBucket}/${prefix}${name}`,
          "--only-show-errors",
          "--sse",
          "AES256",
        ],
        { stdio: "inherit" },
      );
    if (privateReady) {
      if (!o.PrivateSnapshotBucket)
        throw new Error("Protected bucket output missing");
      for (const name of [
        ...privateReady.manifest.files.map((f) => f.name),
        "private-operational-manifest.json",
      ])
        execFileSync(
          "aws",
          [
            "s3",
            "cp",
            path.join(privateReady.directory, name),
            `s3://${o.PrivateSnapshotBucket}/${privateReady.prefix}${name}`,
            "--only-show-errors",
            "--sse",
            "AES256",
          ],
          { stdio: "inherit" },
        );
    }
    execFileSync(
      "aws",
      [
        "s3",
        "sync",
        "dist",
        `s3://${o.StaticBucket}/`,
        "--only-show-errors",
        "--sse",
        "AES256",
      ],
      { stdio: "inherit" },
    );
    execFileSync(
      "aws",
      [
        "cloudfront",
        "create-invalidation",
        "--distribution-id",
        o.DistributionId,
        "--paths",
        "/",
        "/index.html",
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    console.log(
      "Exact verified snapshot and built static files uploaded. Configure review access through rotate-access, then run the authenticated smoke check.",
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
} else if (action === "rotate-access") {
  const arn = process.env.PRISM_ACCESS_SECRET_ARN;
  if (!arn) throw new Error("Exact secret ARN required");
  const code = readFileSync(0, "utf8").trim();
  if (code.length < 16 || code.length > 256)
    throw new Error("Review code must contain 16..256 characters");
  const config = {
    signingKey: randomBytes(48).toString("base64url"),
    reviewCodeDigest: createHash("sha256").update(code).digest("hex"),
    keyVersion: randomBytes(12).toString("hex"),
    sessionTtlSeconds: 3600,
  };
  // stdin keeps secret material out of process argv and temporary files.
  execFileSync(
    "aws",
    [
      "secretsmanager",
      "put-secret-value",
      "--secret-id",
      arn,
      "--secret-string",
      "file:///dev/stdin",
    ],
    { input: JSON.stringify(config), stdio: ["pipe", "ignore", "inherit"] },
  );
  console.log(
    "Review access rotated; prior sessions fail verification after the 60-second secret cache expires.",
  );
} else if (action === "smoke") {
  const origin = process.env.PRISM_REVIEW_URL;
  if (!origin || !/^https:\/\/[A-Za-z0-9.-]+\/?$/.test(origin))
    throw new Error("Exact HTTPS review origin required");
  const code = readFileSync(0, "utf8").trim();
  console.log(JSON.stringify(await authenticatedSmoke(origin, code)));
} else if (action === "evidence") {
  const raw = execFileSync("aws", plan[action]![0]!.slice(1), {
    encoding: "utf8",
  });
  const out = process.env.PRISM_CLOUD_EVIDENCE;
  if (!out) throw new Error("Evidence output path required");
  await writeFile(out, raw, { mode: 0o600 });
  console.log("Stack evidence saved; values require review before handoff.");
} else
  for (const [command, ...args] of plan[action]!)
    execFileSync(command!, args, { stdio: "inherit" });
