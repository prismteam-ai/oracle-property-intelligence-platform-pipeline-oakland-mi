/** P3 guarded operator entry point. No effect occurs without --execute and exact private release pins. */
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, lstat, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { sourceIdentity } from "../packages/hosted-runtime/src/source-identity.ts";
import {
  STAGING_REGION,
  STAGING_STAGE,
  validateReleasePins,
  validatedRegion,
  assertPinnedSource,
  assertCallerAccount,
  assertPackageIdentity,
  assertCostEnvelope,
  APPROVED_PUBLIC_MANIFEST_SHA256,
  APPROVED_PRIVATE_MANIFEST_SHA256,
  type ReleasePins,
  type RuntimeIdentity,
} from "../packages/hosted-runtime/src/release.ts";
import { verifySnapshotDirectory } from "../packages/query/src/real.ts";
import { assertPrivateDestination } from "../packages/receipts/src/private-paths.ts";
import {
  validatePrivateManifest,
  type PrivateManifest,
} from "../packages/hosted-runtime/src/private-cache.ts";
import { authenticatedSmoke } from "../packages/hosted-runtime/src/smoke.ts";
const action = process.argv[2] ?? "deploy",
  execute = process.argv.includes("--execute");
if (
  !["deploy", "smoke", "evidence", "rotate-access", "destroy"].includes(
    action,
  ) ||
  process.argv.slice(3).some((a) => a !== "--execute")
)
  throw new Error(
    "Expected deploy|smoke|evidence|rotate-access|destroy and optional --execute",
  );
