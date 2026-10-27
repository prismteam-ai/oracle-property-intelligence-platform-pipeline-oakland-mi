# Oracle Studio — local P1 implementation

The assignment README is preserved unchanged. This is a local assessment slice; no hosted runtime, provider inference, IPFS/Atlas publication or submission is claimed.

Use Node24.19.0 (see `.node-version`) and pnpm11.25.0. Both repositories must be reconstructed as siblings with their original names.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm cdk:synth
```

`pnpm build` uses the actual Turborepo workspace graph. Native DuckDB binaries are shipped in pinned platform packages; installation hooks are disabled. Unsupported architectures need a reviewed native package adjustment. First dependency/browser download needs network; subsequent fixture execution does not.

Open four terminals from the appropriate repository:

```sh
# Oracle repository
pnpm api  # 127.0.0.1:4310
pnpm dev  # 127.0.0.1:4173
# CRM repository
pnpm api  # 127.0.0.1:4311
pnpm dev  # 127.0.0.1:4174
```

The CRM proxies only the local Oracle. Open `http://127.0.0.1:4174` and Oracle Studio at `http://127.0.0.1:4173`. Defaults display48 labeled synthetic properties, with missing evidence and unknowns preserved. Real minimized rows are never committed or served by fixture routes. Both apps bind loopback only.

From CRM, `pnpm test:browser` launches both APIs/frontends if absent. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chrome/Chromium path if the default is unavailable; install the exact Playwright browser with `pnpm exec playwright install chromium` after approved tooling download. `PRISM_BROWSER_EVIDENCE_DIR` writes compact synthetic screenshots/results outside Git. Linux `unshare -Urn sh -c 'ip link set lo up && exec pnpm test:browser'` runs the same suite with an isolated network namespace; all four services are started inside it and no external networking is available.

Demo: inspect Oracle's two runs and deltas, coverage and query evidence, then dry-run artifact metadata (no invented public CID). In CRM, deny GPS and place/move a pin; vary radius, roof age, permit status/open duration and confidence; compare map/list, inspect reported versus verified contractor/rating evidence, create/update a local lead, refresh, ask the deterministic assistant and show disabled future sections. Browser tests also coverGPSsuccess, unavailable basemap, failed query/stale-result clearing, unsafe prompts and mobile layout.

Local `data/` is ignored. Do not copy raw real records, receipts, Parquet, SQLite or browser outputs into source control. The real-source runner accepts an explicit protected source file/output path; run it only under the authorized source scope. P1 permits at most500 minimized records, no owner/contact queries. Source terms/robots denials are stops, not reasons to change identity or scrape through a browser.

CDK is synth-only: resource candidates contain a503 placeholder, not a working hosted product. Lambda transport/native packaging, hosted authentication, DynamoDB persistence adapter, source coverage, real roof/permit enrichment, actual model inference and public persistence remain later gates. No command here grants cloud/account/billing/publication or remote GitHub permission.
