import { afterEach, expect, it, vi } from "vitest";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics } from "@aws-lambda-powertools/metrics";
import {
  deliverAlarm,
  alertHandler,
  type AlertDependencies,
} from "../packages/hosted-runtime/src/alerts.ts";
const event = {
  source: "aws.cloudwatch",
  alarmArn: "arn:aws:cloudwatch:us-east-2:234567890123:alarm:OracleErrors",
  region: "us-east-2",
  alarmData: {
    state: { value: "ALARM", reason: "synthetic-private-source-do-not-send" },
  },
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
function fixture(statuses = [202]) {
  const bodies: Record<string, unknown>[] = [];
  const fake = vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe("https://events.pagerduty.com/v2/enqueue");
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    const status = statuses.shift() ?? 503;
    return new Response(
      JSON.stringify({ status: "success", dedup_key: body.dedup_key }),
      { status },
    );
  });
  const dependencies: AlertDependencies = {
    enabled: true,
    routingKey: vi.fn(async () => "S".repeat(32)),
    fetch: fake,
    sleep: vi.fn(async () => undefined),
    random: () => 0.5,
  };
  return { bodies, fake, dependencies };
}
it("disabled integration makes no secret or provider call, and unknown events fail closed", async () => {
  const f = fixture();
  f.dependencies.enabled = false;
  expect(await deliverAlarm(event, f.dependencies)).toEqual({
    status: "EXTERNAL_ORGANIZATION_DEPENDENCY_BLOCKED",
    attempts: 0,
  });
  expect(f.fake).not.toHaveBeenCalled();
  expect(f.dependencies.routingKey).not.toHaveBeenCalled();
  for (const bad of [
    null,
    {},
    { ...event, source: "browser" },
    { ...event, region: "us-east-1" },
    { ...event, alarmData: { state: { value: "OTHER" } } },
  ])
    await expect(deliverAlarm(bad, f.dependencies)).rejects.toThrow(
      "Alarm event rejected",
    );
});
it("trigger and resolve share a hashed dedup key and transmit no source reason or account/ARN", async () => {
  const f = fixture([202, 202]);
  await expect(deliverAlarm(event, f.dependencies)).resolves.toMatchObject({
    status: "DELIVERED",
    attempts: 1,
  });
  await deliverAlarm(
    { ...event, alarmData: { state: { value: "OK" } } },
    f.dependencies,
  );
  expect(f.bodies[0]?.event_action).toBe("trigger");
  expect(f.bodies[1]?.event_action).toBe("resolve");
  expect(f.bodies[0]?.dedup_key).toBe(f.bodies[1]?.dedup_key);
  expect(f.bodies[1]).not.toHaveProperty("payload");
  const serialized = JSON.stringify(f.bodies);
  expect(serialized).not.toContain("synthetic-private-source-do-not-send");
  expect(serialized).not.toContain("234567890123");
  expect(serialized).not.toContain("arn:aws");
});
it("retries transient limits with bounded backoff, stops permanent rejection, and rejects unacknowledged delivery", async () => {
  const f = fixture([429, 503, 202]);
  expect(await deliverAlarm(event, f.dependencies)).toMatchObject({
    status: "DELIVERED",
    attempts: 3,
  });
  expect(f.dependencies.sleep).toHaveBeenNthCalledWith(1, 150);
  expect(f.dependencies.sleep).toHaveBeenNthCalledWith(2, 250);
  const bad = fixture([401]);
  await expect(deliverAlarm(event, bad.dependencies)).rejects.toThrow(
    "provider rejected",
  );
  expect(bad.fake).toHaveBeenCalledTimes(1);
  const exhausted = fixture([503, 503, 503]);
  await expect(deliverAlarm(event, exhausted.dependencies)).rejects.toThrow(
    "bounded retry",
  );
  expect(exhausted.fake).toHaveBeenCalledTimes(3);
});
it("actual alert Lambda sanitizes malformed secrets and SDK exceptions before automatic runtime logging", async () => {
  vi.stubEnv("PRISM_PAGERDUTY_ENABLED", "1");
  vi.stubEnv("PRISM_PAGERDUTY_SECRET_ARN", "synthetic-alert-secret");
  const logs = vi
    .spyOn(Logger.prototype, "info")
    .mockImplementation(() => undefined);
  vi.spyOn(Metrics.prototype, "publishStoredMetrics").mockImplementation(
    function (this: Metrics) {
      return this;
    },
  );
  vi.spyOn(Metrics.prototype, "captureColdStartMetric").mockImplementation(
    () => undefined,
  );
  // The actual handler uses the promise overload; the SDK's last overload is callback/void.
  const promiseClient = SecretsManagerClient.prototype as unknown as {
    send: (
      command: unknown,
      options?: unknown,
    ) => Promise<{ SecretString?: string; $metadata: object }>;
  };
  const send = vi.spyOn(promiseClient, "send");
  const privateCanary = "synthetic-private-routing-key-token-do-not-log";
  send.mockResolvedValueOnce({ SecretString: privateCanary, $metadata: {} });
  await expect(alertHandler(event)).rejects.toThrow(
    "sensitive diagnostics suppressed",
  );
  send.mockRejectedValueOnce(new Error(privateCanary));
  let caught: unknown;
  try {
    await alertHandler(event);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect(String(caught)).not.toContain(privateCanary);
  expect((caught as Error).cause).toBeUndefined();
  expect(JSON.stringify(logs.mock.calls)).not.toContain(privateCanary);
  expect(send).toHaveBeenCalledTimes(2);
});
