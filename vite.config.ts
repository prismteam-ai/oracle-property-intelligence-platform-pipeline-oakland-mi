import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sourceIdentity } from "./packages/hosted-runtime/src/source-identity.ts";
import {
  runtimeIdentity,
  validatedRegion,
} from "./packages/hosted-runtime/src/release.ts";
import { CONTRACT_VERSION } from "./packages/contracts/src/index.ts";
import { defineConfig } from "vite";
import { thirdPartyNoticesPlugin } from "./scripts/third-party-notices.ts";
const stage = process.env.PRISM_RELEASE_STAGE ?? "local";
if (stage !== "local" && stage !== "p3-review")
  throw new Error("Invalid UI release stage");
const identity = runtimeIdentity(
  "oracle",
  sourceIdentity(),
  {
    version: CONTRACT_VERSION,
    sha256: createHash("sha256")
      .update(readFileSync("packages/contracts/src/index.ts"))
      .digest("hex"),
  },
  stage,
  validatedRegion(process.env.PRISM_DEPLOY_REGION ?? "us-east-1", [
    process.env.AWS_REGION,
    process.env.AWS_DEFAULT_REGION,
  ]),
);
export default defineConfig({
  plugins: [thirdPartyNoticesPlugin()],
  define: { __PRISM_UI_IDENTITY__: JSON.stringify(identity) },
  root: "apps/pipeline-web",
  build: { outDir: "../../dist", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:4310" } },
});
