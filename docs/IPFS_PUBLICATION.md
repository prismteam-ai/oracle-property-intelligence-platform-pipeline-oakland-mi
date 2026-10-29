# Immutable artifacts and publication scope

The assessment preserves two historical CIDv1 UnixFS/dag-pb roots:

- `bafybeieujobn76aabzjlznxpc5ovwy7fmgjhzuy47zhrcm2a4z54o5ujzu`
- `bafybeidznfhsehieurdha25cvat3mpwlhsu4k6z6tjm7lgns4irc6coyna`

Their manifests bind path, byte size, SHA-256, CID version and codec. A no-change run may retain the same data root; a changed schema/provenance/history bundle may create a different root without inventing data deltas. Retain prior roots and exact run-history linkage. A public CID does not establish current retrieval availability or current protected-source publication.

The assessment publication profile and current Elephant CountyIndex/CountyTables profile are different. Historical custom roots are not current Atlas registrations. The current official CLI Git pin is `44bb182b9f7f904662e9b33e1fde70bdeab62322` (source package version 1.58.1); the same version string on npm is not proof of identical source/features. Record package integrity, source hash, schema-manifest hash and exact input/output hashes.

Applicable local Elephant stages are: transform actual receipt-backed public source into current Lexicon records; validate the group; hash a county/data-group CAR; validate CAR root, blocks, index, reachability, schemas and orphan rules; export normalized tables; let `export-tables --atlas-page` generate the local county page for Oakland/MI/26125. Do not manufacture missing provenance from a Query DB export. A failed stage blocks its dependents. The unchanged official exporter has a recorded `oneOf` address-column omission; the historical candidate correction is a disclosed local variant, not upstream adoption. Passing structure checks alone does not prove table fidelity or county completeness.

Only approved public parcel/address/query projections, coverage, run history/deltas, manifest and verification material are eligible for the current local approval packet. Provider rows, protected permit observations, owner names/mailing addresses, deed-index observations, contacts, leads, sessions, model traces, credentials and private source receipts are excluded. The packet records exact bytes, inventory, sizes, hashes, codecs, predicted CIDs and CARs locally. No new public upload is authorized in P7.

Filebase and Pinata are separate gateway operators, supported by their own [Filebase gateway documentation](https://filebase.com/docs/ipfs/concepts/what-is-an-ipfs-gateway) and [Pinata gateway documentation](https://knowledge.pinata.cloud/en/articles/5666429-dedicated-gateways). Two names alone do not prove independence or durable pinning. Fresh bounded readbacks must match every historical manifest file from both operators, preserve redirect chains and failures, and independently verify local CAR digests/roots/reachable blocks. Historical receipts stay dated and distinct from P7 checks.

Local CAR/Atlas preparation does not perform CAR/table upload, an Atlas PR/merge, global IPNS update, on-chain submission, internal registry write or shared MCP synchronization. Each is a separate unperformed external gate. Current public reference pins and P7 proof state are in the operator's conformance/publication receipts. See [release status](RELEASE_STATUS.json) and [limitations](KNOWN_LIMITATIONS.md).

## Fresh local check on 2026-10-29

The [local check receipt](LOCAL_PUBLICATION_CHECK.json) records a fresh 100-property/700-file compatibility run using the unmodified current official Git build through its supported service-injection APIs. It reuses the historical public conversion and its provenance receipt; no new source capture or transformation is claimed. Input validation, hash, CAR validation (702 blocks, 100 properties, 200 groups, zero errors in all six checks), six table exports and CLI-generated local Atlas page passed. The pinned Atlas registry validator also accepted that draft against the unchanged registry baseline. The address table still contains only four metadata columns and omits five source fields; this remains a fidelity blocker.

The same check set reverified the historical eight-file and ten-file roots through both independent gateway operators in 36 GETs, and verified all local CAR blocks, reachability, file CIDs, byte digests and retained prior roots. The retained current run04 root remains local-only; no artificial CID change or new public upload occurred. A bounded pass does not establish county completeness, fresh source coverage, registry publication, shared MCP discovery or a final privacy approval.
