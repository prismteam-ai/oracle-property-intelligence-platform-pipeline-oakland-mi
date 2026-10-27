# Contract 0.2 migration

Version 0.2 preserves existing property, search and lead fields while adding optional public source-native parcel identifiers, jurisdiction/revision, one-to-many official site-address evidence, explicit representative/nearest coordinate basis, and observation classes. Provenance adds the real-public kind. Ownership-derived fields are optional and expose no owner names or postal values. They belong to the protected operational model; public snapshots use unknown.

Optional ownerRegion and minOwnershipYears predicates apply only to actual source-backed derivatives/event dates. Unknown tenure is never a positive tenure match; no revision date is treated as an ownership transfer. Existing clients must accept the new literal contract version; producer and generated consumer must upgrade together. Omitted optional predicates preserve prior filter behavior. Real and synthetic snapshot identities never mix.

All source records and address association tables are preserved in the portable artifact; bounded property responses expose a counted/truncated address list. Radius matching uses the nearest linked official address point rather than silently discarding alternate addresses. No polygon centroid is manufactured as an official site point.

## Patch 0.2.1

Added optional field-level roof evidence provenance and reported-sale/recorded-transfer event observations. A partial assessor sales cohort is represented as reported_sale; it never populates lastTransferDate or proves continuous tenure. Public artifacts exclude these observations until redistribution rights are established. Existing fields and omitted predicates preserve prior behavior.
