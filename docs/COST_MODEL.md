# Costs, retention and teardown

The producer runs on demand; the hosted read plane scales to zero between requests. Storage, secrets, logs, metrics, alarms, maps and inference can still consume credits or cash. This architecture is low-default-cost, not permanently free.

## Measured usage, credits and estimates

The dated 2026-10-29 bill view displayed an October estimate of USD0; service details and Cost Explorer line items were unavailable. That is not a final invoice or proof of zero gross usage. A later read-only account observation at 06:17:02Z showed Free ACTIVE with USD140 credits. Credits remain separate from gross consumption and future cash exposure.

The accepted durable model ledger at 06:37:38Z recorded 110 validated requests, 77 reservations and 76 measured responses totaling **USD0.004567** in usage-priced estimates, with one older unknown reservation retained. Within that history, the accepted campaign used 36 distinct grounded backend turns plus three measured UI responses (two failed harnesses and one full pass), **USD0.002346**. Empty/refused cases are not measured model successes. Later release/media/evaluator usage is additional and must be reconciled without resetting counters. See [quotas](EVALUATOR_GUIDE.md).

No paid source, subscription, add-on or plan upgrade is required, purchased or needed to reproduce the admitted runtime. The completed free-source disposition is in [known limitations](KNOWN_LIMITATIONS.md). Existing AWS USD35 / whole-project USD75 ceilings remain guards, not purchase authority. The earlier release assembly used USD5 incremental gross / USD1 inference planning ceilings. The current bounded correction instead permits at most four additional model calls / USD0.50 and USD2 additional AWS usage before credits or tax, within existing cumulative quotas. Neither limit is purchase authority; stop before any displayed charge or plan change.

## Whole-inventory planning model

The dated [cost estimate](COST_ESTIMATE.json) binds the 03:53:04Z resource inventory and official rate inputs. It models 34 observed custom metric series, 12 standard alarm metrics, two dashboards and four secrets. Those are scoped counts; continuous metric activity, traffic and storage remain assumptions.

Before allowances/credits, the hypothetical whole-inventory forecast is **USD1.16 / USD8.15 / USD16.29 / USD34.91 for 1 / 7 / 14 / 30 days**. It assumes 1,000 API calls/day (75% Oracle at 3 GiB / 10 s, 25% CRM at 0.5 GiB / 2 s), ten daily map views of 100 tiles, 10 GB S3, 1 GB DynamoDB, 1 GB stored logs, 0.01 GB daily log ingestion and 20 daily model turns of 2,000 input / 300 output tokens, plus bounded activities and USD0.05/day contingency. The scenario does not override actual quotas or predict measured future use.

Selected rates have official primary-source support, including the global CloudWatch USD3/dashboard-month unit. If every modeled account allowance were eligible and unused, sensitivity values are USD0.42 / USD2.92 / USD5.84 / USD17.23; these are not cash forecasts. The USD140 credit observation is not deducted from either series. The inherited USD23 reserve includes prior pending consumption and review provision; it is not spend or wholly unused headroom. Reconcile it rather than adding the whole-inventory scenario twice. Thirty-day gross is already close to the USD35 AWS ceiling before prior usage.

Primary rate references are [Lambda](https://aws.amazon.com/lambda/pricing/), [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/), [Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/) and [HTTP API](https://aws.amazon.com/api-gateway/pricing/). Exact inputs, assumptions and formulas are bound in the external evidence packet. Refresh actual bill/credit/usage observations separately before making new cost claims.

## Retention and teardown

The dated access sheet and configured-expiry receipt state the actual retained-through date. Preserve the review runtime for the agreed finite review window; any extension needs owner authority and cost reconciliation. The prior accepted map window ended no earlier than 2026-11-12T08:17:25Z. A documentation change does not extend it. Budget notifications are not automatic teardown or a permanent availability promise.

`pnpm run destroy --dry-run` prepares a guarded plan. Actual `pnpm run destroy --execute` requires fresh scoped authority, exact stack/account/region/source pins, exported-evidence digest and explicit teardown acknowledgment. Revoke access and verify denial first; remove CRM before Oracle. Preserve rollback stacks/shared bootstrap assets unless separately approved. Check retained S3 versions, operational records, logs, secrets, map keys and CDN resources, then verify inventory, endpoint denial and residual billing. AWS deletion cannot retract IPFS replicas. See [deployment](DEPLOYMENT.md) and [security](SECURITY_PRIVACY.md).

Retention is the actual earliest enforced dependency expiry in the latest external access receipt, not an inherited date or automatic extension from a source revision. A fourteen-day target is an operational choice unless supported by the current explicit review contract/readback. Session TTL, capability rotation, shared model quota and endpoint/map availability remain separate finite controls.
