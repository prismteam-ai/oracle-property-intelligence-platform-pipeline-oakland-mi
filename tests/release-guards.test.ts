import { it, expect } from "vitest";
import {
  APPROVED_PRIVATE_MANIFEST_SHA256,
  APPROVED_PUBLIC_MANIFEST_SHA256,
  validateReleasePins,
  validatedRegion,
  assertPinnedSource,
  assertCallerAccount,
  assertCostEnvelope,
  runtimeIdentity,
  assertPackageIdentity,
  type ReleasePins,
} from "../packages/hosted-runtime/src/release.ts";
const p: ReleasePins = {
  expectedAccountId: "234567890123",
  region: "us-east-1",
  stage: "p3-review",
  head: "a".repeat(40),
  tree: "b".repeat(40),
  archiveSha256: "c".repeat(64),
  publicManifestSha256: APPROVED_PUBLIC_MANIFEST_SHA256,
  privateManifestSha256: APPROVED_PRIVATE_MANIFEST_SHA256,
  assetBucket: "prism-p3-test-assets",
  assetPrefix: "prism-p3/oracle/",
  stackName: "PrismOracleReview",
};
it("freezes one region and rejects mixed ambient region and unreviewed pins", () => {
  expect(validateReleasePins(p)).toEqual(p);
  for (const delta of [
    { region: "us-east-2" },
    { head: "0".repeat(40) },
    { expectedAccountId: "123456789012" },
    { publicManifestSha256: "d".repeat(64) },
    { privateManifestSha256: "d".repeat(64) },
    { assetPrefix: "shared/" },
    { assetBucket: "replace-me" },
  ])
    expect(() => validateReleasePins({ ...p, ...delta })).toThrow();
  expect(() => validatedRegion("us-east-1", ["us-east-2"])).toThrow();
});
it("enforces exact clean source, account and measured package before effects", () => {
  const source = { head: p.head, tree: p.tree, dirty: false };
  assertPinnedSource(p, source);
  expect(() => assertPinnedSource(p, { ...source, dirty: true })).toThrow();
  expect(() => assertCallerAccount(p, "345678901234")).toThrow();
  const identity = runtimeIdentity(
    "oracle",
    source,
    { version: "0.2.1", sha256: "d".repeat(64) },
    "p3-review",
  );
  assertPackageIdentity(p, identity, p.archiveSha256);
  expect(() =>
    assertPackageIdentity(
      p,
      { ...identity, head: "e".repeat(40) },
      p.archiveSha256,
    ),
  ).toThrow();
  expect(() =>
    runtimeIdentity(
      "oracle",
      { ...source, dirty: true },
      { version: "0.2.1", sha256: "d".repeat(64) },
      "p3-review",
    ),
  ).toThrow();
});
it("rejects invalid or over-ceiling spend before a service action", () => {
  assertCostEnvelope({
    awsActual: 0,
    awsPending: 20,
    totalActual: 0,
    totalPending: 35,
  });
  for (const c of [
    { awsActual: 35, awsPending: 1, totalActual: 35, totalPending: 1 },
    { awsActual: 0, awsPending: 1, totalActual: 75, totalPending: 1 },
    { awsActual: NaN, awsPending: 0, totalActual: 0, totalPending: 0 },
  ])
    expect(() => assertCostEnvelope(c)).toThrow();
});
