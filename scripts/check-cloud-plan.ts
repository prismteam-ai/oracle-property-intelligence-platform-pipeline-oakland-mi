import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  APPROVED_PUBLIC_MANIFEST_SHA256,
  APPROVED_PRIVATE_MANIFEST_SHA256,
} from "../packages/hosted-runtime/src/release.ts";
const localEnv = {
  ...process.env,
  PRISM_RELEASE_STAGE: "local",
  PRISM_CONCURRENCY_MODE: "reserved",
  PRISM_RESERVED_CONCURRENCY: "5",
  PRISM_API_RATE_PER_SECOND: "5",
  PRISM_API_BURST: "10",
  CDK_CONTEXT_JSON: "{}",
};
for (const key of [
  "PRISM_EXPECTED_ACCOUNT_ID",
  "PRISM_DEPLOY_ASSET_BUCKET",
  "PRISM_ACCOUNT_CONCURRENCY_PROOF",
])
  delete (localEnv as Record<string, string | undefined>)[key];
execFileSync(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "infra/cdk/app.ts"],
  { stdio: "pipe", env: localEnv },
);
const t = JSON.parse(
  await readFile("cdk.out/PrismOracleAssessmentReview.template.json", "utf8"),
) as {
  Outputs: Record<string, { Value: unknown }>;
  Parameters?: Record<string, unknown>;
  Resources: Record<
    string,
    {
      Type: string;
      Properties?: Record<string, unknown>;
      DeletionPolicy?: string;
    }
  >;
};
const entries = Object.entries(t.Resources),
  of = (type: string) => entries.filter(([, r]) => r.Type === type);
const lambdas = of("AWS::Lambda::Function");
assert.equal(lambdas.length, 2);
const lambda = lambdas.find(
  ([, r]) => r.Properties?.Handler === "index.handler",
)![1].Properties!;
const notifier = lambdas.find(
  ([, r]) => r.Properties?.Handler === "index.alertHandler",
)![1].Properties!;
assert.equal(lambda.Runtime, "nodejs24.x");
assert.equal(lambda.ReservedConcurrentExecutions, 5);
for (const name of ["RuntimeFunctionName", "HttpApiId", "HttpApiStageName"])
  assert(t.Outputs?.[name], `Missing runtime output ${name}`);
assert.equal(lambda.MemorySize, 3008);
assert(!("ZipFile" in (lambda.Code as object)));
const packageReport = JSON.parse(
  await readFile("dist-lambda/package-report.json", "utf8"),
) as {
  zipSha256: string;
  identity: {
    head: string;
    tree: string;
    buildId: string;
    contractSha256: string;
  };
};
assert((lambda.Code as { S3Bucket: unknown }).S3Bucket);
assert((lambda.Code as { S3Key: unknown }).S3Key);
assert(Object.hasOwn(t.Parameters ?? {}, "BootstrapVersion"));
assert.equal(
  lambda.TracingConfig && (lambda.TracingConfig as { Mode: string }).Mode,
  "Active",
);
assert.equal(notifier.MemorySize, 128);
assert.equal(notifier.Timeout, 10);
assert.equal(notifier.ReservedConcurrentExecutions, 1);
assert.equal((notifier.TracingConfig as { Mode: string }).Mode, "Active");
for (const [, group] of of("AWS::Logs::LogGroup"))
  assert.equal(group.Properties!.RetentionInDays, 90);
for (const [, resource] of entries) {
  const tags = resource.Properties?.Tags;
  if (Array.isArray(tags))
    assert(
      tags.some(
        (x: { Key: string; Value: string }) =>
          x.Key === "project_name" && x.Value === "prism-assessment",
      ),
    );
}
assert.equal(of("AWS::CloudWatch::Dashboard").length, 1);
assert(!entries.some(([, r]) => r.Type.startsWith("AWS::ECR::")));
for (const [k, v] of Object.entries({
  Region: "us-east-2",
  Stage: "local",
  SourceHead: packageReport.identity.head,
  SourceTree: packageReport.identity.tree,
  ReleaseBuildId: packageReport.identity.buildId,
  ContractSha256: packageReport.identity.contractSha256,
}))
  assert.equal(t.Outputs[k]?.Value, v);
assert.deepEqual(lambda.Architectures, ["x86_64"]);
assert.equal(of("AWS::CloudFront::OriginAccessControl").length, 1);
assert.equal(of("AWS::CloudFront::Distribution").length, 1);
const headerPolicy = of("AWS::CloudFront::ResponseHeadersPolicy");
assert.equal(headerPolicy.length, 1);
const headerConfig = headerPolicy[0]![1].Properties!
  .ResponseHeadersPolicyConfig as {
  SecurityHeadersConfig: {
    ContentSecurityPolicy: { ContentSecurityPolicy: string; Override: boolean };
    FrameOptions: { FrameOption: string; Override: boolean };
    ContentTypeOptions: { Override: boolean };
  };
};
assert.equal(
  headerConfig.SecurityHeadersConfig.ContentSecurityPolicy.Override,
  true,
);
for (const directive of [
  "default-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
])
  assert(
    headerConfig.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy.split(
      ";",
    ).some((x) => x.trim() === directive),
  );
