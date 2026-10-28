/** Only successful Lambda GetFunctionConcurrency CLI output may be empty.
 * The AWS CLI emits no bytes for an unconfigured optional reservation. Command
 * failures must be allowed to throw before this operation-specific parser runs.
 */
export function parseFunctionConcurrencyOutput(stdout: string): {
  ReservedConcurrentExecutions?: number;
} {
  if (!stdout.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error("Lambda concurrency response rejected");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Lambda concurrency response rejected");
  const fields = Object.keys(value);
  if (fields.length === 0) return {};
  if (fields.length !== 1 || fields[0] !== "ReservedConcurrentExecutions")
    throw new Error("Lambda concurrency response rejected");
  const count = (value as Record<string, unknown>).ReservedConcurrentExecutions;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)
    throw new Error("Lambda concurrency response rejected");
  return { ReservedConcurrentExecutions: count };
}
