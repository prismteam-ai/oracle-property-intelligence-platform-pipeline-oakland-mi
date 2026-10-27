# Explicit existing-account shared capacity deviation

The original default remains two reserved Oracle Lambda executions with4096MiB memory. The opt-in `existing-account-shared` route is a separate staging configuration for the already existing isolated Free account whose observed regional pool is10. It **does not provide two reserved executions** or equivalent isolation. The function omits ReservedConcurrentExecutions entirely (never0), competes in the unreserved pool, uses3008MiB memory and retains4GiB ephemeral storage and the29second timeout. The HTTP API is throttled to2requests/second with burst6; finite paced evaluation remains necessary. No paid upgrade, quota increase or future Support request is part of this route.

The lead approved this deviation after the quota request was withdrawn and closed. Actual account observations and deployment remain lead-owned. Local RIE/CDK checks do not prove cloud capacity, absence of throttling or actual Free eligibility.

## Private opt-in and proof

Every shared synthesis/deployment requires:

- `PRISM_CONCURRENCY_MODE=existing-account-shared`
- `PRISM_SHARED_ACCOUNT_CONCURRENCY_APPROVED=yes`
- `PRISM_EXISTING_ACCOUNT_CONCURRENCY=10`
- `PRISM_ACCOUNT_CONCURRENCY_PROOF=<private metadata path>`

The proof must be an owner0600 single-link regular file outside Git and the Return bundle, with no symlink ancestors. It contains only the lead's actual GetAccountSettings/ListFunctions metadata:

```json
{
  "version": 1,
  "observedAt": "<UTC_ISO_TIMESTAMP>",
  "accountId": "<EXACT_PRIVATE_ACCOUNT>",
  "region": "us-east-1",
  "concurrentExecutions": 10,
  "unreservedConcurrentExecutions": 10,
  "totalFunctionCount": 0,
  "functions": []
}
```

At deployment start, proof age must be at most15minutes (future tolerance30seconds). Initially functions must be empty; on resume only the two exact task handlers are permitted, at most one of each, with matching exact account/region/function ARNs and count. Names must match `PrismOracleReview-ReadApiB934CF2C-<generated suffix>` or `PrismCrmP3Review-CrmHandler98FEA697-<generated suffix>`. Any other function, region, quota, extra field or inconsistent count fails closed. Refreshing a stale proof requires another honest lead observation, never relabeling an old timestamp. No new AWS read rights are added to the deployer.

CDK context names are `concurrencyMode=existing-account-shared` and `existingAccountConcurrency=10`; the explicit approval/proof environment is still required. Outputs record ConcurrencyMode, FunctionReservedConcurrency=`none`, ExistingAccountConcurrency=`10`, ConcurrencyProofSha256, FunctionMemoryMiB=`3008`, ApiRatePerSecond and ApiBurst. The strict mode reports reserved2; it is not silently substituted.

Guarded operations bind policy, proof SHA, memory and `PRISM_SHARED_ACCOUNT_OPERATION_LIMIT` (an explicit integer1..100) into the private receipt. This is a finite **AWS CLI invocation** allowance, persisted before each dispatch, including failed calls; it is not a count of CloudFormation's internal service requests. The lead still owns a finite browser/query/model corpus, pending-plus-actual spending caps, request pacing and actual billing. Product data/authentication/session quotas and public/protected artifact hashes remain unchanged. Non-deploy evidence/smoke reads actual stack capacity outputs rather than asserting a fresh account observation.

## Local memory proof

Build the exact clean staging ZIP first, then run public and protected real artifacts through the existing pinned official AWS Node24/AL2023 Runtime Interface Emulator with `PRISM_EMULATOR_MEMORY_MIB=3008`. The Docker cap is3008MiB and one CPU, networking disabled, archive/data read-only. Reports contain counts/digests/status only, maximum measured invocation latency and the configured29second envelope. This is a local conservative CPU/memory-cap test, not deployed Lambda timing or concurrency proof.

## Explicit STS profile handling

Do not use an automatic assume-role profile: its SDK/CLI role cache can default to the user's global `~/.aws/cli/cache`; the login cache override alone does not isolate it. The lead explicitly requests STS AssumeRole from the private source-user profile, captures the response only to a mode600 private file, then writes a **static temporary** deployer profile (access key/secret/session token) in the task-isolated private credential file. No role_arn/source_profile automatic provider is configured. Request15minute sessions, or an explicitly reviewed duration up to the role's1hour maximum, renewed manually only inside the fixed2hour source-policy window. The current source policy is SHA16bf29c0f3dd5779a0fc4b3017b0aee0080f18d7202f4c5f6d50848f72df34c1 with explicit Denies; the earlier implicit-only source policy is rejected. Source-key deletion and reviewed role-session revocation remain mandatory closeout steps; no automatic extension or credential recreation is authorized.
