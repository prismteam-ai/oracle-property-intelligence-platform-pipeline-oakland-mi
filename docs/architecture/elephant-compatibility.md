> Historical baseline reference. Current operating instructions are in the [documentation index](../README.md). Source identities and observations below describe their recorded earlier revision.

# Current Elephant compatibility, local preparation

The assessment DuckDB/Parquet snapshot remains an assessment product artifact. Its
historical UnixFS roots and local run-history-v3 root are not Elephant CountyIndex
archives, Atlas registrations, or the latest shared MCP database.

The local compatibility adapter reads recorded public ArcGIS response bodies,
their successful HTTP ledger events, and the native-ID acquisition plan. It does
not export the Query DB. Both request and response hashes must match. The bounded
pilot selects exact, unique raw parcel PIN joins to actual address points; it
retains the original parcel punctuation, original street text, actual WGS84
coordinates, and the exact captured batch-request parameters. The record-level
`request_identifier` is the official native object ID within that captured batch;
this is not evidence that an unobserved individual-detail request was made.

Every representable captured site-address city, state and five-digit ZIP is also
included. The current `city_name` schema requires uppercase: ASCII case is the
only city transformation, with no trimming, spelling repair, abbreviation
expansion or geographic inference. State and ZIP are copied exactly, preserving
leading zeros. Explicit nulls remain null where the schema permits them.
Unsupported types/formats remain in raw captures and receive counted mapping
reasons, rather than replacement values. Conversion receipts record these
decisions. A parcel's alternate site address is retained separately in raw data;
it is not silently mixed into the selected site-address record.

Each selected property directory contains a current Seed root using
`address_has_parcel` and a County root using `address_has_geometry`. The adapter
does not invent a dwelling classification, legal description, construction year,
owner, contractor, permit status, or sales history. The source working captures
remain intact. The pilot is one actual address per selected parcel and is not a
complete assessed-property population or complete address export.

At the current manifest capture, `address.county_name` is optional in the
unnormalized-address branch, but its enum excludes Oakland. The adapter therefore
omits this optional field, records that schema limitation, and retains the actual
Oakland/MI/26125 jurisdiction in the conversion receipt and CLI-generated Atlas
page. It does not substitute a different county. The deprecated
`unnormalized_address` class requires an enum that likewise excludes Oakland and
is not used. Optional source facts that this narrow compatibility projection does
not map remain available in the working capture and assessment snapshot.
The current `parcel` class has no secondary-ID field. `KEYPIN` and the secondary
`OBJECTID` remain in raw data; neither is asserted to be a `prior_parcel_id`,
whose current legacy schema explicitly means a previous historical identifier.

## Reproduce the source conversion

Use Node 24 and the repository's frozen dependencies:

```sh
node --import tsx scripts/elephant-compat.ts \
  --source-plan /absolute/private/observed-run/plan.json \
  --request-ledger /absolute/private/observed-run/request-state.json \
  --out /absolute/private/new-local-pilot \
  --limit 100
```

The output must be a new directory. Pilot limits are explicit (1–1000 properties),
and every file is private by filesystem mode. This command does not contact a
service, execute a source request, hash a CountyIndex, or publish anything. It
verifies the whole parcel capture census to exclude duplicate parcel PINs, even
when the selected pilot is small. The receipt records the bounded selection and
the original source hashes separately from the schema-shaped files.

## Official tool implementation and stages

The P5 frozen official Git reference is Elephant CLI
`44bb182b9f7f904662e9b33e1fde70bdeab62322`. Its package.json says `1.58.1`, but
the official npm `@elephant-xyz/cli@1.58.1` metadata reports gitHead
`e6fa5b650955d40d2d7a00235e3b009423d91076`; that integrity-verified tarball does
not contain `export-tables`. Those are distinct artifacts despite the identical
version string.

Local validation uses the unchanged current Git `handleValidate`, `handleHash`,
and `handleExportTables` implementations through their supported service-injection
APIs. A small allowlisted bootstrap compiles those source modules with the pinned
assessment compiler. It is not the stock npm entry point. Its exact vendor input
hashes, compiler version, selected runtime dependency lock, invocation receipts,
and output hashes must accompany the proof. It includes no upload, wallet,
contract-submission, browser, or AI commands. Installation scripts are disabled.

The schema manifest is captured from `https://lexicon.elephant.xyz/api/manifest`.
Required schema blocks are independently verified against their CID multihashes
before being served by a local read-only mirror. During official tool execution,
all fetches are restricted to that mirror and schema caches are private and
explicit. No credentials or user source HTTP requests are executed by the tool
bootstrap. This also makes a repeated tool check use the same exact schemas.
The original official manifest URL remains in exporter metadata; its captured,
hash-pinned response is served locally during the checks.

The default CLI handler creates a fresh JSON validator for each property. The
official `ValidateServiceOverrides` API also supports reusing a
`JsonValidatorService` across a batch. The local runner benchmarks that supported
option separately: it changes cache lifetime, without modifying the official
validator or its validation rules. This option is not a stock CLI command-line
flag. Independent batches can be validated by separate tool processes; their
receipts must show disjoint property sets, successful counts and bounded workers.
The canonical county CAR and its tables must still come from the official hash
and export implementations.

Run the current guide's stages in order: validate property inputs; hash to a
dag-json CountyIndex CAR; validate its integrity, root, index, graph, Lexicon and
orphan checks; export class/relationship Parquet tables and a CountyTables CAR;
generate the local Atlas page using `export-tables`. Any failed validation blocks
the dependent stages. Preserve failed attempts and corrective evidence.

In the unchanged official profile, the official exporter creates the tables and local Atlas page. A passing
pilot proves its recorded sample and schemas only. Before a county-wide attempt,
report measured CPU/time, output bytes, inode/file count, source exclusions, and
coverage denominator; do not extrapolate a sample pass into county completeness.

An independent inspection of the current official exporter found a fidelity gap:
the `address` convenience table contains only `cid`, `property_cid`,
`data_group_cid`, and `request_identifier`. It omits the original address text and
source request because the current address schema declares its fields under
`oneOf`, while the exporter reads `schema.properties`. The canonical CAR retains
those facts. A successful official tool run therefore does not establish a
lossless address-table export. Do not hand-write a replacement table or call the
gap resolved by running more properties.

The P5 return also records a separately disclosed local fork at
`acf30e96ba43c4e444143cc0776a37401a763391`, which changes only schema-column
extraction for compatible direct object `oneOf` alternatives. This is a candidate
correction, not an upstream release or adoption. Its source, runtime and outputs
remain separate from the unchanged official profile and its historical omission.
Only completed full-cohort source/provenance, NULL, table/association, CID,
privacy and generated-Atlas proofs plus independent outcome review can establish
that correction's fidelity; the return's report06 records the actual disposition.
Neither profile uses hand-written replacement tables or Atlas pages, mutates the
canonical CAR, or establishes external publication or original assessment acceptance.

## Publication remains separate

All these outputs are local preparation. No new CAR/table upload, Atlas push or
PR, organizational merge, shared IPNS update, or shared MCP synchronization is
included. The real workflow needs approved immutable bytes, provider readback,
Atlas validation/merge, and the resulting global discovery/synchronization before
those later claims could be made. Existing assessment CID1/CID2 and their legacy
IPNS record must remain labeled as historical product artifacts.
