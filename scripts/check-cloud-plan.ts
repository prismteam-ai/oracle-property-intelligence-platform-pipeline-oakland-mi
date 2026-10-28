import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import assert from "node:assert/strict";
execFileSync(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "infra/cdk/app.ts"],
  { stdio: "pipe" },
);
const t = JSON.parse(
  await readFile("cdk.out/PrismOracleReview.template.json", "utf8"),
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
assert.equal(lambdas.length, 1);
const lambda = lambdas[0]![1].Properties!;
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
assert.deepEqual(lambda.Code, {
  S3Bucket: "prism-p3-local-synth-assets",
  S3Key: `prism-p3/oracle/lambda/${packageReport.zipSha256}.zip`,
});
assert(
  !Object.keys(t.Parameters ?? {}).some((p) => /BootstrapVersion/.test(p)),
);
assert(!entries.some(([, r]) => r.Type.startsWith("AWS::ECR::")));
for (const [k, v] of Object.entries({
  Region: "us-east-1",
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
assert.equal(of("AWS::DynamoDB::Table").length, 1);
assert.equal(of("AWS::SecretsManager::Secret").length, 1);
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
assert.equal(env.PRISM_DEPLOY_REGION, "us-east-1");
assert.equal(
  env.PRISM_SNAPSHOT_MANIFEST_SHA256,
  "0ea109aae29cb7739ec166cddbb36782c170ef18ce97ef3b525ca9d7e50e7422",
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
      ...process.env,
      CDK_OUTDIR: "data/cdk-protected-map-check",
      CDK_CONTEXT_JSON: JSON.stringify({
        enableProtectedView: "true",
        privateManifestSha256:
          "a2836c423fd90e665432e79138f7f2631c585f60dbbc1b3bc441f8d287353b98",
        enableLocationMap: "true",
        crmMapOrigin: "https://dfixture.cloudfront.net",
        mapKeyExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      }),
    },
  },
);
const optional = JSON.parse(
  await readFile(
    "data/cdk-protected-map-check/PrismOracleReview.template.json",
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
  (r) => r.Type === "AWS::Lambda::Function",
)!;
assert.equal(
  (
    protectedLambda.Properties!.Environment as {
      Variables: Record<string, string>;
    }
  ).Variables.PRISM_PRIVATE_SNAPSHOT_MANIFEST_SHA256,
  "a2836c423fd90e665432e79138f7f2631c585f60dbbc1b3bc441f8d287353b98",
);
assert.throws(() =>
  execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "infra/cdk/app.ts"],
    {
      stdio: "pipe",
      env: {
        ...process.env,
        CDK_CONTEXT_JSON: JSON.stringify({ deploymentRegion: "us-east-2" }),
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
    region: "us-east-1",
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
        ...process.env,
        CDK_OUTDIR: "data/cdk-shared-account-check",
        PRISM_CONCURRENCY_MODE: "existing-account-shared",
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
      "data/cdk-shared-account-check/PrismOracleReview.template.json",
      "utf8",
    ),
  ) as typeof t;
  const sharedFunction = Object.values(shared.Resources).find(
    (r) => r.Type === "AWS::Lambda::Function",
  )!.Properties!;
  assert(!Object.hasOwn(sharedFunction, "ReservedConcurrentExecutions"));
  assert.equal(sharedFunction.MemorySize, 3008);
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
    noBootstrapAssetsOrEcr: true,
    explicitMeasuredS3Archive: true,
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
    "Local synthesis uses a task-named placeholder asset bucket and no account pin; guarded staging deployment requires the exact private account/bucket and clean measured staging archive.",
  ],
};
if (process.env.PRISM_CDK_EVIDENCE)
  await writeFile(
    process.env.PRISM_CDK_EVIDENCE,
    JSON.stringify(report, null, 2),
  );
console.log(JSON.stringify(report, null, 2));
