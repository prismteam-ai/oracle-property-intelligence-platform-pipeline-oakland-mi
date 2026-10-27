import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { type ReviewSession, AccessError } from "./access.ts";
export interface SessionStore {
  put(session: ReviewSession): Promise<void>;
  get(id: string): Promise<ReviewSession | null>;
  revoke(id: string): Promise<void>;
}
export class MemorySessionStore implements SessionStore {
  private readonly values = new Map<string, ReviewSession>();
  async put(session: ReviewSession) {
    this.values.set(session.id, session);
  }
  async get(id: string) {
    return this.values.get(id) ?? null;
  }
  async revoke(id: string) {
    this.values.delete(id);
  }
}
export class DynamoSessionStore implements SessionStore {
  constructor(
    private readonly client: Pick<DynamoDBDocumentClient, "send">,
    private readonly tableName: string,
  ) {}
  async put(session: ReviewSession) {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { pk: `session#${session.id}`, sk: "session", ...session },
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
  }
  async get(id: string) {
    const out = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `session#${id}`, sk: "session" },
        ConsistentRead: true,
      }),
    );
    if (!out.Item) return null;
    const s = out.Item as ReviewSession;
    if (
      s.id !== id ||
      s.workspaceId !== "review" ||
      !Number.isInteger(s.expiresAt)
    )
      throw new AccessError(401, "Session rejected");
    return { id: s.id, workspaceId: s.workspaceId, expiresAt: s.expiresAt };
  }
  async revoke(id: string) {
    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk: `session#${id}`, sk: "session" },
      }),
    );
  }
}
