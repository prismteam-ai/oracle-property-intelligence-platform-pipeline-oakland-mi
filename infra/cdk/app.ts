import { loadConcurrencyProof } from "../../packages/hosted-runtime/src/concurrency-file.ts";
import path from "node:path";
import { buildConcurrencyPolicy } from "../../packages/hosted-runtime/src/concurrency.ts";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  STAGING_REGION,
  validatedRegion,
  APPROVED_PUBLIC_MANIFEST_SHA256,
  APPROVED_PRIVATE_MANIFEST_SHA256,
  type RuntimeIdentity,
} from "../../packages/hosted-runtime/src/release.ts";
import { CfnAPIKey } from "aws-cdk-lib/aws-location";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import {
  App,
  Stack,
  CfnOutput,
  Tags,
  RemovalPolicy,
  Duration,
  Size,
  BootstraplessSynthesizer,
} from "aws-cdk-lib";
import { Runtime, Function, Code, Architecture } from "aws-cdk-lib/aws-lambda";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import {
  Bucket,
  BlockPublicAccess,
  BucketEncryption,
} from "aws-cdk-lib/aws-s3";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Table, AttributeType, BillingMode } from "aws-cdk-lib/aws-dynamodb";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import {
  Distribution,
  ViewerProtocolPolicy,
  CachePolicy,
  AllowedMethods,
  OriginRequestPolicy,
  ResponseHeadersPolicy,
  PriceClass,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin, HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  ComparisonOperator,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
const app = new App({ outdir: process.env.CDK_OUTDIR ?? "cdk.out" });
const region = validatedRegion(
  String(
    app.node.tryGetContext("deploymentRegion") ??
      process.env.PRISM_DEPLOY_REGION ??
      STAGING_REGION,
  ),
  [process.env.AWS_REGION, process.env.AWS_DEFAULT_REGION],
);
const capacity = buildConcurrencyPolicy({
  ...process.env,
  PRISM_CONCURRENCY_MODE: String(
    app.node.tryGetContext("concurrencyMode") ??
      process.env.PRISM_CONCURRENCY_MODE ??
      "reserved",
  ),
  PRISM_EXISTING_ACCOUNT_CONCURRENCY: String(
    app.node.tryGetContext("existingAccountConcurrency") ??
      process.env.PRISM_EXISTING_ACCOUNT_CONCURRENCY ??
      "",
  ),
});
// Retain the memory size already verified in this new Free-plan account.
const memoryMiB = 3008;
const stage = String(
  app.node.tryGetContext("stage") ?? process.env.PRISM_RELEASE_STAGE ?? "local",
);
if (!["local", "p3-review"].includes(stage))
  throw new Error("Unrecognized deployment stage");
const account =
  app.node.tryGetContext("deploymentAccount") ??
  process.env.PRISM_EXPECTED_ACCOUNT_ID;
if (account !== undefined && !/^\d{12}$/.test(String(account)))
  throw new Error("Exact account context required");
const capacityProof =
  capacity.mode === "existing-account-shared"
    ? await loadConcurrencyProof(
        process.env.PRISM_ACCOUNT_CONCURRENCY_PROOF ?? "",
        String(account ?? ""),
        [process.cwd(), path.resolve(process.cwd(), "../../return")],
      )
    : null;
const archive = readFileSync("oracle-lambda.zip"),
  archiveDigest = createHash("sha256").update(archive).digest("hex"),
  report = JSON.parse(
    readFileSync("dist-lambda/package-report.json", "utf8"),
  ) as { zipSha256: string; identity: RuntimeIdentity };
if (report.zipSha256 !== archiveDigest)
  throw new Error("Measured Lambda ZIP changed before synthesis");
if (
  stage === "p3-review" &&
  (report.identity?.stage !== stage ||
    report.identity?.region !== region ||
    report.identity?.sourceDirty ||
    !account)
)
  throw new Error(
    "Staging synthesis requires a clean measured staging build and private account pin",
  );
const assetBucketName = String(
    app.node.tryGetContext("deploymentAssetBucket") ??
      process.env.PRISM_DEPLOY_ASSET_BUCKET ??
      "prism-p3-local-synth-assets",
  ),
  assetPrefix = String(
    app.node.tryGetContext("deploymentAssetPrefix") ?? "prism-p3/oracle/",
  );
if (
  assetPrefix !== "prism-p3/oracle/" ||
  !/^prism-p3-[a-z0-9][a-z0-9.-]{1,52}[a-z0-9]$/.test(assetBucketName)
)
  throw new Error("Exact task asset namespace required");
const stack = new Stack(app, "PrismOracleReview", {
  env: { region, ...(account ? { account: String(account) } : {}) },
  synthesizer: new BootstraplessSynthesizer(),
  description:
    "P3 bounded evaluator read plane; deployment status is verified through hosted evidence",
});
Tags.of(stack).add("Project", "prism-assessment");
Tags.of(stack).add("Phase", "P3");
Tags.of(stack).add("Stage", stage);
Tags.of(stack).add("Retention", "human-reviewed-14-day-window");
const prefix = String(
    app.node.tryGetContext("snapshotPrefix") ??
      "accepted/oakland-real-e08111dc398302e141d3/",
  ),
  manifestDigest = String(
    app.node.tryGetContext("snapshotManifestSha256") ??
      APPROVED_PUBLIC_MANIFEST_SHA256,
  );
if (
  prefix !== "accepted/oakland-real-e08111dc398302e141d3/" ||
  manifestDigest !== APPROVED_PUBLIC_MANIFEST_SHA256
)
  throw new Error(
    "P4 requires the exact independently verified refreshed public baseline",
  );
const assetBucket = Bucket.fromBucketName(
  stack,
  "ExplicitDeploymentAssets",
  assetBucketName,
);
const site = new Bucket(stack, "StaticSite", {
  blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  encryption: BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  removalPolicy: RemovalPolicy.RETAIN,
});
const enablePrivate = app.node.tryGetContext("enableProtectedView") === "true",
  privatePrefix = String(
    app.node.tryGetContext("privateSnapshotPrefix") ??
      `operational/oakland-real-e08111dc398302e141d3/${APPROVED_PRIVATE_MANIFEST_SHA256}/`,
  ),
  privateDigest = String(app.node.tryGetContext("privateManifestSha256") ?? "");
if (
  enablePrivate &&
  (privatePrefix !==
    `operational/oakland-real-e08111dc398302e141d3/${APPROVED_PRIVATE_MANIFEST_SHA256}/` ||
    !/^[a-f0-9]{64}$/.test(privateDigest) ||
    privateDigest !== APPROVED_PRIVATE_MANIFEST_SHA256)
)
  throw new Error(
    "Protected deployment requires an exact approved private manifest digest/prefix",
  );
const privateSnapshots = enablePrivate
  ? new Bucket(stack, "ProtectedOperationalSnapshots", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    })
  : undefined;