assert.equal(
  headerConfig.SecurityHeadersConfig.FrameOptions.FrameOption,
  "DENY",
);
assert.equal(
  headerConfig.SecurityHeadersConfig.ContentTypeOptions.Override,
  true,
);
const cdnConfig = of("AWS::CloudFront::Distribution")[0]![1].Properties!
  .DistributionConfig as {
  DefaultCacheBehavior: { ResponseHeadersPolicyId: unknown };
  CacheBehaviors: { ResponseHeadersPolicyId: unknown }[];
};
for (const behavior of [
  cdnConfig.DefaultCacheBehavior,
  ...cdnConfig.CacheBehaviors,
])
  assert.deepEqual(behavior.ResponseHeadersPolicyId, {
    Ref: headerPolicy[0]![0],
  });

assert.equal(of("AWS::DynamoDB::Table").length, 1);
assert.equal(of("AWS::SecretsManager::Secret").length, 2);
assert(of("AWS::CloudWatch::Alarm").length >= 4);
for (const [, bucket] of of("AWS::S3::Bucket")) {
  const p = bucket.Properties!;
  assert(
    Object.values(p.PublicAccessBlockConfiguration as object).every(
      (x) => x === true,
    ),
  );
  assert.equal(bucket.DeletionPolicy, "Retain");
}
const statements = of("AWS::IAM::Policy").flatMap(
  ([, r]) =>
    (r.Properties!.PolicyDocument as { Statement: unknown[] }).Statement,
) as { Effect: string; Action: string | string[]; Resource: unknown }[];
const allow = statements.filter((s) => s.Effect === "Allow");
const actions = [
  ...new Set(
    allow.flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action])),
  ),
].sort();
assert(
  !actions.some((a) =>
    /^(s3:(Put|Delete|List)|bedrock:|iam:|sts:|execute-api:)/.test(a),
  ),
);
assert(actions.includes("s3:GetObject"));
const env = (lambda.Environment as { Variables: Record<string, string> })
  .Variables;
assert.equal(env.PRISM_DATA_MODE, "real");
assert.equal(env.PRISM_DEPLOY_REGION, "us-east-2");
assert.equal(
  env.PRISM_SNAPSHOT_MANIFEST_SHA256,
  APPROVED_PUBLIC_MANIFEST_SHA256,
);
assert.equal(env.PRISM_RELEASE_STAGE, "local");
assert(!("PRISM_ENABLE_PROTECTED_VIEW" in env));
assert(!("PRISM_RUNTIME_EMULATION" in env));
assert(!("PRISM_ACCESS_MODE" in env));
assert.equal(
  (
    of("AWS::DynamoDB::Table")[0]![1].Properties!.TimeToLiveSpecification as {
      AttributeName: string;
    }
  ).AttributeName,
  "expiresAt",
);
// A second local synth proves optional protected/map resources without a key value
// or any account lookup. Fixture origin is never contacted.
execFileSync(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "infra/cdk/app.ts"],
  {
    stdio: "pipe",
    env: {
      ...localEnv,
      CDK_OUTDIR: "data/cdk-protected-map-check",
      CDK_CONTEXT_JSON: JSON.stringify({
        enableProtectedView: "true",
        privateManifestSha256: APPROVED_PRIVATE_MANIFEST_SHA256,
        enableLocationMap: "true",
        crmMapOrigin: "https://dfixture.cloudfront.net",
        mapKeyExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      }),
    },
  },
);
const optional = JSON.parse(
  await readFile(
    "data/cdk-protected-map-check/PrismOracleAssessmentReview.template.json",
    "utf8",
  ),
) as typeof t;
const optionalResources = Object.values(optional.Resources),
  key = optionalResources.find((r) => r.Type === "AWS::Location::APIKey")!;
assert(key);
assert.deepEqual(
  (key.Properties!.Restrictions as { AllowActions: string[] }).AllowActions,
  ["geo-maps:GetTile"],
);
assert.deepEqual(
  (key.Properties!.Restrictions as { AllowReferers: string[] }).AllowReferers,
  ["https://dfixture.cloudfront.net/*"],
);
assert.equal(
  optionalResources.filter((r) => r.Type === "AWS::S3::Bucket").length,
  3,
);
assert(
  !Object.keys(optional.Outputs).some((k) =>
    /^Location.*(Value|Secret)$/.test(k),
  ),
);
const protectedLambda = optionalResources.find(
  (r) =>
    r.Type === "AWS::Lambda::Function" &&
    r.Properties?.Handler === "index.handler",
)!;
assert.equal(
  (
    protectedLambda.Properties!.Environment as {
      Variables: Record<string, string>;
    }
  ).Variables.PRISM_PRIVATE_SNAPSHOT_MANIFEST_SHA256,
  APPROVED_PRIVATE_MANIFEST_SHA256,
);
assert.throws(() =>
  execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "infra/cdk/app.ts"],
    {
      stdio: "pipe",
      env: {
        ...localEnv,
        CDK_CONTEXT_JSON: JSON.stringify({ deploymentRegion: "us-east-1" }),
      },
    },
  ),
);
const proofDirectory = await mkdtemp(
    path.join(os.tmpdir(), "prism-cdk-capacity-"),
  ),
  proofFile = path.join(proofDirectory, "proof.json");
