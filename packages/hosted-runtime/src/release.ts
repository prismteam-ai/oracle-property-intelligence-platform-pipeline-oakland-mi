import { createHash } from "node:crypto";
export const STAGING_REGION = "us-east-2" as const;
export const STAGING_STAGE = "review" as const;
export const BOOTSTRAP_QUALIFIER = "prismrvw" as const;
export const APPROVED_PUBLIC_MANIFEST_SHA256 =
  "d3f82cc0b00eb8345f94c7e5ffb21e37fd928bc9c5af771d005e6f700d879bbb";
export const APPROVED_PRIVATE_MANIFEST_SHA256 =
  "bb2d7da5cf8544fbf31832701ccf87536b80388856192d46758c9b0d9e5ee592";
export interface SourceIdentity {
  head: string;
  tree: string;
  dirty: boolean;
}
export interface RuntimeIdentity {
  application: "oracle" | "crm";
  head: string;
  tree: string;
  sourceDirty: boolean;
  buildId: string;
  contractVersion: string;
  contractSha256: string;
  stage: "local" | typeof STAGING_STAGE;
  region: typeof STAGING_REGION;
}
export interface ReleasePins {
  expectedAccountId: string;
  region: string;
  stage: string;
  head: string;
  tree: string;
  archiveSha256: string;
  publicManifestSha256: string;
  privateManifestSha256?: string;
  assetBucket: string;
  assetPrefix: string;
  stackName: string;
}
const hash = (n: number) => (s: string) =>
  new RegExp(`^[a-f0-9]{${n}}$`).test(s) && !/^0+$/.test(s);
export function validatedRegion(
  region: string,
  ambient: readonly (string | undefined)[] = [],
): typeof STAGING_REGION {
  if (
    region !== STAGING_REGION ||
    ambient.some((r) => r !== undefined && r !== "" && r !== region)
  )
    throw new Error(
      "Review deployment region must be us-east-2; mixed regions are rejected",
    );
  return STAGING_REGION;
}
export function validateReleasePins(p: ReleasePins): ReleasePins {
  validatedRegion(p.region);
  if (
    p.stage !== STAGING_STAGE ||
    !/^\d{12}$/.test(p.expectedAccountId) ||
    ["000000000000", "111122223333", "123456789012"].includes(
      p.expectedAccountId,
    ) ||
    !hash(40)(p.head) ||
    !hash(40)(p.tree) ||
    !hash(64)(p.archiveSha256)
  )
    throw new Error(
      "Exact non-placeholder account/source/archive release pins required",
    );
  if (
    p.publicManifestSha256 !== APPROVED_PUBLIC_MANIFEST_SHA256 ||
    (p.privateManifestSha256 !== undefined &&
      p.privateManifestSha256 !== APPROVED_PRIVATE_MANIFEST_SHA256)
  )
    throw new Error(
      "Only the exact reviewed current public/operational manifests are authorized",
    );
  if (
    p.assetBucket !==
      `cdk-${BOOTSTRAP_QUALIFIER}-assets-${p.expectedAccountId}-${STAGING_REGION}` ||
    p.assetPrefix !== "" ||
    !["PrismOracleAssessmentReview", "PrismCrmAssessmentReview"].includes(
      p.stackName,
    )
  )
    throw new Error(
      "Exact task CDK bootstrap bucket and neutral stack name required",
    );
  return p;
}
export function assertPinnedSource(p: ReleasePins, s: SourceIdentity) {
  if (s.dirty || s.head !== p.head || s.tree !== p.tree)
    throw new Error("Release requires the exact pinned clean HEAD and tree");
}
export function assertCallerAccount(p: ReleasePins, actual: string) {
  if (actual !== p.expectedAccountId)
    throw new Error(
      "AWS caller account does not match the private approved account pin",
    );
}
export function assertCostEnvelope(cost: {
  awsActual: number;
  awsPending: number;
  totalActual: number;
  totalPending: number;
}) {
  if (
    Object.values(cost).some((n) => !Number.isFinite(n) || n < 0) ||
    cost.awsActual + cost.awsPending > 35 ||
    cost.totalActual + cost.totalPending > 75
  )
    throw new Error(
      "Review cost envelope is missing, invalid or would exceed an authorized ceiling",
    );
}
export function runtimeIdentity(
  application: "oracle" | "crm",
  source: SourceIdentity,
  contract: { version: string; sha256: string },
  stage: "local" | typeof STAGING_STAGE,
  region = STAGING_REGION,
): RuntimeIdentity {
  validatedRegion(region);
  if (
    !hash(40)(source.head) ||
    !hash(40)(source.tree) ||
    !hash(64)(contract.sha256) ||
    (stage === STAGING_STAGE && source.dirty)
  )
    throw new Error(
      "Staging build requires a clean exact source identity and contract hash",
    );
  const data = {
    application,
    head: source.head,
    tree: source.tree,
    sourceDirty: source.dirty,
    contractVersion: contract.version,
    contractSha256: contract.sha256,
    stage,
    region,
  };
  return {
    ...data,
    buildId: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
  };
}
export function assertPackageIdentity(
  p: ReleasePins,
  identity: RuntimeIdentity,
  archiveSha256: string,
) {
  if (
    identity.head !== p.head ||
    identity.tree !== p.tree ||
    identity.sourceDirty ||
    identity.stage !== STAGING_STAGE ||
    identity.region !== p.region ||
    archiveSha256 !== p.archiveSha256
  )
    throw new Error(
      "Measured deployment package does not match the pinned staging release",
    );
}
