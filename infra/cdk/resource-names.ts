import { Token } from "aws-cdk-lib";
/** Explicit names keep full task prefixes inside narrow deployment IAM despite CDK autoname truncation. */
export function assessmentResourceNames(
  stackName: string,
  account: string,
  region: string,
) {
  if (!/^[A-Za-z][A-Za-z0-9-]+$/.test(stackName))
    throw new Error("Assessment stack name rejected");
  const representativeAccount = Token.isUnresolved(account)
    ? "234567890123"
    : account;
  if (!/^\d{12}$/.test(representativeAccount) || region !== "us-east-2")
    throw new Error("Assessment resource account/region rejected");
  const bucket = (suffix: string) => {
    const representative = `${stackName.toLowerCase()}-${suffix}-${representativeAccount}-${region}`;
    if (
      representative.length > 63 ||
      !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(representative)
    )
      throw new Error("Explicit assessment bucket name exceeds S3 bounds");
    return `${stackName.toLowerCase()}-${suffix}-${account}-${region}`;
  };
  const role = (suffix: string) => {
    const name = `${stackName}-${suffix}`;
    if (name.length > 64)
      throw new Error("Explicit assessment role name exceeds IAM bounds");
    return name;
  };
  return {
    siteBucket: bucket("site"),
    acceptedBucket: bucket("accepted"),
    protectedBucket: bucket("protected"),
    readApiRole: role("ReadApiRole"),
    alertRole: role("AlertNotifierRole"),
    accessSecret: `${stackName}-ReviewAccess`,
    pagerDutySecret: `${stackName}-PagerDutyRouting`,
    retentionParameter: `${stackName}-ReviewRetention`,
  };
}
