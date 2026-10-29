# Architecture and decisions

Oracle is a controlled producer plus an authenticated read plane. It reconciles Oakland County sources into portable immutable artifacts; the separate Roofing CRM consumes one serialized versioned contract for map discovery, leads and grounded agent retrieval. Source acquisition remains outside the CRM.

## Data flow and boundaries

The producer validates receipt-backed acquisition, normalizes fields, reconciles canonical parcels and records run deltas. Approved public tables, manifests and CARs exclude protected/provider and operational records. Protected observations use separate hash-pinned sidecars; full source intake remains private.

CloudFront and private S3 serve the UI and HTTP API. Lambda loads hash-verified artifacts into native DuckDB. DynamoDB stores sessions and quotas; Secrets Manager holds access configuration. Queries and MCP return bounded source-backed projections. No ingestion worker or database server stays running between requests.

`packages/query/src/real-utils.ts` validates immutable files; `real-loader.ts` manages native connections and sidecars; `real-full-sources.ts` projects full-source observations; `real-source-observations.ts` validates contract/file/JSON digests, property bindings and existing municipal associations. `real.ts` assembles query/property responses. UI panels separate overview, artifacts and source detail while the App owns abort/generation state to reject stale responses.

Independent native closure takes precedence over provider activity. A current-PIN deed observation carries its verified cutoff and bounded claim window. Loading only public artifacts creates empty protected source tables. Contract metadata distinguishes the entry-file digest from the complete sorted three-module graph; both locks bind every module. Historical public schema 0.4.0 is not rewritten by the compatible runtime contract 0.5.0.

## Technology choices and rejected alternatives

- **Two modular TypeScript workspaces:** preserve the designated Oracle/CRM submission boundaries and share a serialized contract. Combining repositories would obscure ownership; duplicating source ingestion would introduce drift.
- **Controlled producer and serverless read plane:** separate costly acquisition from bounded review traffic. Always-on EC2, a database service, NAT gateways, OpenSearch or Kubernetes would add fixed cost and operational work for this workload.
- **DuckDB, Parquet, CIDs and CARs:** provide native portable analytics, compact columnar files, immutable content identities and importable DAG snapshots. A hosted database alone would not preserve those artifact identities.
- **Typed retrieval with model-mediated intent:** keeps source predicates, authorization and authoritative facts in deterministic code. Unrestricted SQL or uncited model facts would bypass those controls. One accepted CRM turn permits one model attempt and bounded retrieval against the same query.
- **MapLibre with Amazon Location:** supplies actual attributed maps with origin/action/provider-restricted access and a tested rendering fallback. The fixed finite key expiry and used-key `ForceUpdate` preserve those restrictions.
- **CDK, Powertools, CloudWatch and X-Ray:** provide reproducible task-scoped infrastructure, bounded metrics and traces without a monitoring server. Optional PagerDuty delivery sends a fixed minimized summary; paid plans are unnecessary.

These decisions and the admitted data are frozen for release assembly. Source gaps do not trigger another provider search or redesign. [Known limitations](KNOWN_LIMITATIONS.md) gives the source disposition once; [security](SECURITY_PRIVACY.md) and [costs](COST_MODEL.md) explain its operational boundaries.

## Release identity

The existing `review` stack uses the standard CDK synthesizer with qualifier `prismrvw`. Exact source, contract, region, package, snapshot and budget pins guard deployment. Existing-stack updates verify staged immutable data before activation. [Deployment](DEPLOYMENT.md) covers the operator gates; [release status](RELEASE_STATUS.json) binds current runtime identity to an external dated acceptance receipt without claiming a deployment from the source checkout alone.
