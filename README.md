# Oracle property intelligence

The controlled producer ingests and reconciles Oakland County sources into immutable DuckDB/Parquet/CID artifacts. The authenticated assessment read plane serves the pipeline UI, bounded queries and MCP to the Roofing CRM. It separates approved public artifacts, minimized protected evidence and private working intake.

The [frozen assignment](docs/history/ASSIGNMENT_README.md) remains the original contract. Current implementation details and limitations are in [IMPLEMENTATION.md](IMPLEMENTATION.md), [coverage](docs/DATA_COVERAGE.md) and the [documentation index](docs/README.md).

## Local review

Use Node 24 and pnpm 11.25.0. On Linux x64:

```sh
pnpm install --frozen-lockfile
pnpm tooling:install
pnpm exec playwright install chromium
pnpm api
```

In a second terminal run `pnpm dev` and open http://127.0.0.1:4173. These defaults use explicit synthetic fixtures; they do not impersonate real county data. Real data requires a hash-verified snapshot and approved protected sidecars supplied separately. See [local development](docs/LOCAL_DEVELOPMENT.md).

## Verification and deployment

`pnpm ci:verify` runs the canonical local equivalent of the pinned pull-request workflow. It requires the pinned Docker runtime image and Chromium. No GitHub-hosted run has occurred before a remote push. See [release gates](docs/RELEASE_CHECKLIST.md).

The new target is neutral `review` in `us-east-2`, using standard task-qualified CDK bootstrap and `cdk deploy`. The existing historical region remains a rollback environment. No new hosted release or source outcome is claimed until the operator records exact deployment and source receipts. See [deployment](docs/DEPLOYMENT.md) and [evaluator access](docs/EVALUATOR_GUIDE.md).
