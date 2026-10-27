# Oracle Studio: local P1 guide

Use Node 24 or newer and the pinned pnpm version in package.json. The implementation is intentionally local, with no accounts, cloud APIs, source fetching, inference, uploads or outbound messaging. The original assessment README remains the requirement source.

Install reproducibly:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The reviewed DuckDB platform binary ships in its pinned optional package and works without install scripts. Ensure Node24 is the Node used by pnpm; older Node20 lacks the SQLite OS mutex used by the durable ledger.

Start two terminals from this repository:

```sh
pnpm api
```

```sh
pnpm dev
```

Open http://127.0.0.1:4173. The API binds only127.0.0.1:4310. It serves a48-property synthetic Oakland-centered cohort;47 have coordinate evidence. This proves product mechanics, not county completeness. Source-native ID collisions, a shared parcel/multiunit association, missing dates/age/rating and unresolved reported contractors are intentional fixtures.

Run overview shows two completed local journal runs with a changed source revision, one new record and a tombstone. Query lab executes a bounded DuckDB query. Change radius, roof threshold and permit filters, inspect evidence and verify source-reported versus officially resolved contractor fields. Artifacts shows measured working-snapshot bytes/digest with no invented CID or public-replica claim. The fixture client uses a frozen snapshot independently of future real-source changes.

Repeatable local ingestion proof:

```sh
pnpm exec tsx apps/ingest-cli/src/main.ts data/fixture-replay
```

The journal uses exact native keys, content/transform hashes, an OS-released SQLite writer mutex, atomic checkpoint replacement and validated ready markers. Repeating a completed run is idempotent; changing a run's input manifest under the same ID is rejected. Tests kill an actual child process and resume the durable checkpoint. Source access classification is an offline state machine that stops on denial/CAPTCHA and successive429 responses; the local runtime makes no source requests.

The real sample is deliberately outside both Git and product fixture endpoints. The integration owner may run the private transform with an already authorized, minimized ArcGIS file:

```sh
pnpm exec tsx apps/ingest-cli/src/real-slice.ts PRIVATE_SAMPLE PRIVATE_OUTPUT REDACTED_EVIDENCE_JSON
```

PRIVATE_OUTPUT must be outside this repository. No arbitrary acquisition is part of that command. It rejects owner/contact/unapproved fields, preserves immutable raw receipt references privately, derives WGS84 polygon centroids, leaves unsupported roof/permit/ownership fields unknown, verifies ready records, performs DuckDB Parquet round-trip and radius query, and writes only counts/schema/digests to the requested evidence summary. The real raw/canonical/Parquet files are not committed or returned. A geometry centroid is not a verified situs/entrance coordinate.

Benchmark the exact synthetic search projection:

```sh
pnpm benchmark data/benchmark-results.json
```

It measures10k/100k/500k rows, six query shapes, Parquet bytes, process memory and separately initialized cold-process/native snapshot reads. Full real entity graph, target Lambda libc/native packaging and actual cloud cold-start remain later gates. The local ruling is A_REPAIR_REQUIRED_WITH_BOUNDED_FIX, with an interface-compatible PostgreSQL fallback; no deployment is asserted.

The CDK stack is a synth-only shape of an AWS read plane with a deliberately503 placeholder handler. It does not package the local HTTP server into a working Lambda. The integration owner must run no-lookup synthesis in the isolated validation environment; never run deploy from this phase. No IPFS/Atlas/public CAR operation is implemented or authorized.
