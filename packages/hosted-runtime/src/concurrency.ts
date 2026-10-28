/** Deployment metadata validation only. No SDK, account, profile or credential access. */
export interface ConcurrencyPolicy {
  mode: "reserved" | "existing-account-shared";
  reservedConcurrentExecutions: number | null;
  existingAccountConcurrency: 10 | null;
  apiRatePerSecond: number;
  apiBurst: number;
}
export interface AccountConcurrencyProof {
  version: 1;
  observedAt: string;
  accountId: string;
  region: "us-east-1";
  concurrentExecutions: 10;
  unreservedConcurrentExecutions: 10;
  totalFunctionCount: number;
  functions: { functionName: string; functionArn: string }[];
}
export function buildConcurrencyPolicy(
  env: Readonly<Record<string, string | undefined>>,
): ConcurrencyPolicy {
  const bounded = (key: string, fallback: number, min: number, max: number) => {
    const value = env[key];
    if (value === undefined) return fallback;
    if (
      !/^(0|[1-9]\d*)$/.test(value) ||
      Number(value) < min ||
      Number(value) > max
    )
      throw new Error(`Invalid bounded capacity setting: ${key}`);
    return Number(value);
  };
  const mode = env.PRISM_CONCURRENCY_MODE ?? "reserved";
  const reserved = bounded("PRISM_RESERVED_CONCURRENCY", 5, 2, 12);
  const apiRatePerSecond = bounded(
    "PRISM_API_RATE_PER_SECOND",
    mode === "reserved" ? 5 : 2,
    2,
    10,
  );
  const apiBurst = bounded(
    "PRISM_API_BURST",
    mode === "reserved" ? 10 : 6,
    6,
    20,
  );
  if (mode === "reserved")
    return {
      mode,
      reservedConcurrentExecutions: reserved,
      existingAccountConcurrency: null,
      apiRatePerSecond,
      apiBurst,
    };
  if (
    mode !== "existing-account-shared" ||
    env.PRISM_SHARED_ACCOUNT_CONCURRENCY_APPROVED !== "yes" ||
    env.PRISM_EXISTING_ACCOUNT_CONCURRENCY !== "10"
  )
    throw new Error(
      "Shared account mode requires explicit approval and exact existing quota10",
    );
  return {
    mode,
    reservedConcurrentExecutions: null,
    existingAccountConcurrency: 10,
    apiRatePerSecond,
    apiBurst,
  };
}

const functionPatterns = [
  /^PrismOracleReview-ReadApiB934CF2C-[A-Za-z0-9]+$/,
  /^PrismCrmP3Review-CrmHandler98FEA697-[A-Za-z0-9]+$/,
];
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
export function validateConcurrencyProof(
  input: unknown,
  expectedAccountId: string,
  nowMs = Date.now(),
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Account concurrency proof rejected");
  const p = input as Record<string, unknown>;
  if (
    !exactKeys(p, [
      "version",
      "observedAt",
      "accountId",
      "region",
      "concurrentExecutions",
      "unreservedConcurrentExecutions",
      "totalFunctionCount",
      "functions",
    ]) ||
    p.version !== 1 ||
    !/^\d{12}$/.test(expectedAccountId) ||
    p.accountId !== expectedAccountId ||
    p.region !== "us-east-1" ||
    p.concurrentExecutions !== 10 ||
    p.unreservedConcurrentExecutions !== 10 ||
    typeof p.observedAt !== "string" ||
    !/Z$/.test(p.observedAt) ||
    !Number.isInteger(p.totalFunctionCount) ||
    (p.totalFunctionCount as number) < 0 ||
    (p.totalFunctionCount as number) > 2 ||
    !Array.isArray(p.functions) ||
    p.functions.length !== p.totalFunctionCount
  )
    throw new Error(
      "Account concurrency identity, quota or inventory rejected",
    );
  const observed = Date.parse(p.observedAt);
  if (
    !Number.isFinite(observed) ||
    !Number.isFinite(nowMs) ||
    observed > nowMs + 30000 ||
    nowMs - observed > 15 * 60000
  )
    throw new Error("Account concurrency proof must be fresh within15minutes");
  const used = new Set<number>();
  for (const value of p.functions) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Function inventory rejected");
    const f = value as Record<string, unknown>;
    if (
      !exactKeys(f, ["functionName", "functionArn"]) ||
      typeof f.functionName !== "string"
    )
      throw new Error("Function inventory rejected");
    const kind = functionPatterns.findIndex((pattern) =>
      pattern.test(f.functionName as string),
    );
    if (
      kind < 0 ||
      used.has(kind) ||
      f.functionArn !==
        `arn:aws:lambda:us-east-1:${expectedAccountId}:function:${f.functionName}`
    )
      throw new Error("Non-task or duplicate function inventory rejected");
    used.add(kind);
  }
  return {
    observedAt: p.observedAt,
    concurrentExecutions: 10 as const,
    unreservedConcurrentExecutions: 10 as const,
    totalFunctionCount: p.totalFunctionCount as number,
  };
}
