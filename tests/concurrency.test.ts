import { it, expect } from "vitest";
import {
  mkdtemp,
  writeFile,
  chmod,
  symlink,
  link,
  mkdir,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  buildConcurrencyPolicy,
  validateConcurrencyProof,
} from "../packages/hosted-runtime/src/concurrency.ts";
import { loadConcurrencyProof } from "../packages/hosted-runtime/src/concurrency-file.ts";
const now = Date.parse("2026-10-27T21:00:00.000Z"),
  account = "234567890123";
const proof = {
  version: 1,
  observedAt: new Date(now).toISOString(),
  accountId: account,
  region: "us-east-1",
  concurrentExecutions: 10,
  unreservedConcurrentExecutions: 10,
  totalFunctionCount: 0,
  functions: [] as { functionName: string; functionArn: string }[],
};
it("starts reserved5 by default and requires explicit exact shared opt-in", () => {
  expect(buildConcurrencyPolicy({})).toMatchObject({
    mode: "reserved",
    reservedConcurrentExecutions: 5,
  });
  for (const env of [
    { PRISM_CONCURRENCY_MODE: "other" },
    { PRISM_CONCURRENCY_MODE: "existing-account-shared" },
    {
      PRISM_CONCURRENCY_MODE: "existing-account-shared",
      PRISM_SHARED_ACCOUNT_CONCURRENCY_APPROVED: "yes",
      PRISM_EXISTING_ACCOUNT_CONCURRENCY: "11",
    },
  ])
    expect(() => buildConcurrencyPolicy(env)).toThrow();
  expect(
    buildConcurrencyPolicy({
      PRISM_CONCURRENCY_MODE: "existing-account-shared",
      PRISM_SHARED_ACCOUNT_CONCURRENCY_APPROVED: "yes",
      PRISM_EXISTING_ACCOUNT_CONCURRENCY: "10",
    }),
  ).toEqual({
    mode: "existing-account-shared",
    reservedConcurrentExecutions: null,
    existingAccountConcurrency: 10,
    apiRatePerSecond: 2,
    apiBurst: 6,
  });
});
it("accepts fresh empty or two exact task functions and returns no account or ARN", () => {
  expect(validateConcurrencyProof(proof, account, now)).toEqual({
    observedAt: proof.observedAt,
    concurrentExecutions: 10,
    unreservedConcurrentExecutions: 10,
    totalFunctionCount: 0,
  });
  const functions = [
    "PrismOracleReview-ReadApiB934CF2C-abc123",
    "PrismCrmP3Review-CrmHandler98FEA697-xyz456",
  ].map((functionName) => ({
    functionName,
    functionArn: `arn:aws:lambda:us-east-1:${account}:function:${functionName}`,
  }));
  expect(
    validateConcurrencyProof(
      { ...proof, totalFunctionCount: 2, functions },
      account,
      now,
    ).totalFunctionCount,
  ).toBe(2);
});
it("rejects stale/future, quota, account, inventory and unrelated-function proof", () => {
  const unrelated = {
    functionName: "OtherProduction",
    functionArn: `arn:aws:lambda:us-east-1:${account}:function:OtherProduction`,
  };
  for (const delta of [
    { observedAt: new Date(now - 900001).toISOString() },
    { observedAt: new Date(now + 30001).toISOString() },
    { accountId: "345678901234" },
    { region: "us-west-2" },
    { concurrentExecutions: 11 },
    { unreservedConcurrentExecutions: 9 },
    { totalFunctionCount: 1 },
    { extra: "raw" },
    { totalFunctionCount: 1, functions: [unrelated] },
  ])
    expect(() =>
      validateConcurrencyProof({ ...proof, ...delta }, account, now),
    ).toThrow();
  const functionName = "PrismOracleReview-ReadApiB934CF2C-abc123";
  const f = {
    functionName,
    functionArn: `arn:aws:lambda:us-east-1:${account}:function:${functionName}`,
  };
  expect(() =>
    validateConcurrencyProof(
      { ...proof, totalFunctionCount: 2, functions: [f, f] },
      account,
      now,
    ),
  ).toThrow();
  expect(() =>
    validateConcurrencyProof(
      {
        ...proof,
        totalFunctionCount: 1,
        functions: [{ ...f, functionArn: f.functionArn + ":alias" }],
      },
      account,
      now,
    ),
  ).toThrow();
});
it("loads owner0600 private metadata, rejects links/Return/Git/public permissions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "prism-capacity-"));
  const returned = path.join(root, "return"),
    file = path.join(root, "proof.json");
  await mkdir(returned);
  await writeFile(file, JSON.stringify(proof), { mode: 0o600 });
  expect(
    await loadConcurrencyProof(file, account, [returned], now),
  ).toMatchObject({
    totalFunctionCount: 0,
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  const soft = path.join(root, "soft.json");
  await symlink(file, soft);
  await expect(
    loadConcurrencyProof(soft, account, [returned], now),
  ).rejects.toThrow();
  await chmod(file, 0o644);
  await expect(
    loadConcurrencyProof(file, account, [returned], now),
  ).rejects.toThrow();
  await chmod(file, 0o600);
  const ret = path.join(returned, "proof.json");
  await writeFile(ret, JSON.stringify(proof), { mode: 0o600 });
  await expect(
    loadConcurrencyProof(ret, account, [returned], now),
  ).rejects.toThrow();
  await link(file, path.join(root, "hard.json"));
  await expect(
    loadConcurrencyProof(file, account, [returned], now),
  ).rejects.toThrow();
  const git = path.join(root, "repo");
  await mkdir(git);
  await mkdir(path.join(git, ".git"));
  const g = path.join(git, "proof.json");
  await writeFile(g, JSON.stringify(proof), { mode: 0o600 });
  await expect(
    loadConcurrencyProof(g, account, [returned], now),
  ).rejects.toThrow();
});

it("rejects malformed or excessive capacity settings and accepts bounded overrides", () => {
  for (const [key, values] of Object.entries({
    PRISM_RESERVED_CONCURRENCY: ["1", "13", "05", "5.0", " 5", "-1", ""],
    PRISM_API_RATE_PER_SECOND: ["1", "11", "5.5"],
    PRISM_API_BURST: ["5", "21", "1e1"],
  }))
    for (const value of values)
      expect(() => buildConcurrencyPolicy({ [key]: value })).toThrow();
  expect(
    buildConcurrencyPolicy({
      PRISM_RESERVED_CONCURRENCY: "6",
      PRISM_API_RATE_PER_SECOND: "7",
      PRISM_API_BURST: "12",
    }),
  ).toMatchObject({
    reservedConcurrentExecutions: 6,
    apiRatePerSecond: 7,
    apiBurst: 12,
  });
});

it("supports a fresh checkout with absent protected Return paths while preserving canonical exclusions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "prism-fresh-proof-"));
  const file = path.join(root, "proof.json");
  await writeFile(file, JSON.stringify(proof), { mode: 0o600 });
  expect(
    await loadConcurrencyProof(
      file,
      account,
      [path.join(root, "not-created", "return")],
      now,
    ),
  ).toMatchObject({ totalFunctionCount: 0 });
  const excluded = path.join(root, "excluded");
  await mkdir(excluded);
  const inside = path.join(excluded, "proof.json");
  await writeFile(inside, JSON.stringify(proof), { mode: 0o600 });
  const alias = path.join(root, "excluded-alias");
  await symlink(excluded, alias);
  await expect(
    loadConcurrencyProof(inside, account, [alias], now),
  ).rejects.toThrow("outside repositories and Return");
});
