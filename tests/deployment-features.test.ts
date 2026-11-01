import { expect, it, vi } from "vitest";
import {
  reviewedDeploymentFeatures,
  deploymentFeatureContext,
} from "../packages/hosted-runtime/src/deployment-features.ts";
import { createHash } from "node:crypto";
it("PagerDuty context changes always change the canonical resume-receipt feature binding", () => {
  const disabled = reviewedDeploymentFeatures({ PRISM_PAGERDUTY_ENABLED: "0" });
  const enabled = reviewedDeploymentFeatures({ PRISM_PAGERDUTY_ENABLED: "1" });
  const receipt = (features: typeof disabled) =>
    createHash("sha256")
      .update(JSON.stringify({ source: "same-source", ...features }))
      .digest("hex");
  expect(receipt(disabled)).not.toBe(receipt(enabled));
  expect(deploymentFeatureContext(disabled)).toEqual({});
  expect(deploymentFeatureContext(enabled)).toEqual({
    enablePagerDuty: "true",
  });
  expect(receipt(reviewedDeploymentFeatures({}))).toBe(receipt(disabled));
});
it("invalid feature values fail before any caller can perform a deployment effect", () => {
  const effect = vi.fn();
  for (const value of ["true", "yes", "2"])
    expect(() => {
      reviewedDeploymentFeatures({ PRISM_PAGERDUTY_ENABLED: value });
      effect();
    }).toThrow();
  expect(effect).not.toHaveBeenCalled();
});
