# Oracle property intelligence

The controlled producer ingests and reconciles Oakland County sources into immutable DuckDB/Parquet/CID artifacts. The authenticated assessment read plane serves the pipeline UI, bounded queries and MCP to the Roofing CRM. It separates approved public artifacts, minimized protected evidence and private working intake.

The [frozen assignment](docs/history/ASSIGNMENT_README.md) remains the original contract. Current implementation details and limitations are in [IMPLEMENTATION.md](IMPLEMENTATION.md), [coverage](docs/DATA_COVERAGE.md) and the [documentation index](docs/README.md).

## Local review

Use Node 24 and pnpm 11.25.0. On Linux x64:

```sh
pnpm install --frozen-lockfile
pnpm tooling:install
pnpm exec playwright install chromium
PRISM_DATA_MODE=synthetic PRISM_ACCESS_MODE=local pnpm api
```

In a second terminal run `pnpm dev` and open http://127.0.0.1:4173. These explicit flags select synthetic fixtures; they do not impersonate real county data. Real data requires a hash-verified snapshot and approved protected sidecars supplied separately. See [local development](docs/LOCAL_DEVELOPMENT.md).

## Verification and deployment

`pnpm ci:verify` runs the canonical local equivalent of the pinned pull-request workflow. It requires the pinned Docker runtime image and Chromium. No GitHub-hosted run has occurred before a remote push. See [release gates](docs/RELEASE_CHECKLIST.md).

The inherited accepted hosted baseline is Oracle `3e093a6` / CRM `6500641` in neutral `review`, `us-east-2`. Read the current runtime health and immutable release packet for the deployed source/build/snapshot and its dated acceptance evidence; [release status](docs/RELEASE_STATUS.json) explains that authority. Standard task-qualified CDK manages deployment; historical stacks remain rollback resources. See [deployment](docs/DEPLOYMENT.md) and [evaluator access](docs/EVALUATOR_GUIDE.md).

Hosted review entry point: [Oracle workspace](https://dknck94i8grek.cloudfront.net). The evaluator needs only a browser and the separately delivered low-privilege review capability; verify the dated first-use receipt for the current deployed identity.
