# Review deployment and rollback

The existing target is `us-east-2`, stage `review`, stack `PrismOracleAssessmentReview`, task tag `project_name=prism-assessment`, CDK qualifier `prismrvw` and toolkit stack `PrismAssessmentReviewToolkit`. Preserve historical review stacks and shared bootstrap resources as rollback assets. Release assembly updates existing resources; it adds no service or paid plan.

## Build and guard the update

Use `pnpm build` and `pnpm package:lambda`, then `pnpm cdk:synth` and `pnpm cdk:check` under the approved exact operator configuration. Real/protected release packaging uses the verified admitted artifacts and intended review-mode frontend configuration; default local-stage hashes are not review hashes. Repeat the build and compare ZIP/frontend digests.

`pnpm run deploy` defaults to a no-cloud plan listing missing inputs. `pnpm run deploy --execute` requires clean exact source/tree/archive/account/region/budget pins, the task bootstrap asset bucket, private operator directories and verified public/protected artifacts. It invokes actual `cdk deploy --app cdk.out`. Keep account/resource output private and release only minimized evidence. Do not expose operator input files or access material in Git.

The outer identity must match `PRISM_EXPECTED_OPERATOR_ROLE_ARN` for the account's `prism-assessment-review-deployer` role before business mutation. Root sessions, direct IAM users and other roles are rejected. CDK's separately scoped bootstrap roles remain distinct. A finite least-privilege CloudFormation execution policy and task-qualified bootstrap are operator prerequisites, not permission to recreate resources during every release. No broad administrator path is intended.

Existing-stack updates stage immutable data and verify server checksums before activation. First creation, if separately authorized, requires `PRISM_FIRST_CREATE_APPROVED=yes` and remains fail closed until exact uploads and access configuration are verified. It is not part of an ordinary existing-stack update.

## Bind and rehearse

Deploy Oracle before its CRM consumer. Match authenticated health and served frontend identity to clean source/tree, build/archive, contract and public/protected snapshot pins in the external dated receipt. Rehearse fresh desktop/mobile/direct-client access, map/model/MCP behavior, session/lead cleanup and telemetry. [Release status](RELEASE_STATUS.json) preserves prior accepted identities without claiming that a later checkout is deployed.

The map key requires an explicit finite expiry, one CRM origin, read-only tile action and provider restriction. Its validator permits fourteen days plus four hours of preparation/verification margin. `ForceUpdate` acknowledges expiry changes to a recently used key; it does not enable `ForceDelete` or `NoExpiry`. Verify key-value hash, restrictions and expiry after update. This margin never extends deployment credentials.

## Recovery and teardown

Keep exact failed attempts. A failed local guard makes no deployment; reconcile an actual rollback before another reviewed attempt. Rollback uses an earlier exact package/configuration and retained immutable source bytes, not fabricated deltas. `pnpm smoke`, `pnpm evidence`, `pnpm rotate-access` and `pnpm destroy` default to guarded plans; actual actions require their exact private operator contract.

AWS USD35 / project USD75 ceilings remain. Credits, measured usage and pending reserves differ. Retention and teardown follow [costs](COST_MODEL.md); destructive teardown is separate from deploying or documenting this release. [The checklist](RELEASE_CHECKLIST.md) records final closeout and acceptance gates.
