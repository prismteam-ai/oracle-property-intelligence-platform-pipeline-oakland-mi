import { ZodError } from "zod";
import { DomainError } from "../../contracts/src/index.ts";
import { AccessError } from "./access.ts";
import {
  setupFailureDiagnostic,
  type SetupStage,
} from "./setup-diagnostics.ts";
import { telemetry } from "./observability.ts";

/** Expected contract failures retain their public messages; server failures never do. */
export function classifyApiError(error: unknown) {
  if (error instanceof AccessError && error.status < 500)
    return {
      status: error.status,
      code:
        error.status === 429
          ? "RATE_LIMITED"
          : error.status === 400 || error.status === 413
            ? "INVALID_INPUT"
            : "NOT_AUTHORIZED",
      message: error.message,
    };
  if (error instanceof ZodError)
    return {
      status: 400,
      code: "INVALID_INPUT",
      message: "Invalid request fields",
    };
  if (error instanceof DomainError && error.code !== "QUERY_TIMEOUT") {
    const status =
      error.code === "CONFLICT"
        ? 409
        : error.code === "NOT_AUTHORIZED"
          ? 403
          : error.code === "RATE_LIMITED" || error.code === "COST_LIMIT_REACHED"
            ? 429
            : error.code === "SNAPSHOT_UNAVAILABLE"
              ? 409
              : 400;
    return { status, code: error.code, message: error.message };
  }
  const diagnostic = setupFailureDiagnostic("application", error);
  const unavailable =
    (error instanceof DomainError && error.code === "QUERY_TIMEOUT") ||
    (error instanceof AccessError && error.status === 503) ||
    diagnostic.networkCode !== undefined ||
    [
      "TimeoutError",
      "RequestTimeout",
      "RequestTimeoutException",
      "ServiceUnavailableException",
    ].includes(diagnostic.errorName ?? "") ||
    [502, 503, 504].includes(diagnostic.httpStatus ?? 0);
  return unavailable
    ? {
        status: 503,
        code: "DEPENDENCY_UNAVAILABLE",
        message: "A required service is temporarily unavailable",
      }
    : {
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Request could not be completed",
      };
}

/** Keep allowlisted original-exception diagnostics, never its text, stack, payload or cause. */
export function reportApiFailure(
  error: unknown,
  stage: SetupStage = "application",
) {
  const failure = classifyApiError(error);
  if (failure.status >= 500) {
    try {
      telemetry.logger.warn("api_request_failed", {
        classification: failure.code,
        ...setupFailureDiagnostic(stage, error),
      });
    } catch {
      /* Diagnostics cannot change the failure response. */
    }
  }
  return failure;
}

export function decodeInputPath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new DomainError("INVALID_INPUT", "Malformed path encoding");
  }
}
