import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
execFileSync(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "infra/cdk/app.ts"],
  { stdio: "pipe" },
);
const t = JSON.parse(
  await readFile("cdk.out/PrismOracleReview.template.json", "utf8"),
) as {
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
assert(!("ZipFile" in (lambda.Code as object)));
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
    "Manifest digest is an all-zero sentinel in an unconfigured synth; gated deploy supplies the exact verified digest and accepted prefix.",
  ],
};
if (process.env.PRISM_CDK_EVIDENCE)
  await writeFile(
    process.env.PRISM_CDK_EVIDENCE,
    JSON.stringify(report, null, 2),
  );
console.log(JSON.stringify(report, null, 2));
