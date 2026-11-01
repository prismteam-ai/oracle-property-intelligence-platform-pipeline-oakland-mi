export const SETUP_STAGES = [
  "runtime",
  "access-secret",
  "oracle-client",
  "application",
  "dispatch",
] as const;
export type SetupStage = (typeof SETUP_STAGES)[number];
const NAMES = [
  "Error",
  "TypeError",
  "SyntaxError",
  "AbortError",
  "TimeoutError",
  "CredentialsProviderError",
  "TokenProviderError",
  "AccessDeniedException",
  "ResourceNotFoundException",
  "InvalidRequestException",
  "InvalidParameterException",
  "DecryptionFailure",
  "InternalServiceError",
  "InternalServiceErrorException",
  "InternalServerException",
  "ServiceUnavailableException",
  "ThrottlingException",
  "TooManyRequestsException",
  "ExpiredTokenException",
  "UnrecognizedClientException",
  "InvalidSignatureException",
  "RequestTimeout",
  "RequestTimeoutException",
] as const;
const NETWORK_CODES = [
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ERR_STREAM_PREMATURE_CLOSE",
] as const;
/** Only own data properties are inspected. Accessors, inherited fields, messages, causes and headers are never read. */
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}
const status = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 100 &&
  value <= 599
    ? value
    : undefined;
export function setupFailureDiagnostic(stage: SetupStage, error: unknown) {
  const name = own(error, "name"),
    code = own(error, "code");
  const errorName = NAMES.find((allowed) => allowed === name);
  const networkCode = NETWORK_CODES.find((allowed) => allowed === code);
  const httpStatus =
    status(own(error, "statusCode")) ??
    status(own(own(error, "$metadata"), "httpStatusCode"));
  return {
    stage: SETUP_STAGES.find((allowed) => allowed === stage) ?? "unknown",
    ...(errorName ? { errorName } : {}),
    ...(networkCode ? { networkCode } : {}),
    ...(httpStatus === undefined ? {} : { httpStatus }),
  };
}
