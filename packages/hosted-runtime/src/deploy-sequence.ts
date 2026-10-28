import type { ExistingStackBindings } from "./prestage.ts";

/** The injected effects are ordered differently only for explicitly acknowledged first creation. */
export async function reviewedDeployment<T>(input: {
  existing: ExistingStackBindings | undefined;
  firstCreateApproved: boolean;
  prestage: (existing: ExistingStackBindings) => Promise<T>;
  deploy: () => Promise<void>;
  describeCreated: () => Promise<ExistingStackBindings>;
}): Promise<{
  proof: T;
  activation: "prestage_verified" | "first_create_post_provision_verified";
}> {
  if (input.existing) {
    // A checksum/source/rights failure must prevent an existing runtime update.
    const proof = await input.prestage(input.existing);
    await input.deploy();
    return { proof, activation: "prestage_verified" };
  }
  if (!input.firstCreateApproved)
    throw new Error(
      "First creation requires the explicit neutral assessment-stack acknowledgment",
    );
  // The new stack has an unconfigured access secret and missing snapshots: it
  // fails closed. Data is validated before the operator can release access.
  await input.deploy();
  const bindings = await input.describeCreated();
  const proof = await input.prestage(bindings);
  return { proof, activation: "first_create_post_provision_verified" };
}
