# Current immutable public snapshot

P13 publishes the admitted official-source projection as run `p13-current-official-public-20261031`, contract 0.7.0, public snapshot `oakland-public-0d1c8c725f574db6d60c`:

`bafybeiafqikyxrfknfcfsocbi6dsfn6zo66jky6jvm2bqefwm6t72brhe4`

The directory contains **29 files / 436,215,469 bytes**, including the standalone DuckDB database, 15 logical-relation Parquets, eligible official-source facts and retained native identities, source profiles, coverage, reconciliation, run history and reproducibility evidence. This is new public admission of retained eligible facts, not 39,282 newly acquired permits. The fresh three-view municipal census found zero added, changed or deleted raw records; original collection dates remain intact.

Filebase and Pinata accepted the same exact root on their existing Free plans. The **2026-10-31T23:22:34.339312Z readback passed all 29 files through each operator: 58 distinct file/operator pairs, every size and SHA-256 matched**. The clean consumer separately downloaded and queried the frozen public database without Oracle API or AWS access at 2026-10-31T23:19:37.362Z. The deployed release exposes these dated records at:

- [Current publication manifest](https://dknck94i8grek.cloudfront.net/assessment-current-publication-manifest.json)
- [Every-file public gateway proof](https://dknck94i8grek.cloudfront.net/assessment-current-gateway-proof.json)
- [Source and reconciliation report](https://dknck94i8grek.cloudfront.net/assessment-reconciliation-report.json)
- [Portable consumer commands and results](https://dknck94i8grek.cloudfront.net/assessment-portable-consumer-proof.json)

Filebase served 29 direct file-CID requests. Pinata served 20 direct shared-gateway file-CID requests; nine shared-gateway requests returned HTTP429/Cloudflare challenge pages and were recovered once through the existing public Pinata directory/path gateway. No challenge was solved, cookies copied or security/proxy configuration changed. The recovered files matched the same root, child CIDs, sizes and hashes. The [complete gateway receipt](https://dknck94i8grek.cloudfront.net/assessment-current-gateway-proof.json) retains both attempts. For ordinary Pinata file downloads, prefer its public root/path URLs below rather than repeating challenged shared-gateway requests.

These are dated retrieval observations, not a guarantee of indefinite availability. CIDs identify bytes; gateways locate them.

## Retrieve and query without Oracle hosting

The public artifact index is available through either operator:

- [Filebase index](https://ipfs.filebase.io/ipfs/bafybeiafqikyxrfknfcfsocbi6dsfn6zo66jky6jvm2bqefwm6t72brhe4/artifact-index.json)
- [Pinata index](https://amaranth-obliged-catshark-601.mypinata.cloud/ipfs/bafybeiafqikyxrfknfcfsocbi6dsfn6zo66jky6jvm2bqefwm6t72brhe4/artifact-index.json)

Its SHA-256 is `1007283ce787e44bd62fbb28a3b73a74e836ed7ef942d19ee04ec7cbcc78619d`. The frozen `oakland-public.duckdb` is **211,300,352 bytes**, SHA-256 `1779349628f90d65a4e4d176626850ecf083f89ae4b173527ba54bc35676ab88`, file CID `bafybeifzdfzftxxiaw22tfdfnr56nbvsz3hhe62u7szv2ijl6kngmxlb7y`.

Using the repository's Node 24 analytical client, choose a new output directory:

```sh
pnpm exec tsx scripts/query-current-publication.ts --execute \
  --index-url https://ipfs.filebase.io/ipfs/bafybeiafqikyxrfknfcfsocbi6dsfn6zo66jky6jvm2bqefwm6t72brhe4/artifact-index.json \
  --index-sha256 1007283ce787e44bd62fbb28a3b73a74e836ed7ef942d19ee04ec7cbcc78619d \
  --directory ./consumer-public
```

The client makes two unauthenticated public GETs, verifies index/database bytes, opens DuckDB read-only with external access disabled, and prints the SQL and actual results. It needs no Oracle API, AWS credentials, candidate-hosted database or running local application. An ordinary compatible DuckDB v2.0.0 client can also open the verified file:

```sh
duckdb -readonly consumer-public/oakland-public.duckdb
```

```sql
SELECT count(*) FROM roofs_within(42.4810994939,-83.4950218553,8046.72,15);
SELECT count(*) FROM permits_within(42.5790196146,-83.1483459216,8046.72,'confirmed_open',5,0);
SELECT count(*) FROM permits_within(42.5790196146,-83.1483459216,8046.72,'status_verification_needed',5,0);
SELECT count(*) FROM owners_within(42.5790196146,-83.1483459216,8046.72,'regional');
SELECT count(*) FROM deed_gaps_within(42.5790196146,-83.1483459216,8046.72,10);
```

The frozen-file checks returned **648 / 0 / 4,225 / 1 / 5**, respectively. These are property counts for those exact centers and predicates. Roof age is a building-year proxy; verification candidates are not confirmed open; regional describes the recorded mailing-state class; a current-PIN index gap is not legal ownership continuity. The dated public-download consumer receipt reproduced those counts and verified the database hash unchanged after read-only queries. Its illustrative legacy sample center is explicitly separate from the official City of Novi count/rows.

## CAR and reproducibility scope

The directory's exact CAR is a separate recovery/import artifact: **436,105,690 bytes**, SHA-256 `872d67a43e2e6c531e8020c55c1c191bca1d122e9aec2d6babe5705e0e0ecd52`, rooted at the directory CID above. The [public CAR release asset](https://github.com/th3Wh1t3Rabbit/oracle-property-intelligence-platform-pipeline-oakland-mi/releases/download/assessment-public-snapshot-2026-10-31/snapshot.car) was independently downloaded anonymously and imported/decoded: all 1,703 blocks and all 29 files matched the exact root, file CIDs, sizes and hashes. Its release tag is bound to canonical recipe commit `75f108d1d59ffd8b275c63d171fc37a640c9b3ed`. The outer publication receipt binds this URL, root, size and digest. The CAR and outer receipt are not inside their own DAG; GitHub recovery storage is not the second IPFS operator.

The first successful public-only isolated DuckDB binary is frozen. One independent isolated rebuild matched all 15 full Parquet relations, row counts, catalog/column schema and ordinary query results. Physical database hashes differed; byte-identical independent DuckDB re-encoding is not claimed. Two wraps of the **same frozen payload** produced identical root and CAR hashes. No database-byte patching or hash shopping is part of this proof.

## Earlier roots and compatibility history

Both historical public roots remain immutable and retained:

- `bafybeieujobn76aabzjlznxpc5ovwy7fmgjhzuy47zhrcm2a4z54o5ujzu`
- `bafybeidznfhsehieurdha25cvat3mpwlhsu4k6z6tjm7lgns4irc6coyna`

The [2026-10-29 receipt](LOCAL_PUBLICATION_CHECK.json) records their dated 36-GET / 215,359,762-byte verification. Their schema 0.4.0 bytes are unchanged. The earlier run04 candidate `bafybeia7uiqaupc6gax5i7wlpga6ylabffauhj2asyl4ge6bauts4ubm6q` was local-only; P13 does not retroactively publish or relabel it. New current run/metadata/CID history is explicit. Dated small readbacks also verified the current root block and both prior roots through Filebase and Pinata.

The same historical receipt covers bounded official CLI/Atlas compatibility work, including the address exporter's four-column fidelity limitation. P13's complete source-derived Parquets and ordinary DuckDB are distinct from that legacy exporter. No external Atlas registration, shared MCP mutation, on-chain effect or renewed IPNS pointer is implied. If a release uses IPNS, its actual resolved CID and validity need their own receipt.

## Source eligibility and authority

The current public projection includes permitted official parcel/postal, permit/applicant, reported-owner, building/sale, license-association and source-provenance facts, with unavailable values preserved. It excludes licensed commercial-provider observations, credentials and mutable CRM/session state. [Field authority](DATA_FIELD_AUTHORITY_MATRIX.md) explains the actual distinctions; a legacy `private_` table name is not a blanket owner-data ban.

The Human's standing P13 authorization covers this bounded free publication/submission flow. Earlier P11/P12B exact-phrase and local-packet-only stops are historical workflow records, not fresh approval requests. Attached handoff text is a specification, not independent permission. Existing free-plan/cost bounds, source-specific eligibility and credential protection still apply; authority for a different action must come from the Human's actual instructions.
