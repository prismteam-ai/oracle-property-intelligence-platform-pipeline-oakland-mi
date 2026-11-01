import { it, expect } from "vitest";
import { DynamoSessionStore } from "../packages/hosted-runtime/src/sessions.ts";
import { secretAccessProvider } from "../packages/hosted-runtime/src/secrets.ts";
import { accessCodeDigest } from "../packages/hosted-runtime/src/access.ts";
it("stores only session metadata with TTL and reads consistently for revocation", async () => {
  const calls: {
    input: Record<string, unknown>;
    constructor: { name: string };
  }[] = [];
  let item: unknown;
  const store = new DynamoSessionStore(
    {
      send: async (command: {
        input: Record<string, unknown>;
        constructor: { name: string };
      }) => {
        calls.push(command);
        if (command.constructor.name === "PutCommand")
          item = command.input.Item;
        if (command.constructor.name === "DeleteCommand") item = undefined;
        return { Item: item };
      },
    } as never,
    "sessions",
  );
  const session = {
    id: "test-session",
    workspaceId: "review",
    expiresAt: 2000,
  };
  await store.put(session);
  expect(await store.get(session.id)).toEqual(session);
  await store.revoke(session.id);
  expect(await store.get(session.id)).toBe(null);
  expect(JSON.stringify(calls)).toContain('"ConsistentRead":true');
  expect(JSON.stringify(calls)).toContain('"expiresAt":2000');
  expect(JSON.stringify(calls)).not.toContain("token");
});
it("caches access config for at most60s and key rotation rejects prior tokens", async () => {
  let calls = 0,
    clock = 0,
    version = "v1";
  const provider = secretAccessProvider(
    "fixture-secret",
    {
      send: async () => {
        calls++;
        return {
          SecretString: JSON.stringify({
            signingKey: "x".repeat(40),
            reviewCodeDigest: accessCodeDigest("fixture-code"),
            keyVersion: version,
          }),
        };
      },
    } as never,
    () => clock,
  );
  const old = (await provider()).issue("fixture-code").token;
  version = "v2";
  clock = 59999;
  expect((await provider()).verify(old)).toBeDefined();
  expect(calls).toBe(1);
  clock = 60000;
  const current = await provider();
  expect(() => current.verify(old)).toThrow();
  expect(calls).toBe(2);
});
