/** One canonical feature value binds the resume receipt and actual CDK context. */
export function reviewedDeploymentFeatures(
  env: Readonly<Record<string, string | undefined>>,
) {
  const value = env.PRISM_PAGERDUTY_ENABLED;
  if (value !== undefined && value !== "0" && value !== "1")
    throw new Error("PagerDuty feature flag must be explicit0or1");
  return { pagerDutyEnabled: value === "1" };
}
export function deploymentFeatureContext(
  features: ReturnType<typeof reviewedDeploymentFeatures>,
) {
  return features.pagerDutyEnabled ? { enablePagerDuty: "true" } : {};
}
