# Oracle Studio — P2 local verification

The assignment README remains unchanged. P2 has a genuine Node HTTP/Lambda handler, complete selected official GIS layers, an optional protected operational read model, and local AWS Runtime Interface Emulator proof. Deployment, live model inference and public publication require separate authorization and are not performed by these checks.

Use Node 24 and pinned pnpm 11.25.0. Install dependencies without lifecycle scripts. Build the measured Lambda ZIP **before** synthesizing CDK: the template references that exact archive.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm package:lambda
pnpm cdk:synth
pnpm cdk:check
```

The package command creates ignored `oracle-lambda.zip` and `dist-lambda/package-report.json`. The ZIP has canonical file order, modes and timestamps. CDK uses that ZIP directly; the emulator verifies its digest, extracts it to a temporary directory and mounts those exact bytes read-only. Native DuckDB comes from the pinned Linux x64 glibc package; no install hooks compile or fetch native code.

## Public real-data workspace

Set the absolute path to the accepted public-safe artifact directory from the returned handoff. Default data mode is real and missing or corrupt artifacts fail startup. Local access is explicit and serves only the public-safe projection.

```sh
export PRISM_SNAPSHOT_DIR="/absolute/path/to/return/artifacts/public-safe"
PRISM_ACCESS_MODE=local pnpm api
# A separate terminal:
pnpm dev
```

Open `http://127.0.0.1:4173`. The app reads its data mode, immutable snapshot ID/digest, counts and build from health. Filter changes clear old rows/details immediately. Query and detail generations discard late responses. Applied query metadata is available in the query disclosure; unsupported roof, permit, owner or tenure evidence remains unknown.

The CRM repository remains a sibling. Its local API requires `PRISM_ACCESS_MODE=local pnpm api` on port 4311, with its frontend on 4174. The producer is port 4310 and Oracle Studio is 4173. A hosted build uses an explicit HTTPS CRM link rather than a loopback URL.

## Separate synthetic demonstration

```sh
PRISM_DATA_MODE=synthetic PRISM_ACCESS_MODE=local pnpm api
pnpm dev
```

This mode contains 48 clearly labeled synthetic properties and two durable fixture runs. It is separate from the official source artifacts. No implicit fallback or UI toggle mixes the two modes.

## Browser verification

Stop old servers when changing modes. Each suite starts its required Oracle API/frontend if absent. Evidence goes outside Git; run the two modes into different folders.

```sh
PRISM_BROWSER_EVIDENCE=/absolute/synthetic-evidence pnpm test:browser
PRISM_TEST_MODE=real PRISM_SNAPSHOT_DIR=/absolute/public-safe \
  PRISM_BROWSER_EVIDENCE=/absolute/real-evidence pnpm test:browser
```

The synthetic regression suite delivers genuine delayed server responses while deliberately ignoring cancellation to exercise generation guards, including query, detail selection/close and failed snapshot reload. It checks every visible row against radius/roof/roofing-permit predicates. Screenshot sidecars include HEAD/tree, source hashes, contract version, mode, build, snapshot identity, exact requested/applied query and test name. The real suite checks complete selected-layer counts, source detail, caveats and file manifests. Protected rows are not used for public screenshots.

## Exact archive in the AWS emulator

The script uses the pinned official AWS Node 24 Amazon Linux 2023 image, with Docker networking disabled, a read-only function archive, two CPU and 4 GiB memory limits. The image must already be available from an approved public tooling download.

```sh
pnpm package:lambda
PRISM_EMULATOR_EVIDENCE=/absolute/synthetic-rie.json pnpm runtime:emulate
PRISM_DATA_MODE=real PRISM_SNAPSHOT_DIR=/absolute/public-safe \
  PRISM_EMULATOR_EVIDENCE=/absolute/real-rie.json pnpm runtime:emulate
```

An explicitly selected private companion may be mounted read-only for the protected proof:

```sh
PRISM_DATA_MODE=real PRISM_SNAPSHOT_DIR=/absolute/public-safe \
  PRISM_PRIVATE_OPERATIONAL_DIR=/absolute/private/cloud-operational \
  PRISM_EMULATOR_EVIDENCE=/absolute/protected-counts-and-hashes.json \
  pnpm runtime:emulate
```

That proof returns only counts, hashes and test status. It does not persist private row bodies, built years, sale dates or PDF observations. Private Parquet/receipts remain outside Git, public artifacts and the handoff ZIP. A Node server in local-access mode refuses either protected sidecar. The protected S3 template option is disabled by default and requires separate rights/access approval before any future promotion.

The emulator checks native `SELECT 42`, authenticated stored sessions, strict queries, logout/revocation and malformed-input rejection. Real protected checks include source-backed built-year proxies, partial reported-sale events, null verified transfer dates and rejected tenure claims. Zero out-of-state results are not proof of owner absence when source postal-state coverage is unknown. Local emulation does not establish deployed Lambda/CDN behavior or live AWS persistence.

## Future operation gates

`pnpm deploy`, `pnpm smoke`, `pnpm evidence`, `pnpm rotate-access` and `pnpm destroy` print dry-run plans by default. They grant no account, billing, inference, publication or remote Git permission. Hosted execution requires a future explicit approval, reviewed exact artifacts/account/region/cost/retention, and the script's execution flag. Read [the runtime runbook](docs/architecture/P2_HOSTED_RUNTIME.md) for the signed-session protocol, S3 manifest pinning, private companion conditions and retained-resource teardown.
