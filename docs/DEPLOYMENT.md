# Neutral review deployment

Target: `us-east-2`, stage `review`, stack `PrismOracleAssessmentReview`, tag `project_name=prism-assessment`, standard CDK bootstrap qualifier `prismrvw`, toolkit stack `PrismAssessmentReviewToolkit`. Keep the historical `us-east-1` review stacks as rollback; this migration does not authorize their teardown.

The operator first prepares an exact least-privilege CloudFormation execution policy and finite deployment identity, then runs the standard task-qualified `cdk bootstrap`. Bootstrap creates S3/ECR/IAM deployment resources; no application container image is required. Broad managed administrator policy is not the intended execution path.

Build with `pnpm build` and `pnpm package:lambda`; synthesize with `pnpm cdk:synth` and assert with `pnpm cdk:check`. The guarded `pnpm run deploy` defaults to a no-cloud dry run listing missing inputs. `pnpm run deploy --execute` requires clean exact source/archive/account/region/budget pins, the derived task bootstrap asset bucket, private operator directories and verified public/protected artifacts. It invokes actual `cdk deploy --app cdk.out`, not a manual CloudFormation deployment wrapper. All deployment output containing account/resource identity is retained privately and minimized for the return.

Existing-stack updates upload exact immutable data and verify server checksums before CDK changes the active configuration. First creation requires `PRISM_FIRST_CREATE_APPROVED=yes`; the new access secret is unconfigured and snapshots absent, so it remains fail closed until the exact uploads are verified. That post-provision verification is explicitly qualified separately from pre-staging an existing runtime.

`pnpm smoke`, `pnpm evidence`, `pnpm rotate-access` and `pnpm destroy` also default to guarded dry runs. Actual mutation flags require the private operator contract. Destruction remains outside this phase and must not be exercised merely to complete script inventory. Rollback means retaining/rerouting to the earlier exact release, not overwriting immutable source bytes.

Default hard cost guards remain AWS $35 and total project $75; a later handoff proposal is not authority to raise a cash ceiling. Reported usage, pending cost estimates and credits are distinct. See [retention and release gates](RELEASE_CHECKLIST.md).

Required outer identity gate: set `PRISM_EXPECTED_OPERATOR_ROLE_ARN` to the exact account-specific IAM role `prism-assessment-review-deployer`. Before any business mutation, STS must return the matching account and `assumed-role/prism-assessment-review-deployer/<session>` ARN. Root sessions, direct IAM users, and other roles are rejected. CDK may subsequently assume its separately scoped bootstrap roles. This gate is independent of having AWS credentials ready.

The optional map key has a maximum lifetime of fourteen days plus a four-hour preparation and verification margin. This permits a full fourteen-day review window after final checks. The exact expiry remains mandatory; the one CRM origin, read-only tile action and provider restriction remain enforced. The margin does not extend deployment credentials or authorize wider map access.

CloudFormation explicitly acknowledges updates to a recently used map key with `ForceUpdate`. This supports extending its expiry while retaining its key name, exact origin and read-only restrictions. It does not enable `ForceDelete` or `NoExpiry`. Verify the retained key value hash, restrictions and new expiry after deployment.
