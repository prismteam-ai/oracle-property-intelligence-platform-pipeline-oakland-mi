import { CONTRACT_VERSION } from "../../contracts/src/index.ts";
import {
  STAGING_REGION,
  type RuntimeIdentity,
  validatedRegion,
} from "./release.ts";
declare const __PRISM_BUILD_METADATA__: RuntimeIdentity | undefined;
export function compiledIdentity(): RuntimeIdentity {
  if (typeof __PRISM_BUILD_METADATA__ !== "undefined")
    return __PRISM_BUILD_METADATA__;
  return {
    application: "oracle",
    head: "unpackaged-local",
    tree: "unpackaged-local",
    sourceDirty: true,
    buildId: process.env.PRISM_BUILD_ID ?? "local-unpackaged",
    contractVersion: CONTRACT_VERSION,
    contractSha256: "unpackaged-local",
    stage: "local",
    region: STAGING_REGION,
  };
}
export function assertRuntimeRegion(identity: RuntimeIdentity) {
  validatedRegion(identity.region, [
    process.env.PRISM_DEPLOY_REGION,
    process.env.AWS_REGION,
    process.env.AWS_DEFAULT_REGION,
  ]);
  if (identity.stage === "p3-review" && identity.sourceDirty)
    throw new Error("Dirty staging code is forbidden");
}
