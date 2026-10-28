# Architecture

A bounded local producer captures source receipts, validates fields, reconciles canonical parcels and preserves immutable run deltas. Approved public tables/manifests/CARs remain provider- and owner-data-free. Protected source observations stay in separate pinned sidecars; raw source/provider intake remains private.

CloudFront and private S3 serve the UI and proxy the HTTP API. An AWS Lambda read plane loads the hash-verified public and optional protected snapshots into native DuckDB. DynamoDB stores sessions and quotas, Secrets Manager holds access configuration, and the query/MCP interfaces expose bounded source-backed projections. No always-on ingestion worker or database server is required.

`packages/query/src/real-utils.ts` validates immutable files. `real-loader.ts` manages bounded native connections and sidecars, while `real-full-sources.ts` projects validated full-source observations. `real.ts` retains query/property response assembly. Pipeline UI panels are split into overview, artifacts, detail/source-context and the App that owns abort/generation state. The decomposition preserves query semantics and keeps stale-response protection in one owner.

The release candidate uses the standard CDK default synthesizer with qualifier `prismrvw`, measured ZIP assets and actual CDK deployment. Exact source, contract, account, region, package, snapshot and budget pins guard effects. Existing-stack updates checksum-stage data before activation; acknowledged first creation remains fail closed with an unconfigured access secret until its exact data uploads are verified.

See [security](SECURITY_PRIVACY.md), [deployment](DEPLOYMENT.md) and [observability](OBSERVABILITY.md).
