import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { Tracer } from "@aws-lambda-powertools/tracer";

export const METRIC_NAMESPACE = "PrismAssessment";
const routes = new Map([
  ["/api/health", "health"],
  ["/api/session", "session"],
  ["/api/search", "query"],
  ["/api/summary", "summary"],
  ["/api/coverage", "coverage"],
  ["/api/runs", "runs"],
  ["/api/manifest", "manifest"],
  ["/api/mcp", "mcp"],
  ["/api/evidence", "evidence"],
  ["/api/source-context", "source_context"],
]);

/** Only bounded operation labels reach logs, metrics or trace annotations. */
export function operationForPath(path: string): string {
  if (path.startsWith("/api/properties/")) return "detail";
  return routes.get(path) ?? "other";
}

/** Never captures request/response bodies, cookies, query values, errors or source rows. */
export class RuntimeTelemetry {
  readonly logger: Logger;
  readonly metrics: Metrics;
  readonly tracer: Tracer;

  constructor(serviceName = "prism-oracle-review") {
    // Force the application privacy boundary even if an ambient default was
    // misconfigured. Manual instrumentation never serializes events or errors.
    process.env.POWERTOOLS_LOGGER_LOG_EVENT = "false";
    process.env.POWERTOOLS_TRACER_CAPTURE_RESPONSE = "false";
    process.env.POWERTOOLS_TRACER_CAPTURE_ERROR = "false";
    this.logger = new Logger({ serviceName });
    this.metrics = new Metrics({ namespace: METRIC_NAMESPACE, serviceName });
    this.tracer = new Tracer({ serviceName, captureHTTPsRequests: false });
  }

  snapshot(properties: number, addresses: number | undefined): void {
    this.metrics.addMetric("SnapshotValidated", MetricUnit.Count, 1);
    this.metrics.addMetric(
      "SourceCoverageProperties",
      MetricUnit.Count,
      properties,
    );
    if (addresses !== undefined)
      this.metrics.addMetric(
        "SourceCoverageAddresses",
        MetricUnit.Count,
        addresses,
      );
  }

  async observe<T extends { statusCode: number; body?: string }>(
    operation: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const allowed = new Set([...routes.values(), "detail", "alert", "other"]);
    const label = allowed.has(operation) ? operation : "other";
    const started = performance.now();
    const parent = this.tracer.isTracingEnabled()
      ? this.tracer.getSegment()
      : undefined;
    const segment = parent?.addNewSubsegment("## assessment_request");
    if (segment) {
      this.tracer.setSegment(segment);
      this.tracer.annotateColdStart();
      this.tracer.addServiceNameAnnotation();
      this.tracer.putAnnotation("operation", label);
    }
    this.metrics.addMetric("RequestCount", MetricUnit.Count, 1);
    this.metrics.captureColdStartMetric();
    let status = 500;
    try {
      const response = await work();
      status = response.statusCode;
      if (label === "query" && status === 200 && response.body) {
        try {
          const value = JSON.parse(response.body) as { total?: unknown };
          if (
            typeof value.total === "number" &&
            Number.isSafeInteger(value.total) &&
            value.total >= 0
          )
            this.metrics.addMetric(
              "QueryResultCount",
              MetricUnit.Count,
              value.total,
            );
        } catch {
          /* Invalid JSON is handled by the API; bodies never become telemetry. */
        }
      }
      return response;
    } finally {
      const latencyMs = Math.max(0, performance.now() - started);
      this.metrics.addMetric(
        "RequestLatency",
        MetricUnit.Milliseconds,
        latencyMs,
      );
      if (label === "query" || label === "mcp")
        this.metrics.addMetric(
          "QueryLatency",
          MetricUnit.Milliseconds,
          latencyMs,
        );
      if (status >= 500)
        this.metrics.addMetric("RequestError", MetricUnit.Count, 1);
      if (status === 401 || status === 403)
        this.metrics.addMetric("AuthFailure", MetricUnit.Count, 1);
      if (status === 429)
        this.metrics.addMetric("RateLimitFailure", MetricUnit.Count, 1);
      if (status === 503)
        this.metrics.addMetric("SnapshotUnavailable", MetricUnit.Count, 1);
      this.logger.info("request_completed", {
        operation: label,
        statusCode: status,
        latencyMs,
      });
      if (segment && parent) {
        this.tracer.putAnnotation("status_code", status);
        segment.close();
        this.tracer.setSegment(parent);
      }
      this.metrics.publishStoredMetrics();
      this.logger.resetKeys();
    }
  }
}

export const telemetry = new RuntimeTelemetry();
