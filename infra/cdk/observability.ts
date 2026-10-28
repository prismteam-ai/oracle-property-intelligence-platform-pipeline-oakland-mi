import { assessmentResourceNames } from "./resource-names.ts";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
} from "aws-cdk-lib";
import {
  Alarm,
  Dashboard,
  GraphWidget,
  Metric,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import { LambdaAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Code, Function, Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";

/** Low-cardinality operational telemetry; no source data or model text in metrics. */
export function assessmentObservability(input: {
  stack: Stack;
  api: Function;
  code: Code;
  alarms: readonly Alarm[];
  pagerDutyEnabled: boolean;
  reservedMode: boolean;
}) {
  const { stack } = input;
  const names = assessmentResourceNames(
    stack.stackName,
    stack.account,
    stack.region,
  );
  const routing = new Secret(stack, "PagerDutyRouting", {
    secretName: names.pagerDutySecret,
    description:
      "Populate routingKey privately only after a candidate-controlled free integration is available",
    secretStringValue: SecretValue.unsafePlainText('{"status":"unconfigured"}'),
  });
  routing.applyRemovalPolicy(RemovalPolicy.RETAIN);
  const logs = new LogGroup(stack, "AlertLogs", {
    retention: RetentionDays.THREE_MONTHS,
    removalPolicy: RemovalPolicy.RETAIN,
  });
  const notifierRole = new Role(stack, "AlertNotifierRole", {
    roleName: names.alertRole,
    assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
  });
  logs.grantWrite(notifierRole);
  const notifier = new Function(stack, "AlertNotifier", {
    role: notifierRole,
    runtime: Runtime.NODEJS_24_X,
    handler: "index.alertHandler",
    code: input.code,
    memorySize: 128,
    timeout: Duration.seconds(10),
    logGroup: logs,
    tracing: Tracing.ACTIVE,
    retryAttempts: 0,
    maxEventAge: Duration.minutes(1),
    ...(input.reservedMode ? { reservedConcurrentExecutions: 1 } : {}),
    environment: {
      PRISM_PAGERDUTY_SECRET_ARN: routing.secretArn,
      PRISM_PAGERDUTY_ENABLED: input.pagerDutyEnabled ? "1" : "0",
      POWERTOOLS_SERVICE_NAME: "prism-oracle-alerts",
      POWERTOOLS_METRICS_NAMESPACE: "PrismAssessment",
      POWERTOOLS_LOGGER_LOG_EVENT: "false",
      POWERTOOLS_TRACER_CAPTURE_RESPONSE: "false",
      POWERTOOLS_TRACER_CAPTURE_ERROR: "false",
    },
  });
  routing.grantRead(notifier);
  const metric = (metricName: string) =>
    new Metric({
      namespace: "PrismAssessment",
      metricName,
      dimensionsMap: { service: "prism-oracle-review" },
      period: Duration.minutes(5),
      statistic: "Sum",
    });
  const applicationErrors = metric("RequestError").createAlarm(
    stack,
    "CaughtApplicationErrors",
    {
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    },
  );
  for (const alarm of [...input.alarms, applicationErrors]) {
    alarm.addAlarmAction(
      new LambdaAction(notifier, { useUniquePermissionId: true }),
    );
    alarm.addOkAction(
      new LambdaAction(notifier, { useUniquePermissionId: true }),
    );
  }
  const dashboard = new Dashboard(stack, "AssessmentDashboard", {
    dashboardName: "prism-oracle-assessment-review",
    periodOverride: undefined,
  });
  dashboard.addWidgets(
    new GraphWidget({
      title: "Oracle requests and refused access",
      left: [
        metric("RequestCount"),
        metric("AuthFailure"),
        metric("RateLimitFailure"),
      ],
    }),
    new GraphWidget({
      title: "Oracle latency",
      left: [
        input.api.metricDuration({
          period: Duration.minutes(5),
          statistic: "p95",
        }),
        metric("QueryLatency").with({ statistic: "Average" }),
      ],
    }),
    new GraphWidget({
      title: "Errors and snapshot validation",
      left: [
        input.api.metricErrors(),
        metric("RequestError"),
        metric("SnapshotUnavailable"),
        metric("SnapshotValidated"),
      ],
    }),
    new GraphWidget({
      title: "Observed source coverage",
      left: [
        metric("SourceCoverageProperties").with({ statistic: "Maximum" }),
        metric("SourceCoverageAddresses").with({ statistic: "Maximum" }),
      ],
    }),
  );
  dashboard.addWidgets(
    new GraphWidget({
      title: "Reported source data-through freshness",
      left: [
        metric("SourceDataThroughAgeUpperBoundSeconds").with({
          statistic: "Maximum",
        }),
      ],
      right: [
        metric("SourceFreshnessKnownCohorts").with({ statistic: "Maximum" }),
        metric("SourceFreshnessUnknownCohorts").with({ statistic: "Maximum" }),
      ],
    }),
  );
  new CfnOutput(stack, "PagerDutySecretArn", { value: routing.secretArn });
  new CfnOutput(stack, "PagerDutyEnabled", {
    value: input.pagerDutyEnabled ? "true" : "false",
  });
  new CfnOutput(stack, "AlertFunctionName", { value: notifier.functionName });
  new CfnOutput(stack, "DashboardName", { value: dashboard.dashboardName });
  return { notifier, routing, dashboard };
}