const snapshots = new Bucket(stack, "AcceptedSnapshots", {
  blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  encryption: BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  versioned: true,
  removalPolicy: RemovalPolicy.RETAIN,
});
const table = new Table(stack, "ReviewState", {
  partitionKey: { name: "pk", type: AttributeType.STRING },
  sortKey: { name: "sk", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: "expiresAt",
  pointInTimeRecoverySpecification: {
    pointInTimeRecoveryEnabled: true,
    recoveryPeriodInDays: 14,
  },
  removalPolicy: RemovalPolicy.RETAIN,
});
const access = new Secret(stack, "ReviewAccess", {
  description:
    "Populate with signingKey,reviewCodeDigest,keyVersion,sessionTtlSeconds after deployment via approved secure operator flow",
  generateSecretString: {
    secretStringTemplate: JSON.stringify({
      keyVersion: "unconfigured",
      reviewCodeDigest: "0".repeat(64),
      sessionTtlSeconds: 3600,
    }),
    generateStringKey: "signingKey",
    passwordLength: 64,
    excludePunctuation: true,
  },
});
access.applyRemovalPolicy(RemovalPolicy.RETAIN);
const logs = new LogGroup(stack, "ApiLogs", {
  retention: RetentionDays.TWO_WEEKS,
  removalPolicy: RemovalPolicy.RETAIN,
});
const runtimeRole = new Role(stack, "ReadApiRole", {
  assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
});
logs.grantWrite(runtimeRole);
const handler = new Function(stack, "ReadApi", {
  runtime: Runtime.NODEJS_24_X,
  architecture: Architecture.X86_64,
  handler: "index.handler",
  code: Code.fromBucket(
    assetBucket,
    `${assetPrefix}lambda/${archiveDigest}.zip`,
  ),
  role: runtimeRole,
  memorySize: memoryMiB,
  ephemeralStorageSize: Size.gibibytes(4),
  timeout: Duration.seconds(29),
  ...(capacity.reservedConcurrentExecutions === null
    ? {}
    : { reservedConcurrentExecutions: capacity.reservedConcurrentExecutions }),
  logGroup: logs,
  environment: {
    PRISM_DATA_MODE: "real",
    PRISM_SNAPSHOT_BUCKET: snapshots.bucketName,
    PRISM_SNAPSHOT_PREFIX: prefix,
    PRISM_SNAPSHOT_MANIFEST_SHA256: manifestDigest,
    PRISM_ACCESS_SECRET_ARN: access.secretArn,
    PRISM_QUOTA_TABLE: table.tableName,
    PRISM_BUILD_ID: report.identity.buildId,
    PRISM_LAMBDA_ARCHIVE_SHA256: archiveDigest,
    PRISM_FRONTEND_ASSET_MANIFEST_SHA256:
      process.env.PRISM_FRONTEND_ASSET_MANIFEST_SHA256 ?? "unbuilt-local",
    PRISM_DEPLOY_REGION: region,
    PRISM_RELEASE_STAGE: stage,
    PRISM_MCP_ALLOWED_ORIGINS: String(
      app.node.tryGetContext("mcpAllowedOrigins") ?? "",
    ),
    MODEL_INFERENCE: "disabled",
    ...(privateSnapshots
      ? {
          PRISM_ENABLE_PROTECTED_VIEW: "1",
          PRISM_PRIVATE_SNAPSHOT_BUCKET: privateSnapshots.bucketName,
          PRISM_PRIVATE_SNAPSHOT_PREFIX: privatePrefix,
          PRISM_PRIVATE_SNAPSHOT_MANIFEST_SHA256: privateDigest,
        }
      : {}),
  },
});
// Prefix-only read; the runtime cannot enumerate, write or delete accepted snapshots.
handler.addToRolePolicy(
  new PolicyStatement({
    actions: ["s3:GetObject"],
    resources: [snapshots.arnForObjects(`${prefix}*`)],
  }),
);
access.grantRead(handler);
if (privateSnapshots)
  handler.addToRolePolicy(
    new PolicyStatement({
      actions: ["s3:GetObject"],
      resources: [privateSnapshots.arnForObjects(`${privatePrefix}*`)],
    }),
  );
handler.addToRolePolicy(
  new PolicyStatement({
    actions: [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:UpdateItem",
    ],
    resources: [table.tableArn],
    conditions: {
      "ForAllValues:StringLike": {
        "dynamodb:LeadingKeys": ["session#*", "quota#*"],
      },
    },
  }),
);
const api = new HttpApi(stack, "HttpReadApi", {
  defaultIntegration: new HttpLambdaIntegration("ReadIntegration", handler),
  createDefaultStage: true,
});
const apiStage = api.defaultStage!.node
  .defaultChild as import("aws-cdk-lib/aws-apigatewayv2").CfnStage;
apiStage.defaultRouteSettings = {
  throttlingBurstLimit: capacity.apiBurst,
  throttlingRateLimit: capacity.apiRatePerSecond,
};
const cdn = new Distribution(stack, "ReviewSite", {
  defaultRootObject: "index.html",
  priceClass: PriceClass.PRICE_CLASS_100,
  defaultBehavior: {
    origin: S3BucketOrigin.withOriginAccessControl(site),
    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    responseHeadersPolicy: ResponseHeadersPolicy.SECURITY_HEADERS,
    cachePolicy: CachePolicy.CACHING_OPTIMIZED,
  },
  additionalBehaviors: {
    "/api/*": {
      origin: new HttpOrigin(
        `${api.httpApiId}.execute-api.${stack.region}.${stack.urlSuffix}`,
      ),
      viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: AllowedMethods.ALLOW_ALL,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      responseHeadersPolicy: ResponseHeadersPolicy.SECURITY_HEADERS,
    },
  },
});
const enableMap = app.node.tryGetContext("enableLocationMap") === "true";
if (enableMap) {
  const origin = String(app.node.tryGetContext("crmMapOrigin") ?? ""),
    expires = String(app.node.tryGetContext("mapKeyExpiresAt") ?? "");
  if (
    !/^https:\/\/d[a-z0-9]+\.cloudfront\.net$/.test(origin) ||
    !Number.isFinite(Date.parse(expires)) ||
    Date.parse(expires) <= Date.now() ||
    Date.parse(expires) > Date.now() + 14 * 86400000
  )
    throw new Error(
      "Map key requires the exact CRM CloudFront origin and finite <=14-day expiry",
    );
  const key = new CfnAPIKey(stack, "ReviewLocationBrowserKey", {
    keyName: "prism-p3-review-map",
    description: "Restricted P3 Standard map browser key; value stays private",
    expireTime: expires,
    restrictions: {
      allowActions: ["geo-maps:GetTile"],
      allowResources: [
        `arn:${stack.partition}:geo-maps:${region}::provider/default`,
      ],
      allowReferers: [`${origin}/*`],
    },
  });
  key.applyRemovalPolicy(RemovalPolicy.RETAIN);
  new CfnOutput(stack, "LocationMapKeyArn", { value: key.attrKeyArn });
  new CfnOutput(stack, "LocationMapKeyName", { value: "prism-p3-review-map" });
}
handler
  .metricErrors({ period: Duration.minutes(5) })
  .createAlarm(stack, "ApiErrors", {
    threshold: 5,
    evaluationPeriods: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });
handler
  .metricThrottles({ period: Duration.minutes(5) })
  .createAlarm(stack, "ApiThrottles", {
    threshold: 5,
    evaluationPeriods: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });
api
  .metricServerError({ period: Duration.minutes(5) })
  .createAlarm(stack, "HttpServerErrors", {
    threshold: 5,
    evaluationPeriods: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });
api
  .metricIntegrationLatency({ period: Duration.minutes(5), statistic: "p95" })
  .createAlarm(stack, "HttpLatency", {
    threshold: 25000,
    evaluationPeriods: 2,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });
new StringParameter(stack, "ReviewRetention", {
  stringValue:
    "Review resources retained for a 14-day evaluator window; extend while active; destroy requires explicit operator approval. Session1h, quota1day grace, logs14days.",
  description:
    "Human retention policy; no automatic deletion of active evaluator data",
});
new CfnOutput(stack, "DistributionId", { value: cdn.distributionId });
new CfnOutput(stack, "SiteUrl", {
  value: `https://${cdn.distributionDomainName}`,
});
new CfnOutput(stack, "Region", { value: region });
new CfnOutput(stack, "ConcurrencyMode", { value: capacity.mode });
new CfnOutput(stack, "ConcurrencyProofSha256", {
  value: capacityProof?.sha256 ?? "not_validated_local_or_reserved_mode",
});
new CfnOutput(stack, "ExistingAccountConcurrency", {
  value:
    capacity.existingAccountConcurrency === null
      ? "not-used"
      : String(capacity.existingAccountConcurrency),
});
new CfnOutput(stack, "FunctionReservedConcurrency", {
  value:
    capacity.reservedConcurrentExecutions === null
      ? "none"
      : String(capacity.reservedConcurrentExecutions),
});
new CfnOutput(stack, "FunctionMemoryMiB", { value: String(memoryMiB) });
new CfnOutput(stack, "ApiRatePerSecond", {
  value: String(capacity.apiRatePerSecond),
});
new CfnOutput(stack, "ApiBurst", { value: String(capacity.apiBurst) });
new CfnOutput(stack, "Stage", { value: stage });
new CfnOutput(stack, "ReleaseBuildId", { value: report.identity.buildId });
new CfnOutput(stack, "LambdaArchiveSha256", { value: archiveDigest });
new CfnOutput(stack, "SourceHead", { value: report.identity.head });
new CfnOutput(stack, "SourceTree", { value: report.identity.tree });
new CfnOutput(stack, "ContractSha256", {
  value: report.identity.contractSha256,
});
new CfnOutput(stack, "ApiUrl", { value: api.apiEndpoint });
new CfnOutput(stack, "StaticBucket", { value: site.bucketName });
new CfnOutput(stack, "SnapshotBucket", { value: snapshots.bucketName });
if (privateSnapshots)
  new CfnOutput(stack, "PrivateSnapshotBucket", {
    value: privateSnapshots.bucketName,
  });
new CfnOutput(stack, "AccessSecretArn", { value: access.secretArn });
new CfnOutput(stack, "ReviewTable", { value: table.tableName });
new CfnOutput(stack, "ReviewTableArn", { value: table.tableArn });

new CfnOutput(stack, "RuntimeFunctionName", { value: handler.functionName });
new CfnOutput(stack, "HttpApiId", { value: api.httpApiId });
new CfnOutput(stack, "HttpApiStageName", { value: "$default" });

app.synth();
