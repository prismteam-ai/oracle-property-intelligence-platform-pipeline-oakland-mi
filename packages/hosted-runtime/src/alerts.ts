import { createHash } from "node:crypto";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { RuntimeTelemetry } from "./observability.ts";

export interface AlarmEvent {
  source: "aws.cloudwatch";
  alarmArn: string;
  region: string;
  alarmData: { state: { value: string } };
}
export interface AlertDependencies {
  enabled: boolean;
  routingKey: () => Promise<string>;
  fetch: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
  random: () => number;
}

/** Provider receives bounded operational metadata only, never alarm reason/body/source data. */
export async function deliverAlarm(
  input: unknown,
  dependencies: AlertDependencies,
) {
  const e = input as Partial<AlarmEvent> | null;
  if (
    !e ||
    e.source !== "aws.cloudwatch" ||
    e.region !== "us-east-2" ||
    typeof e.alarmArn !== "string" ||
    e.alarmArn.length > 300 ||
    !/^arn:aws:cloudwatch:us-east-2:\d{12}:alarm:[A-Za-z0-9_-]+$/.test(
      e.alarmArn,
    ) ||
    !["ALARM", "OK"].includes(e.alarmData?.state?.value ?? "")
  )
    throw new Error("Alarm event rejected");
  if (!dependencies.enabled)
    return {
      status: "EXTERNAL_ORGANIZATION_DEPENDENCY_BLOCKED",
      attempts: 0,
    } as const;
  const key = await dependencies.routingKey();
  if (!/^[A-Za-z0-9]{32}$/.test(key))
    throw new Error("Alert integration is not configured");
  const dedup =
    "prism-oracle-" + createHash("sha256").update(e.alarmArn).digest("hex");
  const body = JSON.stringify({
    routing_key: key,
    event_action: e.alarmData!.state.value === "ALARM" ? "trigger" : "resolve",
    dedup_key: dedup,
    ...(e.alarmData!.state.value === "ALARM"
      ? {
          payload: {
            summary: "Oracle assessment critical alarm",
            source: "prism-oracle-review",
            severity: "critical",
            component: "oracle",
            group: "assessment-review",
            custom_details: { region: "us-east-2", state: "ALARM" },
          },
        }
      : {}),
  });
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await dependencies.fetch(
        "https://events.pagerduty.com/v2/enqueue",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(2000),
          redirect: "error",
        },
      );
      if (response.status === 202) {
        const result = (await response.json()) as {
          status?: unknown;
          dedup_key?: unknown;
        };
        if (result.status !== "success" || result.dedup_key !== dedup)
          throw new Error("Alert provider acknowledgment rejected");
        return { status: "DELIVERED", attempts: attempt } as const;
      }
      if (response.status !== 429 && response.status < 500)
        throw new Error("Alert provider rejected the bounded event");
    } catch (error) {
      if (
        error instanceof Error &&
        /^Alert provider (rejected|acknowledgment)/.test(error.message)
      )
        throw error;
    }
    if (attempt < 3)
      await dependencies.sleep(
        100 * 2 ** (attempt - 1) + Math.floor(dependencies.random() * 100),
      );
  }
  throw new Error("Alert delivery unavailable after bounded retry");
}

const alertTelemetry = new RuntimeTelemetry("prism-oracle-alerts");
const secrets = new SecretsManagerClient({ maxAttempts: 2 });
/** CloudWatch alarm-action Lambda; no public HTTP route or arbitrary recipient. */
export async function alertHandler(event: unknown) {
  try {
    return await alertTelemetry.observe("alert", async () => {
      const result = await deliverAlarm(event, {
        enabled: process.env.PRISM_PAGERDUTY_ENABLED === "1",
        routingKey: async () => {
          const id = process.env.PRISM_PAGERDUTY_SECRET_ARN;
          if (!id) throw new Error("Alert secret configuration missing");
          const response = await secrets.send(
            new GetSecretValueCommand({ SecretId: id }),
            { abortSignal: AbortSignal.timeout(2000) },
          );
          const value = JSON.parse(response.SecretString ?? "{}") as {
            routingKey?: unknown;
          };
          return typeof value.routingKey === "string" ? value.routingKey : "";
        },
        fetch,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        random: Math.random,
      });
      return { statusCode: 202, body: JSON.stringify(result) };
    });
  } catch {
    // Lambda itself logs an unhandled exception, independently of Powertools.
    // Never attach a raw SDK/JSON/provider error or secret-bearing cause here.
    throw new Error("Alert delivery failed; sensitive diagnostics suppressed");
  }
}
