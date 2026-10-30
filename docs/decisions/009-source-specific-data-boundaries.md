# ADR009: source-specific facts and publication approval

Status: accepted policy correction; actual ingestion/deployment/media require release evidence. Supersedes categorical owner/contact exclusion and masking in [ADR002](002-data-tiers.md), and the application of provider restrictions to unrelated official sources in [ADR004](004-provider-rights.md). Historical bodies and original artifacts remain preserved.

The employer requests available ownership/contact data, real coordinates and source-backed records. The earlier broad rule treated public owner observations, runtime access and irreversible publication as one privacy boundary. That restriction was unsupported. The replacement classifies each field by original requirement, captured source terms, security need and operational purpose; [the authority matrix](../DATA_FIELD_AUTHORITY_MATRIX.md) records those decisions.

Official county identities and permitted source facts may appear in the evaluator runtime and walkthrough. Nullable owner name parts and observed postal text retain native association, date, source/metadata/terms/record digests and availability. A postal observation is not fabricated into a named owner; regional derivation preserves its basis. Source metadata alone does not prove a populated field.

Private storage and authenticated transport remain operational controls. Existing `private_` tables, sidecars and `protected-real` build labels are compatibility names, not declarations that every included public fact is secret. CRM user-state isolation, credential masking, bounded telemetry/model inputs and source-specific provider restrictions remain.

Public IPFS is separately irreversible. Linked Elephant guidance requires exact-byte Human approval for bulk owner/personal-data publication. Build the candidate and disclose fields, counts, terms, bytes, CIDs/CAR, owner inclusion and retention implications; do not upload it automatically. This reference gate does not prohibit acquisition, evaluator display or an unmasked official-data demo.

Keep the controlled TypeScript producer, DuckDB/Parquet, request/run ledger and existing scale-to-zero AWS read plane. No Restate/PostgreSQL rewrite, paid provider or new source campaign follows. The existing low-privilege capability may be included in the approved draft PR access section so first use needs no private email. Video/GitHub effects still require `APPROVE P11 V1.1 VIDEO AND DRAFT PR EFFECTS`; Ready and employer messaging remain separately unperformed.
