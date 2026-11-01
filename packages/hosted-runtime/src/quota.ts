import { createHash } from "node:crypto";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { AccessError } from "./access.ts";
export interface QuotaInput {
  subject: string;
  category: "read" | "write" | "auth" | "model";
  limit: number;
  windowSeconds: number;
  units?: number;
  nowMs: number;
}
export interface QuotaResult {
  remaining: number;
  resetAt: number;
}
export interface QuotaStore {
  consume(input: QuotaInput): Promise<QuotaResult>;
}
function key(input: QuotaInput) {
  const units = input.units ?? 1;
  if (
    !Number.isInteger(units) ||
    units < 1 ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    units > input.limit ||
    input.windowSeconds < 1
  )
    throw new AccessError(429, "Quota rejected");
  const window = Math.floor(input.nowMs / 1000 / input.windowSeconds);
  return {
    pk: `quota#${createHash("sha256").update(input.subject).digest("hex")}`,
    sk: `${input.category}#${window}`,
    resetAt: (window + 1) * input.windowSeconds,
    units,
  };
}
export class MemoryQuotaStore implements QuotaStore {
  private readonly windows = new Map<
    string,
    { used: number; expiresAt: number }
  >();
  async consume(input: QuotaInput): Promise<QuotaResult> {
    const k = key(input),
      id = `${k.pk}/${k.sk}`;
    for (const [id, s] of this.windows)
      if (s.expiresAt <= input.nowMs / 1000) this.windows.delete(id);
    const used = (this.windows.get(id)?.used ?? 0) + k.units;
    if (used > input.limit)
      throw new AccessError(
        429,
        "Request allowance reached; retry after the window resets",
      );
    this.windows.set(id, { used, expiresAt: k.resetAt });
    return { remaining: input.limit - used, resetAt: k.resetAt };
  }
}
export class DynamoQuotaStore implements QuotaStore {
  constructor(
    private readonly client: Pick<DynamoDBDocumentClient, "send">,
    private readonly tableName: string,
  ) {}
  async consume(input: QuotaInput): Promise<QuotaResult> {
    const k = key(input);
    try {
      const out = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: k.pk, sk: k.sk },
          UpdateExpression: "SET expiresAt = :ttl ADD #consumed :units",
          ConditionExpression:
            "attribute_not_exists(#consumed) OR #consumed <= :ceiling",
          ExpressionAttributeNames: { "#consumed": "consumed" },
          ExpressionAttributeValues: {
            ":ttl": k.resetAt + 86400,
            ":units": k.units,
            ":ceiling": input.limit - k.units,
          },
          ReturnValues: "UPDATED_NEW",
        }),
      );
      const consumed = out.Attributes?.consumed;
      if (!Number.isSafeInteger(consumed) || Number(consumed) < 0)
        throw new Error("Invalid quota store response");
      return {
        remaining: input.limit - Number(consumed),
        resetAt: k.resetAt,
      };
    } catch (e) {
      if (e instanceof Error && e.name === "ConditionalCheckFailedException")
        throw new AccessError(
          429,
          "Request allowance reached; retry after the window resets",
        );
      throw e;
    }
  }
}