const required = [
  "PRISM_EXPECTED_ACCOUNT_ID",
  "PRISM_EXPECTED_HEAD",
  "PRISM_EXPECTED_TREE",
  "PRISM_EXPECTED_ARCHIVE_SHA256",
  "PRISM_DEPLOY_ASSET_BUCKET",
  "PRISM_PRIVATE_OPERATIONS_DIR",
  "PRISM_AWS_ACTUAL_USD",
  "PRISM_AWS_PENDING_USD",
  "PRISM_P3_ACTUAL_USD",
  "PRISM_P3_PENDING_USD",
  ...(action === "deploy"
    ? ["PRISM_CFN_EXECUTION_ROLE_ARN", "PRISM_SNAPSHOT_DIR"]
    : []),
];
if (!execute) {
  console.log(
    JSON.stringify(
      {
        mode: "dry_run",
        action,
        stage: STAGING_STAGE,
        region: STAGING_REGION,
        missing: required.filter((k) => !process.env[k]),
        source: sourceIdentity(),
        approvedPublicManifestSha256: APPROVED_PUBLIC_MANIFEST_SHA256,
        approvedPrivateManifestSha256: APPROVED_PRIVATE_MANIFEST_SHA256,
        assetStrategy:
          "Explicit pre-existing private task S3 bucket; measured content-hash ZIP key; BootstraplessSynthesizer; no CDK bootstrap or ECR",
        steps:
          action === "deploy"
            ? [
                "Verify clean source, measured staging ZIP and exact public/private artifacts",
                "Verify caller account, frozen region, budget and private asset bucket",
                "Upload ZIP to prism-p3/oracle/lambda/<sha>.zip",
                "Synthesize with no lookups; deploy CloudFormation using approved execution role",
                "Upload exact public allowlist and optional exact protected companion to separate private prefixes",
                "Upload frontend; invalidate root/index; save redacted output and private receipts",
              ]
            : action === "destroy"
              ? [
                  "Require evidence hash and explicit teardown acknowledgment",
                  "Revoke review access and scoped map key",
                  "Delete only the exact task stack",
                  "Record retained bucket/version/table/log/secret cleanup decisions; never claim billing ceased while retained resources remain",
                ]
              : [
                  "Verify exact pinned account/region/source/package and deployed stack binding",
                  "Run the bounded requested operation without printing secret values",
                ],
        cloudServiceCalls: 0,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (process.env.PRISM_CLOUD_EXECUTION_APPROVED !== "yes")
  throw new Error("Explicit P3 cloud execution approval required");
const get = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing private operator input: ${k}`);
  return v;
};
const pins: ReleasePins = validateReleasePins({
  expectedAccountId: get("PRISM_EXPECTED_ACCOUNT_ID"),
  region: validatedRegion(process.env.PRISM_DEPLOY_REGION ?? STAGING_REGION, [
    process.env.AWS_REGION,
    process.env.AWS_DEFAULT_REGION,
  ]),
  stage: STAGING_STAGE,
  head: get("PRISM_EXPECTED_HEAD"),
  tree: get("PRISM_EXPECTED_TREE"),
  archiveSha256: get("PRISM_EXPECTED_ARCHIVE_SHA256"),
  publicManifestSha256: APPROVED_PUBLIC_MANIFEST_SHA256,
  ...(process.env.PRISM_PRIVATE_OPERATIONAL_DIR
    ? { privateManifestSha256: APPROVED_PRIVATE_MANIFEST_SHA256 }
    : {}),
  assetBucket: get("PRISM_DEPLOY_ASSET_BUCKET"),
  assetPrefix: "prism-p3/oracle/",
  stackName: "PrismOracleReview",
});
assertPinnedSource(pins, sourceIdentity());
const costs = {
  awsActual: Number(get("PRISM_AWS_ACTUAL_USD")),
  awsPending: Number(get("PRISM_AWS_PENDING_USD")),
  totalActual: Number(get("PRISM_P3_ACTUAL_USD")),
  totalPending: Number(get("PRISM_P3_PENDING_USD")),
};
assertCostEnvelope(costs);
const archive = await readFile("oracle-lambda.zip"),
  hash = (b: Uint8Array | string) =>
    createHash("sha256").update(b).digest("hex"),
  report = JSON.parse(
    await readFile("dist-lambda/package-report.json", "utf8"),
  ) as { zipSha256: string; identity: RuntimeIdentity };
if (report.zipSha256 !== hash(archive))
  throw new Error("Deployment archive changed after measurement");
assertPackageIdentity(pins, report.identity, hash(archive));
const operations = await assertPrivateDestination(
  get("PRISM_PRIVATE_OPERATIONS_DIR"),
  [process.cwd()],
);
await mkdir(operations, { recursive: true, mode: 0o700 });
// Rebuild the frontend from the pinned source before any service call. The receipt
// also binds distribution-affecting settings so a resumed deployment cannot silently
// skip an updated origin, protected view or restricted map key.
let frontendDigest: string | null = null;
if (action === "deploy") {
  execFileSync("pnpm", ["build"], {
    stdio: "inherit",
    env: {
      ...process.env,
      PRISM_RELEASE_STAGE: pins.stage,
      PRISM_DEPLOY_REGION: pins.region,
    },
  });
  assertPinnedSource(pins, sourceIdentity());
  const files: { name: string; sha256: string; bytes: number }[] = [];
  async function walk(directory: string) {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name),
        stat = await lstat(file);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1))
        throw new Error("Frontend links are forbidden");
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        const bytes = await readFile(file);
        files.push({
          name: path.relative("dist", file),
          bytes: bytes.length,
          sha256: hash(bytes),
        });
      } else throw new Error("Unexpected frontend file type");
    }
  }
  await walk("dist");
  if (!files.some((f) => f.name === "index.html"))
    throw new Error("Built frontend missing");
  frontendDigest = hash(JSON.stringify(files));
}
const deploymentConfig = {
  pins,
  frontendDigest,
  protected: process.env.PRISM_PRIVATE_OPERATIONAL_DIR
    ? pins.privateManifestSha256
    : null,
  mcpAllowedOrigins: process.env.PRISM_MCP_ALLOWED_ORIGINS ?? "",
  crmMapOrigin: process.env.PRISM_CRM_MAP_ORIGIN ?? null,
  mapKeyExpiresAt: process.env.PRISM_MAP_KEY_EXPIRES_AT ?? null,
  executionRole: process.env.PRISM_CFN_EXECUTION_ROLE_ARN ?? null,
};
const receiptFile = path.join(
  operations,
  `${action}-${hash(JSON.stringify(deploymentConfig)).slice(0, 20)}.json`,
);
let receipt: {
  version: number;
  action: string;
  steps: string[];
  status: string;
} = { version: 1, action, steps: [], status: "started" };
try {
  receipt = JSON.parse(await readFile(receiptFile, "utf8")) as typeof receipt;
} catch (e) {
  if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
}
const save = async () =>
  writeFile(receiptFile, JSON.stringify(receipt, null, 2) + "\n", {
    mode: 0o600,
  });
function aws(args: string[], input?: string) {
  try {
    return execFileSync("aws", ["--region", pins.region, ...args], {
      encoding: "utf8",
      timeout: 1200000,
      input,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        AWS_REGION: pins.region,
        AWS_DEFAULT_REGION: pins.region,
      },
    }).trim();
  } catch {
    throw new Error(
      `AWS ${args[0]}/${args[1]} failed; private arguments and provider output redacted`,
    );
  }
}
const account = JSON.parse(
  aws(["sts", "get-caller-identity", "--output", "json"]),
) as { Account?: string };
assertCallerAccount(pins, account.Account ?? "");
const outputs = () => {
  const description = JSON.parse(
    aws([
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      pins.stackName,
      "--output",
      "json",
    ]),
  ) as {
    Stacks?: { Outputs?: { OutputKey: string; OutputValue: string }[] }[];
  };
  return Object.fromEntries(
    (description.Stacks?.[0]?.Outputs ?? []).map((o) => [
      o.OutputKey,
      o.OutputValue,
    ]),
  );
};
const assertDeployed = (o: Record<string, string>) => {
  if (
    o.Region !== pins.region ||
    o.Stage !== pins.stage ||
    o.LambdaArchiveSha256 !== pins.archiveSha256 ||
    o.ReleaseBuildId !== report.identity.buildId ||
    o.SourceHead !== pins.head ||
    o.SourceTree !== pins.tree ||
    o.ContractSha256 !== report.identity.contractSha256
  )
    throw new Error("Deployed stack does not match the exact approved release");
};
const step = async (name: string, operation: () => Promise<void> | void) => {
  if (receipt.steps.includes(name)) return;
  await operation();
  receipt.steps.push(name);
  await save();
};
try {
  if (action === "deploy") {
    const verified = await verifySnapshotDirectory(get("PRISM_SNAPSHOT_DIR")),
      publicRaw = await readFile(
        path.join(verified.directory, "artifact-manifest.json"),
      );
    if (hash(publicRaw) !== pins.publicManifestSha256)
      throw new Error("Public artifact differs from accepted P2 bytes");
    let privateInput:
      { directory: string; manifest: PrivateManifest } | undefined;
    if (process.env.PRISM_PRIVATE_OPERATIONAL_DIR) {
      if (process.env.PRISM_PRIVATE_PROMOTION_APPROVED !== "yes")
        throw new Error(
          "Exact protected companion promotion acknowledgment required",
        );
      const directory = await assertPrivateDestination(
          process.env.PRISM_PRIVATE_OPERATIONAL_DIR,
          [process.cwd(), verified.directory],
        ),
        raw = await readFile(
          path.join(directory, "private-operational-manifest.json"),
        );
      if (hash(raw) !== pins.privateManifestSha256)
        throw new Error("Protected manifest differs from reviewed P2 bytes");
      const manifest: unknown = JSON.parse(raw.toString("utf8"));
      validatePrivateManifest(manifest, verified.manifest.snapshotId);
      for (const f of manifest.files) {
        const p = path.join(directory, f.name),
          s = await lstat(p);
        if (
          !s.isFile() ||
          s.isSymbolicLink() ||
          s.nlink > 1 ||
          s.size !== f.bytes ||
          hash(await readFile(p)) !== f.sha256
        )
          throw new Error("Protected companion file integrity failure");
      }
      privateInput = { directory, manifest };
    }
    aws([
      "s3api",
      "head-bucket",
      "--bucket",
      pins.assetBucket,
      "--expected-bucket-owner",
      pins.expectedAccountId,
    ]);
    const location = JSON.parse(
      aws(["s3api", "get-bucket-location", "--bucket", pins.assetBucket]),
    ) as { LocationConstraint: string | null };
    if (
      location.LocationConstraint !== null &&
      location.LocationConstraint !== pins.region
    )
      throw new Error("Deployment asset bucket is outside the frozen region");
    const publicAccess = JSON.parse(
      aws(["s3api", "get-public-access-block", "--bucket", pins.assetBucket]),
    ) as { PublicAccessBlockConfiguration: Record<string, boolean> };
    if (
      !Object.values(publicAccess.PublicAccessBlockConfiguration).every(
        Boolean,
      ) ||
      Object.keys(publicAccess.PublicAccessBlockConfiguration).length !== 4
    )
      throw new Error("Deployment assets must block all public access");
    const encryption = JSON.parse(
      aws(["s3api", "get-bucket-encryption", "--bucket", pins.assetBucket]),
    ) as {
      ServerSideEncryptionConfiguration?: {
        Rules?: {
          ApplyServerSideEncryptionByDefault?: { SSEAlgorithm?: string };
        }[];
      };
    };
    if (
      !encryption.ServerSideEncryptionConfiguration?.Rules?.some((r) =>
        ["AES256", "aws:kms"].includes(
          r.ApplyServerSideEncryptionByDefault?.SSEAlgorithm ?? "",
        ),
      )
    )
      throw new Error("Deployment asset bucket requires default encryption");
    const role = get("PRISM_CFN_EXECUTION_ROLE_ARN");
    if (
      !new RegExp(
        `^arn:aws:iam::${pins.expectedAccountId}:role/prism-p3-[A-Za-z0-9_+=,.@/-]+$`,
      ).test(role)
    )
      throw new Error(
        "Exact task-scoped CloudFormation execution role required",
      );
    await step("asset_uploaded", () => {
      aws([
        "s3",
        "cp",
        "oracle-lambda.zip",
        `s3://${pins.assetBucket}/${pins.assetPrefix}lambda/${pins.archiveSha256}.zip`,
        "--sse",
        "AES256",
        "--only-show-errors",
      ]);
    });
    const context = {
      deploymentRegion: pins.region,
      deploymentAccount: pins.expectedAccountId,
      stage: pins.stage,
      deploymentAssetBucket: pins.assetBucket,
      deploymentAssetPrefix: pins.assetPrefix,
      snapshotManifestSha256: pins.publicManifestSha256,
      ...(privateInput
        ? {
            enableProtectedView: "true",
            privateManifestSha256: pins.privateManifestSha256,
            privateSnapshotPrefix: `operational/${verified.manifest.snapshotId}/`,
          }
        : {}),
      ...(process.env.PRISM_MCP_ALLOWED_ORIGINS
        ? { mcpAllowedOrigins: process.env.PRISM_MCP_ALLOWED_ORIGINS }
        : {}),
      ...(process.env.PRISM_CRM_MAP_ORIGIN
        ? {
            enableLocationMap: "true",
            crmMapOrigin: process.env.PRISM_CRM_MAP_ORIGIN,
            mapKeyExpiresAt: get("PRISM_MAP_KEY_EXPIRES_AT"),
          }
        : {}),
    };
    execFileSync("pnpm", ["cdk:synth"], {
      stdio: "inherit",
      env: { ...process.env, CDK_CONTEXT_JSON: JSON.stringify(context) },
    });
    await step("stack_deployed", () => {
      aws([
        "cloudformation",
        "deploy",
        "--template-file",
        "cdk.out/PrismOracleReview.template.json",
        "--stack-name",
        pins.stackName,
        "--capabilities",
        "CAPABILITY_IAM",
        "--role-arn",
        role,
        "--s3-bucket",
        pins.assetBucket,
        "--s3-prefix",
        pins.assetPrefix + "templates",
        "--no-fail-on-empty-changeset",
      ]);
    });
    const o = outputs();
    assertDeployed(o);
    for (const key of ["SnapshotBucket", "StaticBucket", "DistributionId"])
      if (!o[key]) throw new Error("Task deployment outputs incomplete");
    await step("public_uploaded", () => {
      for (const name of [
        ...verified.manifest.files.map((f) => f.name),
        "artifact-manifest.json",
      ])
        aws([
          "s3",
          "cp",
          path.join(verified.directory, name),
          `s3://${o.SnapshotBucket}/accepted/${verified.manifest.snapshotId}/${name}`,
          "--sse",
          "AES256",
          "--only-show-errors",
        ]);
    });
    if (privateInput)
      await step("protected_uploaded", () => {
        if (!o.PrivateSnapshotBucket)
          throw new Error("Private task bucket output missing");
        for (const name of [
          ...privateInput!.manifest.files.map((f) => f.name),
          "private-operational-manifest.json",
        ])
          aws([
            "s3",
            "cp",
            path.join(privateInput!.directory, name),
            `s3://${o.PrivateSnapshotBucket}/operational/${verified.manifest.snapshotId}/${name}`,
            "--sse",
            "AES256",
            "--only-show-errors",
          ]);
      });
    await step("frontend_uploaded", () => {
      aws([
        "s3",
        "sync",
        "dist",
        `s3://${o.StaticBucket}/`,
        "--sse",
        "AES256",
        "--only-show-errors",
      ]);
    });
    await step("index_invalidated", () => {
      aws([
        "cloudfront",
        "create-invalidation",
        "--distribution-id",
        o.DistributionId,
        "--paths",
        "/",
        "/index.html",
      ]);
    });
    await writeFile(
      path.join(operations, "oracle-stack-outputs.json"),
      JSON.stringify(o, null, 2),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        status: "deployed_pending_smoke",
        region: pins.region,
        stage: pins.stage,
        siteUrl: o.SiteUrl,
        buildId: o.ReleaseBuildId,
        archiveSha256: pins.archiveSha256,
        frontendDigest,
        protectedCompanionEnabled: !!privateInput,
        accountVerified: true,
      }),
    );
  } else {
    const o = outputs();
    assertDeployed(o);
    if (action === "rotate-access") {
      const code = readFileSync(0, "utf8").trim();
      if (code.length < 16 || code.length > 256)
        throw new Error("Review code must be supplied privately via stdin");
      const previous = JSON.parse(
        aws([
          "secretsmanager",
          "get-secret-value",
          "--secret-id",
          o.AccessSecretArn!,
          "--query",
          "SecretString",
          "--output",
          "text",
        ]),
      ) as Record<string, unknown>;
      const next = {
        ...previous,
        signingKey: randomBytes(48).toString("base64url"),
        reviewCodeDigest: hash(code),
        keyVersion: randomBytes(12).toString("hex"),
        sessionTtlSeconds: 3600,
      };
      aws(
        [
          "secretsmanager",
          "put-secret-value",
          "--secret-id",
          o.AccessSecretArn!,
          "--secret-string",
          "file:///dev/stdin",
        ],
        JSON.stringify(next),
      );
      console.log(
        JSON.stringify({
          rotated: true,
          otherConfigurationPreserved: true,
          cacheInvalidationSeconds: 60,
        }),
      );
    } else if (action === "smoke") {
      const code = readFileSync(0, "utf8").trim();
      if (
        !o.SiteUrl ||
        !/^https:\/\/d[a-z0-9]+\.cloudfront\.net$/.test(o.SiteUrl)
      )
        throw new Error("Exact deployed CloudFront origin required");
      console.log(
        JSON.stringify(
          await authenticatedSmoke(o.SiteUrl, code, {
            mcp: true,
            expectedHealth: {
              head: pins.head,
              tree: pins.tree,
              buildId: report.identity.buildId,
              region: pins.region,
              stage: pins.stage,
              contractVersion: report.identity.contractVersion,
              contractSha256: report.identity.contractSha256,
              mode: "real",
              publicSnapshotId: "oakland-real-71c0ba7aafadd0e4301b",
            },
          }),
        ),
      );
    } else if (action === "evidence") {
      console.log(
        JSON.stringify({
          region: o.Region,
          stage: o.Stage,
          buildId: o.ReleaseBuildId,
          archiveSha256: o.LambdaArchiveSha256,
          siteUrl: o.SiteUrl,
          accountVerified: true,
          retainedResourcesRequireReview: true,
        }),
      );
    } else {
      if (
        process.env.PRISM_TEARDOWN_APPROVED !== "yes" ||
        !/^[a-f0-9]{64}$/.test(get("PRISM_EVIDENCE_ARCHIVE_SHA256"))
      )
        throw new Error(
          "Explicit teardown approval and exported evidence digest required",
        );
      const previous = JSON.parse(
        aws([
          "secretsmanager",
          "get-secret-value",
          "--secret-id",
          o.AccessSecretArn!,
          "--query",
          "SecretString",
          "--output",
          "text",
        ]),
      ) as Record<string, unknown>;
      aws(
        [
          "secretsmanager",
          "put-secret-value",
          "--secret-id",
          o.AccessSecretArn!,
          "--secret-string",
          "file:///dev/stdin",
        ],
        JSON.stringify({
          ...previous,
          signingKey: randomBytes(48).toString("base64url"),
          reviewCodeDigest: hash(randomBytes(48)),
          keyVersion: randomBytes(12).toString("hex"),
        }),
      );
      if (o.LocationMapKeyName)
        aws([
          "location",
          "delete-key",
          "--key-name",
          o.LocationMapKeyName,
          "--force-delete",
        ]);
      aws(["cloudformation", "delete-stack", "--stack-name", pins.stackName]);
      console.log(
        JSON.stringify({
          stackDeletionRequested: true,
          accessRevoked: true,
          retainedDataCleanupRequired: true,
          billingCeased: false,
          reviewRequired: [
            "versioned public/private bucket objects",
            "DynamoDB state/backups",
            "logs",
            "shared secret",
            "explicit deployment assets",
          ],
        }),
      );
    }
  }
  receipt.status = "completed";
  await save();
} catch (e) {
  receipt.status = "failed";
  await save();
  throw e;
}
