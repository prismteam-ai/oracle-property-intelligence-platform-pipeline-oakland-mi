# P3 bounded staging operator runbook

Only the lead operator performs approved account actions. Local preparation and the commands without `--execute` do not authenticate or call AWS. Use Node 24 and the frozen lockfile with install scripts disabled. Do not run default CDK bootstrap: this stack uses an explicit task S3 asset bucket and a measured ZIP key, with no ECR or CDK assets.

## Release identity and local preparation

The deployment region is parameterized but frozen to `us-east-1`. A different region or conflicting `AWS_REGION`/`AWS_DEFAULT_REGION` fails. The accepted contract remains 0.2.1 and the public snapshot remains `oakland-real-71c0ba7aafadd0e4301b`. Both exact approved public/private manifest digests are constants in `packages/hosted-runtime/src/release.ts`.

Commit all reviewed source changes first. A staging package rejects a dirty source tree. Health and the package report bind the committed HEAD/tree, contract SHA, stage, region and deterministic build ID. The frontend embeds its own source identity and is rebuilt from the pinned clean source before deploy. Deployment receipts bind its file digest and configuration, including MCP origins, optional map origin/expiry and protected mode.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
# Local package/synthesis use no AWS account or service:
pnpm package:lambda
pnpm cdk:check
# After a reviewed clean commit, create the staging archive:
PRISM_RELEASE_STAGE=p3-review PRISM_DEPLOY_REGION=us-east-1 pnpm package:lambda
```

Local synthesis without account context deliberately references `prism-p3-local-synth-assets`; this is a local placeholder, never a deployment instruction. `pnpm cdk:check` asserts Node24/x64, the measured S3 ZIP, frozen region, exact source outputs, OAC, private retained buckets, scoped runtime IAM, shared session/quota TTL, alarms and absence of bootstrap/ECR resources.

## Required private operator inputs

Supply these privately through the approved operator environment; never paste values or credentials in chat or evidence:

- `PRISM_CLOUD_EXECUTION_APPROVED=yes`, plus the explicit `--execute` command flag.
- `PRISM_EXPECTED_ACCOUNT_ID`, `PRISM_EXPECTED_HEAD`, `PRISM_EXPECTED_TREE`, `PRISM_EXPECTED_ARCHIVE_SHA256` matching the reviewed clean source and staging package report.
- `PRISM_DEPLOY_REGION=us-east-1`; a dedicated pre-existing `PRISM_DEPLOY_ASSET_BUCKET` whose name starts `prism-p3-`, in the same account/region, all public-access blocks enabled and default encryption configured.
- `PRISM_CFN_EXECUTION_ROLE_ARN`, an approved task-scoped role in that exact account, named under `prism-p3-`. Provision only the necessary CloudFormation control-plane rights and task resource prefixes/tags. This script creates no bootstrap or deploy role.
- `PRISM_PRIVATE_OPERATIONS_DIR`, outside Git and all returned evidence. Private resumable receipts and stack outputs are saved there with restrictive permissions.
- `PRISM_AWS_ACTUAL_USD`, `PRISM_AWS_PENDING_USD`, `PRISM_P3_ACTUAL_USD`, `PRISM_P3_PENDING_USD`. The AWS sum must remain at most $35 and total at most $75. These measured operator inputs do not replace live billing reconciliation.
- `PRISM_SNAPSHOT_DIR`, the exact verified public-safe baseline artifact directory.

For the separately reviewed protected companion, also set `PRISM_PRIVATE_OPERATIONAL_DIR` and `PRISM_PRIVATE_PROMOTION_APPROVED=yes`. Only the exact two reviewed Parquet files and their exact manifest are accepted. No raw PDFs, owner names, postal/contact fields or arbitrary input directory is uploaded. The public and protected buckets/prefixes are separate and runtime permissions are read-only. Protected cache verification enforces the public base and exact private manifest before opening either sidecar. Local-access mode refuses protected data.

`PRISM_MCP_ALLOWED_ORIGINS` is an optional comma-separated exact Origin allowlist. Non-browser MCP clients may omit Origin. Browsers with another Origin are rejected; the same signed evaluator session, stored-session check and read quota apply to `/api/mcp`. Search is capped at50 rows and the complete MCP response at4MB; there is no arbitrary SQL or write tool.

```sh
pnpm deploy                 # dry-run plan only
pnpm deploy --execute       # lead operator only, with all private pins above
```

The executor checks the actual STS account against the approved pin, validates the existing task asset bucket, uploads the measured ZIP to `prism-p3/oracle/lambda/<sha>.zip`, synthesizes with no lookups, then uses `cloudformation deploy` with the approved role. It uploads only manifest-listed exact public/private files, rebuilds/uploads the frontend and invalidates index/root. Service errors are captured and redacted. A failed step is not recorded as completed; configuration changes produce a different receipt. After a completed stack step, deployed outputs must match source, archive, build, contract, stage and region. Returned deployment output contains no secret values.

## Shared evaluator access and map configuration

Oracle owns the shared evaluator Secret and session/quota table. Pass their ARN outputs to CRM; neither app has an independent access issuer. `pnpm rotate-access --execute` reads a review code privately from stdin, rotates signing key/digest/version and preserves other Secret fields, including CRM's optional `locationMap`. Existing sessions stop validating when the Secret cache expires (at most60 seconds). Runtime gets only the exact Secret, table keys `session#*`/`quota#*`, exact snapshot prefixes and its own log group.

