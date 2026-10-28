# Controlled producer and scale-to-zero read plane

Status: accepted local implementation decision; factual source/external results remain separately measured gates.

Keep source acquisition and native transformations in a controlled producer. Serve bounded immutable queries from Lambda, private S3 and DuckDB. Avoid always-on workers, NAT and hosted database servers. Existing review resources remain until explicit teardown; scale-to-zero compute is not a zero-total-cost guarantee.