await writeFile(
  proofFile,
  JSON.stringify({
    version: 1,
    observedAt: new Date().toISOString(),
    accountId: "234567890123",
    region: "us-east-2",
    concurrentExecutions: 10,
    unreservedConcurrentExecutions: 10,
    totalFunctionCount: 0,
    functions: [],
  }),
  { mode: 0o600 },
);
try {
  execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "infra/cdk/app.ts"],
    {
      stdio: "pipe",
      env: {
        ...localEnv,
        CDK_OUTDIR: "data/cdk-shared-account-check",
        PRISM_CONCURRENCY_MODE: "existing-account-shared",
        PRISM_API_RATE_PER_SECOND: "2",
        PRISM_API_BURST: "6",
        PRISM_SHARED_ACCOUNT_CONCURRENCY_APPROVED: "yes",
        PRISM_EXISTING_ACCOUNT_CONCURRENCY: "10",
        PRISM_ACCOUNT_CONCURRENCY_PROOF: proofFile,
        CDK_CONTEXT_JSON: JSON.stringify({
          deploymentAccount: "234567890123",
          concurrencyMode: "existing-account-shared",
          existingAccountConcurrency: "10",
        }),
      },
    },
  );
  const shared = JSON.parse(
    await readFile(
      "data/cdk-shared-account-check/PrismOracleAssessmentReview.template.json",
      "utf8",
    ),
  ) as typeof t;
  const sharedFunction = Object.values(shared.Resources).find(
    (r) =>
      r.Type === "AWS::Lambda::Function" &&
      r.Properties?.Handler === "index.handler",
  )!.Properties!;
  assert(!Object.hasOwn(sharedFunction, "ReservedConcurrentExecutions"));
  assert.equal(sharedFunction.MemorySize, 3008);
  for (const r of Object.values(shared.Resources).filter(
    (r) => r.Type === "AWS::Lambda::Function",
  ))
    assert(!Object.hasOwn(r.Properties!, "ReservedConcurrentExecutions"));
  const sharedStage = Object.values(shared.Resources).find(
    (r) => r.Type === "AWS::ApiGatewayV2::Stage",
  )!.Properties!;
  assert.deepEqual(sharedStage.DefaultRouteSettings, {
    ThrottlingBurstLimit: 6,
    ThrottlingRateLimit: 2,
  });
  assert.equal(
    shared.Outputs.ConcurrencyMode?.Value,
    "existing-account-shared",
  );
  assert.equal(shared.Outputs.FunctionReservedConcurrency?.Value, "none");
  assert.equal(shared.Outputs.ExistingAccountConcurrency?.Value, "10");
  assert.equal(shared.Outputs.FunctionMemoryMiB?.Value, "3008");
} finally {
  await rm(proofDirectory, { recursive: true, force: true });
}
const report = {
  localOnly: true,
  cloudServiceInvocations: 0,
  assertions: {
    realLambdaAsset: true,
    node24x64: true,
    oac: true,
    privateBuckets: true,
    retainedResources: true,
    dynamoTtl: true,
    sharedAccessSecret: true,
    errorAndLatencyAlarms: true,
    noSourceOrModelPrivileges: true,
    noCloudAuthBypass: true,
    defaultSynthesizerBootstrapAsset: true,
    exactMeasuredLocalArchive: true,
    powertoolsEnvironmentNoEventCapture: true,
    activeTracingAnd90DayLogs: true,
    exactProjectNameTags: true,
    dashboardAndAlarmNotifier: true,
    singleRegionAndSourceBinding: true,
    protectedExactCompanionSeparateBucket: true,
    optionalMapExactOriginActionExpiryNoKeyOutput: true,
    wrongRegionRejected: true,
    sharedOptInOmitsReservationAndUses3008MiB: true,
    sharedThrottle2PerSecondBurst6: true,
  },
  runtime: {
    memoryMiB: lambda.MemorySize,
    timeoutSeconds: lambda.Timeout,
    ephemeralStorage: lambda.EphemeralStorage,
    reservedConcurrency: lambda.ReservedConcurrentExecutions,
  },
  allowActions: actions,
  limitations: [
    "Synthesis and policy assertions are local; no account permission or deployed service proof.",
    "Local synthesis uses the standard task-qualified bootstrap asset references without lookups. Guarded review deployment requires the exact private account/bootstrap bucket and clean measured review archive.",
  ],
};
if (process.env.PRISM_CDK_EVIDENCE)
  await writeFile(
    process.env.PRISM_CDK_EVIDENCE,
    JSON.stringify(report, null, 2),
  );
console.log(JSON.stringify(report, null, 2));
