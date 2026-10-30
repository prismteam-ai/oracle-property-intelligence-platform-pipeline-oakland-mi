# Architecture and decisions

Oracle is a controlled producer plus a bounded authenticated read plane. It reconciles Oakland County sources into portable artifacts; the separate Roofing CRM consumes the versioned contract for map discovery, leads and grounded retrieval. Source acquisition remains outside the CRM.

## Data flow and authority

Receipt-backed acquisition → native/canonical identity reconciliation → source-specific observations and run deltas → hash-pinned DuckDB/Parquet → UI/API/MCP → CRM. The [sixteen-stage onboarding matrix](COUNTY_ONBOARDING_ALIGNMENT.md) maps the referenced Elephant workflow, outcomes and deliberate substitutions. The [field authority matrix](DATA_FIELD_AUTHORITY_MATRIX.md) separates source availability, terms, internal storage, runtime access, Git inclusion and irreversible publication.

Official property IDs, addresses, coordinates and permitted observations may be shown to evaluators and in the walkthrough. Nullable raw name parts and mailing text are not fabricated into a verified owner. The additive `officialParcelObservation` shape preserves source/native/PIN association, original observation time, metadata/terms/record digests, availability and the regional derivation basis. Postal-only observations do not fit the older named-owner model and are kept explicit. Current source contract and consumer identity are read from their contract manifests; historical runtime 0.5.0 and public schema 0.4.0 remain unchanged records. The source revision does not establish deployed data admission.

Private S3 and owner-only local files are operational access controls. Legacy `private_` tables/sidecars and `protected-real` transport labels do not make every official fact a secret. Source-restricted provider payloads, credentials and mutable CRM records keep their actual boundaries. [ADR009](decisions/009-source-specific-data-boundaries.md) supersedes categorical owner exclusion and media masking.

CloudFront/private S3 serve the UI and HTTP API. Lambda loads verified artifacts into native DuckDB; DynamoDB stores sessions/quotas and Secrets Manager access configuration. Query/MCP responses remain bounded and source-backed. No acquisition worker or database server stays running between requests. `packages/query/src/real-utils.ts` verifies files; `real-loader.ts` manages native connections/sidecars; `real-full-sources.ts` projects source observations; `real-source-observations.ts` checks digests and associations; `real.ts` assembles responses. Abort/generation state prevents stale result substitution.

## Technology choices

- Two modular TypeScript repositories preserve the assignment's producer/consumer split and share a pinned serialized contract.
- A durable request/run ledger and DuckDB/Parquet producer replace the archived Restate/PostgreSQL stack. The outcome mapping is explicit; no rewrite or transform-repository PR is claimed.
- DuckDB, Parquet, immutable CIDv1 roots and CARs provide portable analytics and recoverable artifact identity. Historical custom roots and bounded current CLI/Atlas preparation are different evidence.
- Typed retrieval and deterministic factual rendering keep source predicates, authority and citations outside model control. Model minimization is a cost/grounding choice, not a reason to hide permitted facts from the evaluator.
- MapLibre/Amazon Location, standard CDK, Powertools, CloudWatch/X-Ray and bounded alerting retain the existing scale-to-zero read architecture. Origin/action/provider restrictions and finite dependencies remain.

The least-change access path is a dedicated low-privilege capability in each approved draft PR. It grants no AWS/admin, acquisition, publication or outreach authority. Source-specific facts are visible; lead state remains session-isolated. No paid plan, new source campaign, provider/service or architecture change is implied.

## Release identity

A source-independent external receipt binds clean heads/trees, contract graph, packages/frontend, admitted snapshots, deployed identities and actual access checks. Match health and served frontend to that receipt. [Release status](RELEASE_STATUS.json) records dated technical history; this checkout does not certify a later deployment, source refresh, video approval or submission. Historical CIDs/bytes remain immutable.
