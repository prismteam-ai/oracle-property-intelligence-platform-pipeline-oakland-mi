# Recorded-transfer evidence claim semantics

Status: accepted local implementation decision; factual source/external results remain separately measured gates.

Distinguish a reported sale date, an indexed recorded-deed event and observed absence of deed transfers during a named coverage window. State source system, parcel identity, coverage start/end, observation date, confidence and limitations. Do not label partial sales or an index search as proven continuous legal ownership. The source campaign determines which positive cohort, if any, is actually supported.

P6 API `0.5.0` adopts `ownership.recordedTransferIndexObservations[]` and `minRecordedDeedGapYears`. The strict comparison is relative to `observedThrough`, with both `claimWindowStart` and the latest observed deed older than the requested calendar anniversary; a deed exactly on that anniversary does not qualify. The global `sourceIndexAdvertisedStart` is metadata, never the predicate coverage start. Current-PIN search completeness does not establish historic parcel lineage. Stronger `minOwnershipYears` requests are rejected explicitly with the qualified alternative identified, rather than silently mapped or omitted.
