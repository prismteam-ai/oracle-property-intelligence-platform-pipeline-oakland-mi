import { expect, test } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { build, type Metafile } from "esbuild";
import path from "node:path";
import { assessmentObservability } from "../infra/cdk/observability.ts";
import {
  emittedBundleModules,
  lambdaBundleOptions,
  lambdaBundles,
  lambdaEntrypointInventory,
} from "../scripts/lambda-bundles.ts";
import type { RuntimeIdentity } from "../packages/hosted-runtime/src/release.ts";

const identity: RuntimeIdentity = {
  application: "oracle",
  head: "a".repeat(40),
  tree: "b".repeat(40),
  sourceDirty: false,
  buildId: "c".repeat(64),
  contractVersion: "0.6.0",
  contractSha256: "d".repeat(64),
  stage: "local",
  region: "us-east-2",
};

test("dedicated emitted alert entry exports the handler without the API or DuckDB dependency graph", async () => {
  const alert = lambdaBundles.find((bundle) => bundle.file === "alert.mjs")!;
  const result = await build({
    ...lambdaBundleOptions(
      process.cwd(),
      path.resolve("unused-memory-only"),
      identity,
      alert,
    ),
    write: false,
  });
  expect(result.metafile).toBeDefined();
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs).toContain("apps/api/src/alert-lambda.ts");
  expect(inputs).toContain("packages/hosted-runtime/src/alerts.ts");
  expect(
    inputs.some((name) =>
      /@duckdb|packages\/query\/|apps\/api\/src\/(?:lambda|handler)\.ts$/.test(
        name,
      ),
    ),
  ).toBe(false);
  const output = Object.values(result.metafile!.outputs).find(
    (value) => value.entryPoint === "apps/api/src/alert-lambda.ts",
  )!;
  expect(output.exports).toContain("alertHandler");
  expect(result.outputFiles).toHaveLength(1);
});

test("existing notifier resource uses dedicated ZIP handler with unchanged128MiB ten-second bounds", () => {
  const app = new App();
  const stack = new Stack(app, "SyntheticAlertBinding", {
    env: { account: "234567890123", region: "us-east-2" },
  });
  const code = Code.fromInline(
    "exports.handler = async () => ({statusCode:200});",
  );
  const api = new Function(stack, "SyntheticApi", {
    runtime: Runtime.NODEJS_24_X,
    handler: "index.handler",
    code,
  });
  assessmentObservability({
    stack,
    api,
    code,
    alarms: [],
    pagerDutyEnabled: false,
    reservedMode: true,
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs("AWS::Lambda::Function", 2);
  template.hasResourceProperties("AWS::Lambda::Function", {
    Handler: "alert.alertHandler",
    Runtime: "nodejs24.x",
    MemorySize: 128,
    Timeout: 10,
    ReservedConcurrentExecutions: 1,
  });
  template.hasResourceProperties("AWS::Lambda::EventInvokeConfig", {
    MaximumRetryAttempts: 0,
    MaximumEventAgeInSeconds: 60,
  });
});

test("ZIP report requires both entry bodies/graphs and notice collection combines both emitted dependency graphs", () => {
  const files = lambdaBundles.flatMap((entry) => [
    { name: entry.file, bytes: 100, sha256: "a".repeat(64) },
    { name: entry.metafile, bytes: 20, sha256: "b".repeat(64) },
  ]);
  expect(
    lambdaEntrypointInventory(files).map((entry) => [
      entry.file,
      entry.bytes,
      entry.sha256,
    ]),
  ).toEqual([
    ["index.mjs", 100, "a".repeat(64)],
    ["alert.mjs", 100, "a".repeat(64)],
  ]);
  expect(() =>
    lambdaEntrypointInventory(
      files.filter((file) => file.name !== "alert.mjs"),
    ),
  ).toThrow("entry or metafile missing");
  const metafiles = [
    {
      outputs: {
        "index.mjs": {
          inputs: {
            "api-only.js": { bytesInOutput: 1 },
            "shared.js": { bytesInOutput: 2 },
            "unused.js": { bytesInOutput: 0 },
          },
        },
      },
    },
    {
      outputs: {
        "alert.mjs": {
          inputs: {
            "alert-only.js": { bytesInOutput: 3 },
            "shared.js": { bytesInOutput: 4 },
          },
        },
      },
    },
  ] as unknown as Metafile[];
  expect(emittedBundleModules(metafiles)).toEqual([
    "api-only.js",
    "shared.js",
    "alert-only.js",
  ]);
});
