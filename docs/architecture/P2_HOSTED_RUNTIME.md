# P2 read plane and evaluator access

The Node HTTP adapter (`apps/api/src/server.ts`) and the API Gateway v2 adapter (`apps/api/src/lambda.ts`) use the same transport-neutral handler. The handler has bounded search/detail/coverage/run/manifest routes and no raw SQL, source ingestion, model inference or mutation route. The official MCP SDK server is a separately tested stdio/Streamable HTTP component owned by the read-model lane; it is not exposed by this Lambda adapter.

Default mode is real. `PRISM_SNAPSHOT_DIR` identifies the complete, verified public-safe snapshot; missing real artifacts fail startup. A synthetic demonstration requires `PRISM_DATA_MODE=synthetic`. Local UI development additionally requires `PRISM_ACCESS_MODE=local`; this bypass is rejected by the Lambda entry point. There is no UI data-mode toggle that can mix evidence.

```sh
PRISM_DATA_MODE=synthetic PRISM_ACCESS_MODE=local pnpm api
pnpm dev
pnpm test
pnpm test:browser
pnpm package:lambda
pnpm runtime:emulate
pnpm cdk:synth
```

The browser clears results, details and response identity when filters change or a query starts. Abort signals and a monotonic generation guard reject late search and detail responses. Rendered rows carry the applied query hash, snapshot ID/digest, build ID and generation in the DOM, plus a human-readable applied-query disclosure. The browser regression suite captures those same fields alongside each screenshot and verifies every visible row against radius, roof-age and roofing-permit predicates.

## Hosted access

`POST /api/session` accepts exactly `{accessCode}`. Its SHA-256 is compared in constant time with a configured digest; neither codes nor tokens are logged. Successful authentication creates a random session ID and a signed HMAC token with a key version and expiry. The `prism_review` cookie is HttpOnly, Secure, SameSite=Strict, Path=/api. Each data request verifies its signature and checks a stored session with matching expiry. Logout revokes the stored session; rotation invalidates previous key versions after the 60-second secret cache expires. The one-hour session lifetime is independent of DynamoDB TTL deletion, so delayed TTL deletion cannot extend access.

SecretsManager supplies `{signingKey,reviewCodeDigest,keyVersion,sessionTtlSeconds}`. `DynamoSessionStore` and `DynamoQuotaStore` share a table with partition/sort keys `pk/sk` and TTL `expiresAt`. Quotas use atomic conditional counters, category and session namespaces. Authentication is limited to 10 attempts per source IP per 15 minutes; reads are limited to 120 per session per minute. Errors do not echo provider, database, file or request content. CRM must use the same access secret and session/quota table ARN so forwarded cookies retain the same identity. CRM leads remain in a separate table.

## Immutable snapshot cache

The production Lambda reads only the configured S3 prefix. `PRISM_SNAPSHOT_MANIFEST_SHA256` pins the exact `artifact-manifest.json` bytes. The cache validates the manifest before interpreting file entries, rejects unsafe paths/duplicates/size overruns, verifies every file's length and SHA-256, and publishes a complete cache through an atomic directory rename. A corrupt warm cache is revalidated and rebuilt. The read-model loader independently checks the same files and reconciles record counts before disabling external DuckDB access. S3 has no public access, and the Lambda role has prefix-scoped GetObject without listing or writes.

## Native package and local Runtime Interface Emulator

`pnpm package:lambda` builds an ESM Node 24 handler and copies the Linux x64 glibc native database packages and dependency tree. It records every packaged file's digest and size, ZIP bytes/digest, and the uncompressed limit check. Snapshot files live in S3 rather than the function ZIP. The official AWS base image is pinned to `public.ecr.aws/lambda/nodejs@sha256:92b7cccd985332238af80ac8da42d6965d418552e88955e315da4e3c0c76ca79`.

