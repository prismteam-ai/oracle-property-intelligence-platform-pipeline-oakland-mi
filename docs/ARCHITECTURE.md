# Architecture

A bounded local producer captures source receipts, validates fields, reconciles canonical parcels and preserves immutable run deltas. Approved public tables/manifests/CARs remain provider- and owner-data-free. Protected source observations stay in separate pinned sidecars; raw source/provider intake remains private.

CloudFront and private S3 serve the UI and proxy the HTTP API. An AWS Lambda read plane loads the hash-verified public and optional protected snapshots into native DuckDB. DynamoDB stores sessions and quotas, Secrets Manager holds access configuration, and the query/MCP interfaces expose bounded source-backed projections. No always-on ingestion worker or database server is required.

`packages/query/src/real-utils.ts` validates immutable files. `real-loader.ts` manages bounded native connections and sidecars, while `real-full-sources.ts` projects validated full-source observations. `real.ts` retains query/property response assembly. Pipeline UI panels are split into overview, artifacts, detail/source-context and the App that owns abort/generation state. The decomposition preserves query semantics and keeps stale-response protection in one owner.

The release candidate uses the standard CDK default synthesizer with qualifier `prismrvw`, measured ZIP assets and actual CDK deployment. Exact source, contract, account, region, package, snapshot and budget pins guard effects. Existing-stack updates checksum-stage data before activation; acknowledged first creation remains fail closed with an unconfigured access secret until its exact data uploads are verified.

See [security](SECURITY_PRIVACY.md), [deployment](DEPLOYMENT.md) and [observability](OBSERVABILITY.md).

`real-source-observations.ts` validates every new observation against the strict canonical contract, file digest, exact JSON digest, snapshot/property binding and existing municipal-permit association. Separate source tables support typed predicates and private coverage; unknown legacy municipal status is retained in the response. Independent native closure takes precedence over provider activity. The current-PIN deed index table carries an explicit bounded claim window and verified cutoff, separate from the advertised source-wide index start. A public load without the private sidecars creates empty source tables and does not project these observations.

Contract metadata distinguishes the compatibility entry-file SHA-256 from the SHA-256 of the complete sorted source-module hash inventory. Both active manifests and the canonical verifier bind all three TypeScript modules; API version changes do not rewrite old public artifact manifests.

## Decisions and alternatives

The assignment requires two repository submissions, so each is a modular TypeScript workspace joined by one serialized versioned contract. A single combined repository would obscure those designated submission boundaries. The controlled producer separates heavy lawful acquisition from the serverless read plane; always-on EC2, databases, NAT gateways, OpenSearch and Kubernetes would add fixed cost without improving the bounded review workload. DuckDB provides portable analytics, Parquet compact columnar bytes, CID identities immutable content and CARs importable DAG snapshots. A hosted database alone would not preserve these artifact identities.

Structured retrieval with model-mediated intent keeps source facts and authorization in deterministic code. Unrestricted SQL or free-form model facts would bypass the bounded contract. Public immutable artifacts exclude protected/provider and operational records because deletion/rights controls differ across those tiers. MapLibre renders the origin/action-restricted Amazon Location map with attribution and a tested fallback. Powertools, CloudWatch, X-Ray and bounded PagerDuty delivery provide runtime evidence without a separate monitoring server. These choices remain unless a measured defect requires a scoped change; source limitations are not grounds for a broad redesign.
