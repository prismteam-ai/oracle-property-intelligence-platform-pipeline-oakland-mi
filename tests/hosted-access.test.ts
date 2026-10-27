import { describe, it, expect } from "vitest";
import {
  AccessService,
  accessCodeDigest,
  readSessionCookie,
  sessionCookie,
} from "../packages/hosted-runtime/src/access.ts";
import {
  MemoryQuotaStore,
  DynamoQuotaStore,
} from "../packages/hosted-runtime/src/quota.ts";
describe("review access", () => {
  const config = {
    signingKey: "x".repeat(48),
    reviewCodeDigest: accessCodeDigest("fixture-review-only"),
    keyVersion: "v1",
    sessionTtlSeconds: 60,
  };
  it("signs, expires, rejects tampering and rotates", () => {
    let now = 100000;
    const a = new AccessService(config, () => now);
    expect(() => a.issue("wrong")).toThrow();
    const issued = a.issue("fixture-review-only");
    expect(a.verify(issued.token)).toEqual(issued.session);
    expect(() => a.verify(issued.token + "x")).toThrow();
    expect(() =>
      new AccessService({ ...config, keyVersion: "v2" }, () => now).verify(
        issued.token,
      ),
    ).toThrow();
    now += 60000;
    expect(() => a.verify(issued.token)).toThrow();
  });
  it("bounds cookies and grants distinct identities", () => {
    const a = new AccessService(config);
    const one = a.issue("fixture-review-only"),
      two = a.issue("fixture-review-only");
    expect(one.session.id).not.toBe(two.session.id);
    expect(sessionCookie(one.token, 60)).toContain(
      "HttpOnly; Secure; SameSite=Strict; Path=/api",
    );
    expect(readSessionCookie({ cookie: `prism_review=${one.token}` })).toBe(
      one.token,
    );
    expect(() =>
      readSessionCookie({ cookie: "prism_review=a; prism_review=b" }),
    ).toThrow();
  });
  it("enforces independent category,session,window quotas", async () => {
    const q = new MemoryQuotaStore();
    const i = {
      subject: "s1",
      category: "read" as const,
      limit: 2,
      windowSeconds: 60,
      nowMs: 1,
    };
    await q.consume(i);
    expect((await q.consume(i)).remaining).toBe(0);
    await expect(q.consume(i)).rejects.toThrow();
    expect((await q.consume({ ...i, subject: "s2" })).remaining).toBe(1);
    expect((await q.consume({ ...i, nowMs: 60001 })).remaining).toBe(1);
  });
  it("uses atomic Dynamo conditional counter and fails closed", async () => {
    const sent: unknown[] = [];
    const q = new DynamoQuotaStore(
      {
        send: async (c: unknown) => {
          sent.push(c);
          return { Attributes: { consumed: 2 } };
        },
      } as never,
      "quota",
    );
    expect(
      (
        await q.consume({
          subject: "s",
          category: "read",
          limit: 10,
          windowSeconds: 60,
          nowMs: 0,
        })
      ).remaining,
    ).toBe(8);
    expect(JSON.stringify(sent)).toContain(
      "attribute_not_exists(consumed) OR consumed <= :ceiling",
    );
    const fail = new DynamoQuotaStore(
      {
        send: async () => {
          throw new Error("offline");
        },
      } as never,
      "quota",
    );
    await expect(
      fail.consume({
        subject: "s",
        category: "read",
        limit: 10,
        windowSeconds: 60,
        nowMs: 0,
      }),
    ).rejects.toThrow("unavailable");
  });
});
