import { parseFunctionConcurrencyOutput } from "../packages/hosted-runtime/src/function-concurrency.ts";
import {
  reviewedDeploymentFeatures,
  deploymentFeatureContext,
} from "../packages/hosted-runtime/src/deployment-features.ts";
import { assertOperatorIdentity } from "../packages/hosted-runtime/src/operator-identity.ts";
import { deployWithCdk } from "../packages/hosted-runtime/src/cdk-deploy.ts";
import { reviewedDeployment } from "../packages/hosted-runtime/src/deploy-sequence.ts";
import {
  prestageReviewedUpdate,
  type ExistingStackBindings,
} from "../packages/hosted-runtime/src/prestage.ts";
import { writeReviewerAssetManifest } from "../packages/hosted-runtime/src/reviewer-assets.ts";
import { buildConcurrencyPolicy } from "../packages/hosted-runtime/src/concurrency.ts";
import { loadConcurrencyProof } from "../packages/hosted-runtime/src/concurrency-file.ts";
/** Guarded assessment operator entry point. No effect occurs without --execute and exact private release pins. */
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, lstat, readdir } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { sourceIdentity } from "../packages/hosted-runtime/src/source-identity.ts";
import {
  STAGING_REGION,
  BOOTSTRAP_QUALIFIER,
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
const capacity = buildConcurrencyPolicy(process.env);
const required = [
  "PRISM_EXPECTED_ACCOUNT_ID",
  "PRISM_EXPECTED_OPERATOR_ROLE_ARN",
  "PRISM_EXPECTED_HEAD",
  "PRISM_EXPECTED_TREE",
  "PRISM_EXPECTED_ARCHIVE_SHA256",
  "PRISM_DEPLOY_ASSET_BUCKET",
  "PRISM_PRIVATE_OPERATIONS_DIR",
  "PRISM_AWS_ACTUAL_USD",
  "PRISM_AWS_PENDING_USD",
  "PRISM_PROJECT_ACTUAL_USD",
  "PRISM_PROJECT_PENDING_USD",
  ...(capacity.mode === "existing-account-shared"
    ? [
        ...(action === "deploy" ? ["PRISM_ACCOUNT_CONCURRENCY_PROOF"] : []),
        "PRISM_SHARED_ACCOUNT_OPERATION_LIMIT",
      ]
    : []),
  ...(action === "deploy" ? ["PRISM_SNAPSHOT_DIR"] : []),
];
if (!execute) {
  console.log(
    JSON.stringify(
      {
        mode: "dry_run",
        action,
        stage: STAGING_STAGE,
        region: STAGING_REGION,
        capacity,
        memoryMiB: 3008,
        missing: required.filter((k) => !process.env[k]),
        source: sourceIdentity(),
        approvedPublicManifestSha256: APPROVED_PUBLIC_MANIFEST_SHA256,
        approvedPrivateManifestSha256: APPROVED_PRIVATE_MANIFEST_SHA256,
        assetStrategy:
          "Standard task-qualified CDK bootstrap; exact measured ZIP asset; DefaultStackSynthesizer and cdk deploy",
        steps:
          action === "deploy"
            ? [
                "Verify clean source, measured staging ZIP and exact public/private artifacts",
                "Verify caller account, frozen region, budget and private asset bucket",
                "Verify the exact task-qualified CDK bootstrap asset bucket",
                "Synthesize with no lookups; publish exact assets and deploy through CDK CLI",
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
  throw new Error("Explicit assessment cloud execution approval required");
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
  assetPrefix: "",
  stackName: "PrismOracleAssessmentReview",
});
assertPinnedSource(pins, sourceIdentity());
const capacityProof =
  capacity.mode === "existing-account-shared" && action === "deploy"
    ? await loadConcurrencyProof(
        get("PRISM_ACCOUNT_CONCURRENCY_PROOF"),
        pins.expectedAccountId,
        [process.cwd(), path.resolve(process.cwd(), "../../return")],
      )
    : null;
const sharedOperationLimit =
  capacity.mode === "existing-account-shared"
    ? Number(get("PRISM_SHARED_ACCOUNT_OPERATION_LIMIT"))
    : null;
if (
  sharedOperationLimit !== null &&
  (!Number.isInteger(sharedOperationLimit) ||
    sharedOperationLimit < 1 ||
    sharedOperationLimit > 100)
)
  throw new Error(
    "Shared mode requires a manual finite1..100 AWS-operation envelope",
  );
const costs = {
  awsActual: Number(get("PRISM_AWS_ACTUAL_USD")),
  awsPending: Number(get("PRISM_AWS_PENDING_USD")),
  totalActual: Number(get("PRISM_PROJECT_ACTUAL_USD")),
  totalPending: Number(get("PRISM_PROJECT_PENDING_USD")),
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
  process.env.PRISM_FRONTEND_ASSET_MANIFEST_SHA256 =
    await writeReviewerAssetManifest("dist", report.identity.buildId);
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
const features = reviewedDeploymentFeatures(process.env);
const deploymentConfig = {
  ...features,
  pins,
  capacity,
  capacityProof,
  memoryMiB: 3008,
  sharedOperationLimit,
  frontendDigest,
  protected: process.env.PRISM_PRIVATE_OPERATIONAL_DIR
    ? pins.privateManifestSha256
    : null,
  mcpAllowedOrigins: process.env.PRISM_MCP_ALLOWED_ORIGINS ?? "",
  crmMapOrigin: process.env.PRISM_CRM_MAP_ORIGIN ?? null,
  mapKeyExpiresAt: process.env.PRISM_MAP_KEY_EXPIRES_AT ?? null,
  bootstrapQualifier: BOOTSTRAP_QUALIFIER,
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
  awsOperations?: number;
  dataPrestage?: Awaited<ReturnType<typeof prestageReviewedUpdate>>;
  dataActivation?:
    | "not_activated"
    | "prestage_verified"
    | "first_create_post_provision_verified";
  cdkInvocations?: number;
} = { version: 1, action, steps: [], status: "started", awsOperations: 0 };
try {
  receipt = JSON.parse(await readFile(receiptFile, "utf8")) as typeof receipt;
} catch (e) {
  if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
}
const save = async () =>
  writeFile(receiptFile, JSON.stringify(receipt, null, 2) + "\n", {
    mode: 0o600,
  });
class MissingTaskStackError extends Error {}
function aws(args: string[], input?: string) {
  if (
    sharedOperationLimit !== null &&
    (receipt.awsOperations ?? 0) >= sharedOperationLimit
  )
    throw new Error("Finite shared CLI-invocation envelope exhausted");
  receipt.awsOperations = (receipt.awsOperations ?? 0) + 1;
  writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + "\n", {
    mode: 0o600,
  });
  let missingTaskStack: boolean;
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
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr)
        : "";
    writeFileSync(
      path.join(operations, `aws-failure-${receipt.awsOperations}.private.log`),
      stderr,
      { mode: 0o600 },
    );
    missingTaskStack =
      args[0] === "cloudformation" &&
      args[1] === "describe-stacks" &&
      /ValidationError[\s\S]*does not exist/.test(stderr);
  }
  // Detailed provider errors are retained privately, never attached to a public
  // uncaught error cause that could print credentials or private arguments.
  if (missingTaskStack)
    throw new MissingTaskStackError("Exact task stack does not exist");
  throw new Error(
    `AWS ${args[0]}/${args[1]} failed; private provider output retained`,
  );
}
const account = JSON.parse(
  aws(["sts", "get-caller-identity", "--output", "json"]),
) as { Account?: string; Arn?: string };
assertCallerAccount(pins, account.Account ?? "");
assertOperatorIdentity(
  pins.expectedAccountId,
  get("PRISM_EXPECTED_OPERATOR_ROLE_ARN"),
  account,
);
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
    o.ContractSha256 !== report.identity.contractSha256 ||
    o.ConcurrencyMode !== capacity.mode ||
    o.FunctionReservedConcurrency !==
      (capacity.reservedConcurrentExecutions === null
        ? "none"
        : String(capacity.reservedConcurrentExecutions)) ||
    o.FunctionMemoryMiB !== String(3008) ||
    o.ExistingAccountConcurrency !==
      (capacity.existingAccountConcurrency === null ? "not-used" : "10") ||
    o.ApiRatePerSecond !== String(capacity.apiRatePerSecond) ||
    o.ApiBurst !== String(capacity.apiBurst) ||
    (capacityProof !== null &&
      o.ConcurrencyProofSha256 !== capacityProof.sha256)
  )
    throw new Error("Deployed stack does not match the exact approved release");
  if (
    !/^PrismOracleAssessmentReview-ReadApiB934CF2C-[A-Za-z0-9]+$/.test(
      o.RuntimeFunctionName ?? "",
    ) ||
    !/^[a-z0-9]{1,20}$/.test(o.HttpApiId ?? "") ||
    o.HttpApiStageName !== "$default"
  )
    throw new Error("Exact task runtime/API output binding missing");
  const actualFunction = JSON.parse(
    aws([
      "lambda",
      "get-function-configuration",
      "--function-name",
      o.RuntimeFunctionName!,
    ]),
  );
  const actualReservation = parseFunctionConcurrencyOutput(
    aws([
      "lambda",
      "get-function-concurrency",
      "--function-name",
      o.RuntimeFunctionName!,
      "--output",
      "json",
    ]),
  );
  const actualStage = JSON.parse(
    aws([
      "apigatewayv2",
      "get-stage",
      "--api-id",
      o.HttpApiId!,
      "--stage-name",
      "$default",
    ]),
  );
  if (
    actualFunction.FunctionArn !==
      `arn:aws:lambda:${pins.region}:${pins.expectedAccountId}:function:${o.RuntimeFunctionName}` ||
    actualFunction.MemorySize !== 3008 ||
    (actualReservation.ReservedConcurrentExecutions ?? null) !==
      capacity.reservedConcurrentExecutions ||
    actualStage.StageName !== "$default" ||
    actualStage.DefaultRouteSettings?.ThrottlingRateLimit !==
      capacity.apiRatePerSecond ||
    actualStage.DefaultRouteSettings?.ThrottlingBurstLimit !== capacity.apiBurst
  )
    throw new Error("Actual runtime capacity differs from reviewed release");
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
      throw new Error(
        "Public artifact differs from the exact accepted immutable bytes",
      );
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
        throw new Error(
          "Protected manifest differs from the exact reviewed bytes",
        );
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
    if (location.LocationConstraint !== pins.region)
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
    // Existing-stack updates must verify exact immutable data before the stack can activate new prefixes.
    // A missing stack/bucket is a separate reviewed first-create/bootstrap flow; never claim it was pre-staged.
    receipt.dataActivation = "not_activated";
    await save();
    let existing: ExistingStackBindings | undefined;
    try {
      existing = {
        outputs: outputs(),
        resources: (
          JSON.parse(
            aws([
              "cloudformation",
              "describe-stack-resources",
              "--stack-name",
              pins.stackName,
              "--output",
              "json",
            ]),
          ) as { StackResources: ExistingStackBindings["resources"] }
        ).StackResources,
      };
    } catch (error) {
      if (!(error instanceof MissingTaskStackError)) throw error;
      if (process.env.PRISM_FIRST_CREATE_APPROVED !== "yes")
        throw new Error(
          "First creation requires the explicit neutral assessment-stack acknowledgment",
          { cause: error },
        );
    }
    const uploadVerifiedData = async (bindings: ExistingStackBindings) =>
      prestageReviewedUpdate({
        existing: bindings,
        expectedAccountId: pins.expectedAccountId,
        snapshotId: verified.manifest.snapshotId,
        public: {
          directory: verified.directory,
          manifestName: "artifact-manifest.json",
          manifestSha256: pins.publicManifestSha256,
          files: verified.manifest.files,
        },
        ...(privateInput
          ? {
              protected: {
                directory: privateInput.directory,
                manifestName: "private-operational-manifest.json" as const,
                manifestSha256: pins.privateManifestSha256!,
                files: privateInput.manifest.files,
              },
            }
          : {}),
        command: (args) => JSON.parse(aws(args)),
      });
    const context = {
      deploymentRegion: pins.region,
      deploymentAccount: pins.expectedAccountId,
      stage: pins.stage,
      concurrencyMode: capacity.mode,
      existingAccountConcurrency:
        capacity.existingAccountConcurrency === null
          ? ""
          : String(capacity.existingAccountConcurrency),
      snapshotManifestSha256: pins.publicManifestSha256,
      snapshotPrefix: `accepted/${verified.manifest.snapshotId}/`,
      ...deploymentFeatureContext(features),
      ...(privateInput
        ? {
            enableProtectedView: "true",
            privateManifestSha256: pins.privateManifestSha256,
            privateSnapshotPrefix: `operational/${verified.manifest.snapshotId}/${pins.privateManifestSha256}/`,
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
    const deploy = async () =>
      step("stack_deployed", async () => {
        receipt.cdkInvocations = (receipt.cdkInvocations ?? 0) + 1;
        if (receipt.cdkInvocations > 3)
          throw new Error("Finite CDK invocation envelope exhausted");
        await save();
        await deployWithCdk(pins, operations);
      });
    const activation = await reviewedDeployment({
      existing,
      firstCreateApproved: process.env.PRISM_FIRST_CREATE_APPROVED === "yes",
      prestage: uploadVerifiedData,
      deploy,
      describeCreated: async () => ({
        outputs: outputs(),
        resources: (
          JSON.parse(
            aws([
              "cloudformation",
              "describe-stack-resources",
              "--stack-name",
              pins.stackName,
              "--output",
              "json",
            ]),
          ) as { StackResources: ExistingStackBindings["resources"] }
        ).StackResources,
      }),
    });
    receipt.dataPrestage = activation.proof;
    receipt.dataActivation = activation.activation;
    await save();
    const o = outputs();
    assertDeployed(o);
    for (const key of ["SnapshotBucket", "StaticBucket", "DistributionId"])
      if (!o[key]) throw new Error("Task deployment outputs incomplete");
    // Existing updates pre-stage data; first creation verifies uploads before releasing access.
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
        "/release-identity.json",
        "/assessment-asset-manifest.json",
        "/assessment-publication-manifest.json",
        "/assessment-gateway-proof.json",
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
        capacity,
        capacityProof,
        sharedOperationLimit,
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
              publicSnapshotId: "oakland-real-ad414e5e71b11e3359ab",
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
          concurrency: {
            mode: o.ConcurrencyMode,
            reserved: o.FunctionReservedConcurrency,
            sharedPool: o.ExistingAccountConcurrency,
            proofSha256: o.ConcurrencyProofSha256,
            memoryMiB: o.FunctionMemoryMiB,
            apiRatePerSecond: o.ApiRatePerSecond,
            apiBurst: o.ApiBurst,
          },
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