`pnpm runtime:emulate` starts that image's actual Runtime Interface Emulator with `--network none`, a read-only function mount and temporary writable `/tmp`. It invokes API Gateway v2 events through the local Lambda invocation endpoint, checks access/query/revocation guards, and executes native DuckDB `SELECT 42`. Real mode requires `PRISM_DATA_MODE=real PRISM_SNAPSHOT_DIR=/absolute/artifact/path`; the snapshot is mounted read-only. The emulation-only flag selects fixture credentials and memory session/quota stores; CDK never sets it. Production S3 and DynamoDB adapters are exercised with local fake-client tests, not live cloud calls.

Local RIE timings include container invocation overhead and are not deployed Lambda or CDN measurements. Native ABI compatibility is checked inside Amazon Linux 2023, including Node module ABI, N-API, glibc, architecture and platform. Full-real load and memory measurements are separate from synthetic behavior proof.

## Cloud template and future operation

CDK has real Lambda code assets, CloudFront with S3 origin access control, HTTPS API behavior with cache disabled, a private static bucket and versioned snapshot bucket, DynamoDB session/quota storage, SecretsManager configuration, SSM retention policy, two-week logs, throttling and error/latency alarms. It uses no account lookups. IAM scopes snapshot reads to the configured prefix and table/secret access to specific resources. It does not grant source ingestion, model inference or public publication.

`pnpm deploy`, `pnpm smoke`, `pnpm evidence`, `pnpm rotate-access`, and `pnpm destroy` print a dry-run plan by default. Future execution requires both `--execute` and `PRISM_CLOUD_EXECUTION_APPROVED=yes`, following explicit human authorization and reviewed account/region, artifacts, costs and retention. Review access is initially unconfigured; the rotation command accepts a new code only through stdin and sends secrets through stdin. No code/token enters argv, a local file or command output.

Buckets, table and logs use RETAIN. The review window is 14 days and extends while evaluation is active. Session lifetime is one hour; quota TTL has one-day cleanup grace; logs retain two weeks. Destroying the stack does not silently delete retained evaluator resources; their removal requires a separate, explicit operator decision. This phase performs local synth/emulation only. No deployed endpoint, cloud persistence, provider access or public availability is claimed.

## Optional protected operational companion

The default hosted template serves public-safe real data and leaves protected storage disabled. A separately approved private read model can be prepared with CDK contexts `enableProtectedView=true`, `privateSnapshotPrefix`, and `privateManifestSha256`. This creates a separate blocked-public-access, encrypted, retained S3 bucket and grants the read Lambda only GetObject for its exact private prefix. No private bytes are accessible through the static origin or public snapshot bucket.

The runtime requires `PRISM_ENABLE_PROTECTED_VIEW=1` and the exact `PRISM_PRIVATE_SNAPSHOT_BUCKET`, `PRISM_PRIVATE_SNAPSHOT_PREFIX`, and `PRISM_PRIVATE_SNAPSHOT_MANIFEST_SHA256`. Its separately cached `private-operational-manifest.json` must bind both `snapshotId` and `publicSnapshotId` to the accepted public base. Its canonical digest is SHA-256 of `stableJson(files sorted by name)`. Exactly two role/name pairs are allowed: `owner`/`owner-derivatives.parquet` and `enrichment`/`protected-enrichment.parquet`, each at most 128 MiB. Extra files, roles, fields, mismatched hashes and a different public base fail closed. The cache applies the same no-link and byte-integrity rules as the public cache.

Only after validation does Lambda set the authenticated factory's sidecar paths and SHA-256 values. The reader independently validates the `public_snapshot_id` column and incorporates both sidecar hashes into its protected view ID and query/cursor identity. A Node server with explicit local access rejects either protected sidecar. Authenticated operations may display source-reported built-year proxies and partial reported-sale events; a reported sale remains separate from a verified transfer or continuous ownership tenure.

The future deploy operation accepts a private companion only with both an explicit `PRISM_PRIVATE_OPERATIONAL_DIR` and `PRISM_PRIVATE_PROMOTION_APPROVED=yes`, in addition to the separate cloud execution gate. It verifies the companion manifest and exact file bytes before preparing private uploads. This flag represents a future specific rights and access approval; it is not set or exercised during P2. The file allowlist has no raw PDF, owner name, postal address or contact file. Actual protected companions remain outside Git, the public artifacts, and the returned handoff ZIP. Only counts and hashes may be returned.
