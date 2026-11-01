import { afterEach, expect, it, vi } from "vitest";
import {
  RuntimeTelemetry,
  operationForPath,
} from "../packages/hosted-runtime/src/observability.ts";

afterEach(() => vi.restoreAllMocks());
it("keeps path IDs, request/response rows and error messages outside all structured logs", async () => {
  const t = new RuntimeTelemetry("oracle-observability-fixture");
  const log = vi.spyOn(t.logger, "info").mockImplementation(() => undefined);
  vi.spyOn(t.metrics, "publishStoredMetrics").mockImplementation(
    () => t.metrics,
  );
  vi.spyOn(t.metrics, "captureColdStartMetric").mockImplementation(
    () => undefined,
  );
  const add = vi.spyOn(t.metrics, "addMetric");
  const marker = "synthetic-private-owner-or-credential-do-not-log";
  const response = {
    statusCode: 200,
    body: JSON.stringify({ total: 7, rows: [{ owner: marker }] }),
  };
  expect(await t.observe("query", async () => response)).toBe(response);
  expect(operationForPath("/api/properties/" + marker)).toBe("detail");
  expect(operationForPath("/api/" + marker)).toBe("other");
  expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
  expect(
    add.mock.calls.some(
      ([name, , value]) => name === "QueryResultCount" && value === 7,
    ),
  ).toBe(true);
  expect(JSON.stringify(t.metrics.serializeMetrics())).not.toContain(marker);
  expect(log.mock.calls[0]?.[1]).toMatchObject({
    operation: "query",
    statusCode: 200,
  });
  await expect(
    t.observe(marker, async () => {
      throw new Error(marker);
    }),
  ).rejects.toThrow(marker);
  expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
  expect(log.mock.calls.at(-1)?.[1]).toMatchObject({
    operation: "other",
    statusCode: 500,
  });
});
it("records auth, quota, snapshot and latency failures using fixed low-cardinality names", async () => {
  const t = new RuntimeTelemetry("oracle-observability-fixture");
  vi.spyOn(t.logger, "info").mockImplementation(() => undefined);
  vi.spyOn(t.metrics, "publishStoredMetrics").mockImplementation(
    () => t.metrics,
  );
  vi.spyOn(t.metrics, "captureColdStartMetric").mockImplementation(
    () => undefined,
  );
  const add = vi.spyOn(t.metrics, "addMetric");
  for (const statusCode of [401, 403, 429, 503])
    await t.observe("session", async () => ({ statusCode }));
  for (const expected of [
    "AuthFailure",
    "RateLimitFailure",
    "SnapshotUnavailable",
    "RequestError",
    "RequestLatency",
  ])
    expect(add.mock.calls.some(([name]) => name === expected)).toBe(true);
  expect(Object.keys(t.metrics.serializeMetrics())).not.toContain("operation");
});
it("trace collector receives only fixed annotations on success and private-error paths", async () => {
  process.env.POWERTOOLS_TRACER_CAPTURE_RESPONSE = "true";
  process.env.POWERTOOLS_TRACER_CAPTURE_ERROR = "true";
  const t = new RuntimeTelemetry("oracle-trace-fixture");
  expect(process.env.POWERTOOLS_TRACER_CAPTURE_RESPONSE).toBe("false");
  expect(process.env.POWERTOOLS_TRACER_CAPTURE_ERROR).toBe("false");
  vi.spyOn(t.logger, "info").mockImplementation(() => undefined);
  vi.spyOn(t.metrics, "publishStoredMetrics").mockImplementation(
    () => t.metrics,
  );
  vi.spyOn(t.metrics, "captureColdStartMetric").mockImplementation(
    () => undefined,
  );
  const close = vi.fn();
  const parent = { addNewSubsegment: () => ({ close }) };
  vi.spyOn(t.tracer, "isTracingEnabled").mockReturnValue(true);
  vi.spyOn(t.tracer, "getSegment").mockReturnValue(
    parent as unknown as ReturnType<typeof t.tracer.getSegment>,
  );
  vi.spyOn(t.tracer, "setSegment").mockImplementation(() => undefined);
  vi.spyOn(t.tracer, "annotateColdStart").mockImplementation(() => undefined);
  vi.spyOn(t.tracer, "addServiceNameAnnotation").mockImplementation(
    () => undefined,
  );
  const annotations = vi
    .spyOn(t.tracer, "putAnnotation")
    .mockImplementation(() => undefined);
  const response = vi.spyOn(t.tracer, "addResponseAsMetadata");
  const errors = vi.spyOn(t.tracer, "addErrorAsMetadata");
  const metadata = vi.spyOn(t.tracer, "putMetadata");
  const privateCanary = "synthetic-private-query-token-row-do-not-trace";
  await t.observe("query", async () => ({
    statusCode: 200,
    body: privateCanary,
  }));
  await expect(
    t.observe("detail", async () => {
      throw new Error(privateCanary);
    }),
  ).rejects.toThrow(privateCanary);
  expect(JSON.stringify(annotations.mock.calls)).not.toContain(privateCanary);
  expect(annotations.mock.calls.map(([key]) => key)).toEqual([
    "operation",
    "status_code",
    "operation",
    "status_code",
  ]);
  expect(response).not.toHaveBeenCalled();
  expect(errors).not.toHaveBeenCalled();
  expect(metadata).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(2);
});
it("publishes truthful known/unknown data-through freshness without source strings or fake zero ages", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-28T12:00:00Z"));
  const t = new RuntimeTelemetry("oracle-freshness-fixture");
  const add = vi.spyOn(t.metrics, "addMetric");
  t.snapshot(10, 20, {
    knownDataThroughDates: ["2026-10-19"],
    unknownCohorts: 2,
  });
  expect(add.mock.calls).toContainEqual([
    "SourceFreshnessKnownCohorts",
    "Count",
    1,
  ]);
  expect(add.mock.calls).toContainEqual([
    "SourceFreshnessUnknownCohorts",
    "Count",
    2,
  ]);
  expect(add.mock.calls).toContainEqual([
    "SourceDataThroughAgeUpperBoundSeconds",
    "Seconds",
    9.5 * 86400,
  ]);
  add.mockClear();
  const marker = "SYNTHETIC_PRIVATE_SOURCE_CANARY";
  t.snapshot(10, 20, { knownDataThroughDates: [marker], unknownCohorts: 1 });
  expect(
    add.mock.calls.some(
      ([name]) => name === "SourceDataThroughAgeUpperBoundSeconds",
    ),
  ).toBe(false);
  expect(JSON.stringify(t.metrics.serializeMetrics())).not.toContain(marker);
});