Amazon Location V2 does not need a Map resource. After the actual CRM CloudFront origin is known, the lead may resynthesize with `PRISM_CRM_MAP_ORIGIN` (one exact `https://d….cloudfront.net` origin) and `PRISM_MAP_KEY_EXPIRES_AT` (future ISO time, at most14 days). The optional key is OFF otherwise. It allows only `geo-maps:GetTile` on `arn:aws:geo-maps:us-east-1::provider/default`, with the exact origin plus `/*` referrer restriction. Outputs contain key name/ARN, never key value. The parent privately configures CRM's shared Secret field `locationMap`; no key is embedded in this repo, Lambda environment, build archive or returned evidence. A denied map request is evidence to investigate within the approved scope, not permission to broaden actions or referers automatically.

Official references: [Location API key restrictions](https://docs.aws.amazon.com/location/latest/developerguide/using-apikeys.html), [GetTile](https://docs.aws.amazon.com/location/latest/APIReference/API_geomaps_GetTile.html), [CDK synthesizer behavior](https://docs.aws.amazon.com/cdk/api/v2/python/aws_cdk/BootstraplessSynthesizer.html). The operator uses direct CloudFormation with an explicit execution role and existing S3 ZIP, so no CDK bootstrap roles/assets are provisioned.

## Protected report context and evidence

Authenticated protected `GET /api/source-context?sourceId=…&page=…` exposes a two-source metadata registry, not observation rows. Unknown IDs, extra parameters and pages beyond the verified report are rejected. It gives official report/page/landing URLs, retrieval time, body digest, exact-PIN normalization/membership method and building-year-proxy caveats. Neither report declares a period in the reviewed headers; extracted sale-date ranges are explicitly separate. `built_year` remains the contract enum, while the UI calls it a **building year proxy**. Roof replacement is unverified; reported sale events do not establish complete transfer history or ten-year tenure.

`pnpm smoke --execute` reads the review code from stdin, targets only the deployed exact CloudFront origin, forbids redirects, applies deadlines/response caps, validates release health, opens a signed session, searches, discovers/calls MCP and requires successful logout. It outputs only statuses and release/snapshot identity. Cloud smoke, persistence and UI/model/map proofs still require actual staging evidence; local tests or synthesis do not satisfy them. Private browser assertions must be followed by evidence-only screenshot masks over identifying observation sections; sidecars state masks and counts/digests, never private row values.

## Rotation and teardown

`pnpm evidence`/`pnpm destroy` are dry-run plans by default. Actual teardown additionally requires `PRISM_TEARDOWN_APPROVED=yes` and the exported evidence archive SHA. It revokes review access, deletes the one scoped map key if present and requests deletion of only the exact task stack. Buckets/versions, evaluator table, logs and Secret are intentionally retained for a human-reviewed14-day window. The command explicitly reports retained cleanup needed and `billingCeased:false`; it does not claim resources or charges disappeared. The lead must record exact retained-resource decisions and billing reconciliation separately before any final cessation claim.
