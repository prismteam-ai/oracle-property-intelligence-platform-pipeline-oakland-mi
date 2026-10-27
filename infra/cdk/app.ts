import {
  App,
  Stack,
  CfnOutput,
  Tags,
  RemovalPolicy,
  Duration,
} from "aws-cdk-lib";
import { Runtime, Function, Code } from "aws-cdk-lib/aws-lambda";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Bucket, BlockPublicAccess } from "aws-cdk-lib/aws-s3";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
const app = new App();
const stack = new Stack(app, "PrismOracleReadPlane", {
  env: { region: "us-east-2" },
  description:
    "P1 synth-only architecture definition; runtime implementation/packaging not yet deployment ready",
});
Tags.of(stack).add("Project", "prism-assessment");
Tags.of(stack).add("Stage", "local-foundations");
Tags.of(stack).add("Retention", "review-window-7-days-extend-if-active");
const snapshot = new Bucket(stack, "AcceptedSnapshots", {
  blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  enforceSSL: true,
  versioned: true,
  removalPolicy: RemovalPolicy.RETAIN,
});
const handler = new Function(stack, "ReadApi", {
  runtime: Runtime.NODEJS_24_X,
  handler: "index.handler",
  code: Code.fromInline(
    "exports.handler = async () => ({statusCode:503,body:JSON.stringify({code:'P1_LOCAL_ONLY',message:'Local P1 runtime not deployed'})});",
  ),
  memorySize: 1024,
  timeout: Duration.seconds(20),
  reservedConcurrentExecutions: 2,
  logRetention: RetentionDays.ONE_WEEK,
  environment: {
    SNAPSHOT_VERSION: "not-deployed",
    MODEL_INFERENCE: "disabled",
  },
});
snapshot.grantRead(handler);
const api = new HttpApi(stack, "HttpReadApi", {
  defaultIntegration: new HttpLambdaIntegration("ReadIntegration", handler),
  createDefaultStage: true,
});
new CfnOutput(stack, "RuntimePackagingGate", {
  value:
    "NO DEPLOYMENT: replace503 synth contract only after native packaging and snapshot review",
});
new CfnOutput(stack, "ProposedEndpoint", { value: api.apiEndpoint });
app.synth();
