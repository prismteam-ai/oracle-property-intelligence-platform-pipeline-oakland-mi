import {
  App,
  Stack,
  CfnOutput,
  Tags,
  RemovalPolicy,
  Duration,
  Size,
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
const app = new App({ outdir: process.env.CDK_OUTDIR ?? "cdk.out" }),
  stack = new Stack(app, "PrismOracleReview", {
    env: { region: "us-east-2" },
    description:
      "P2 evaluator read plane; local synth only until separately authorized deployment",
  });
Tags.of(stack).add("Project", "prism-assessment");
Tags.of(stack).add("Stage", "review");
Tags.of(stack).add("Retention", "human-reviewed-14-day-window");
const prefix = String(
    app.node.tryGetContext("snapshotPrefix") ?? "accepted/review/",
  ),
  manifestDigest = String(
    app.node.tryGetContext("snapshotManifestSha256") ?? "0".repeat(64),
  );
if (
  !/^([A-Za-z0-9_.-]+\/)+$/.test(prefix) ||
  !/^[a-f0-9]{64}$/.test(manifestDigest)
)
  throw new Error("Invalid immutable snapshot deployment parameters");
const site = new Bucket(stack, "StaticSite", {
  blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  encryption: BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  removalPolicy: RemovalPolicy.RETAIN,
});
const enablePrivate = app.node.tryGetContext("enableProtectedView") === "true",
  privatePrefix = String(
    app.node.tryGetContext("privateSnapshotPrefix") ?? "operational/review/",
  ),
  privateDigest = String(app.node.tryGetContext("privateManifestSha256") ?? "");
if (
  enablePrivate &&
  (!/^([A-Za-z0-9_.-]+\/)+$/.test(privatePrefix) ||
    !/^[a-f0-9]{64}$/.test(privateDigest) ||
    /^0+$/.test(privateDigest))
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
const handler = new Function(stack, "ReadApi", {
  runtime: Runtime.NODEJS_24_X,
  architecture: Architecture.X86_64,
  handler: "index.handler",
  code: Code.fromAsset("oracle-lambda.zip"),
  memorySize: 4096,
  ephemeralStorageSize: Size.gibibytes(4),
  timeout: Duration.seconds(29),
  reservedConcurrentExecutions: 2,
  logGroup: logs,
  environment: {
    PRISM_DATA_MODE: "real",
    PRISM_SNAPSHOT_BUCKET: snapshots.bucketName,
    PRISM_SNAPSHOT_PREFIX: prefix,
    PRISM_SNAPSHOT_MANIFEST_SHA256: manifestDigest,
    PRISM_ACCESS_SECRET_ARN: access.secretArn,
    PRISM_QUOTA_TABLE: table.tableName,
    PRISM_BUILD_ID: String(
      app.node.tryGetContext("buildId") ?? "p2-review-unreleased",
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
  }),
);
const api = new HttpApi(stack, "HttpReadApi", {
  defaultIntegration: new HttpLambdaIntegration("ReadIntegration", handler),
  createDefaultStage: true,
});
const stage = api.defaultStage!.node
  .defaultChild as import("aws-cdk-lib/aws-apigatewayv2").CfnStage;
stage.defaultRouteSettings = {
  throttlingBurstLimit: 10,
  throttlingRateLimit: 5,
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
app.synth();
