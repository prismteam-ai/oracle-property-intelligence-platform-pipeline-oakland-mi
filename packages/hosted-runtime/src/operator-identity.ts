export const OPERATOR_ROLE_NAME = "prism-assessment-review-deployer";
/** Only the task's assumed operator role may perform business mutations; root/direct IAM users are rejected. */
export function assertOperatorIdentity(
  account: string,
  expectedRoleArn: string,
  actual: { Account?: string; Arn?: string },
): void {
  if (
    !/^\d{12}$/.test(account) ||
    ["000000000000", "111122223333", "123456789012"].includes(account)
  )
    throw new Error("Exact non-placeholder operator account required");
  const expected = `arn:aws:iam::${account}:role/${OPERATOR_ROLE_NAME}`;
  if (
    expectedRoleArn !== expected ||
    actual.Account !== account ||
    typeof actual.Arn !== "string" ||
    !new RegExp(
      `^arn:aws:sts::${account}:assumed-role/${OPERATOR_ROLE_NAME}/[A-Za-z0-9+=,.@_-]{2,64}$`,
    ).test(actual.Arn)
  )
    throw new Error(
      "Exact task deployment assumed-role identity required; root, direct users and other roles are rejected",
    );
}
