import { expect, it, vi } from "vitest";
import { assertOperatorIdentity } from "../packages/hosted-runtime/src/operator-identity.ts";
const account = "234567890123";
const expected = `arn:aws:iam::${account}:role/prism-assessment-review-deployer`;
it("permits only the exact task assumed-role session before business mutations", () => {
  const mutation = vi.fn();
  function execute(
    actual: { Account?: string; Arn?: string },
    role = expected,
  ) {
    assertOperatorIdentity(account, role, actual);
    mutation();
  }
  const valid = {
    Account: account,
    Arn: `arn:aws:sts::${account}:assumed-role/prism-assessment-review-deployer/synthetic-local-session`,
  };
  for (const invalid of [
    { Account: account, Arn: `arn:aws:iam::${account}:root` },
    { Account: account, Arn: `arn:aws:iam::${account}:user/deployment-user` },
    {
      Account: account,
      Arn: `arn:aws:sts::${account}:assumed-role/OtherRole/synthetic-session`,
    },
    { Account: "345678901234", Arn: valid.Arn },
    { Account: account, Arn: valid.Arn + "/extra" },
    { Account: account },
    {},
  ])
    expect(() => execute(invalid)).toThrow("assumed-role");
  expect(() => execute(valid, "")).toThrow("assumed-role");
  expect(mutation).not.toHaveBeenCalled();
  execute(valid);
  expect(mutation).toHaveBeenCalledTimes(1);
});
