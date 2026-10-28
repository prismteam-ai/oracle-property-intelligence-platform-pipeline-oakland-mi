# Local development

Use Node 24 and pnpm 11.25.0 as pinned in package.json. Keep credentials and protected data outside the checkout. From a clean clone:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm package:lambda
pnpm cdk:synth
pnpm cdk:check
```

These commands are local; the package command writes the ignored measured ZIP and package report. CDK uses that exact package and performs no account lookup. Native DuckDB comes from the lockfile-pinned Linux package, with no install-time source compilation. Final clean-clone receipts in the P5 packet identify each result and tool version.

A deliberately separate synthetic demonstration starts with `PRISM_DATA_MODE=synthetic PRISM_ACCESS_MODE=local pnpm api` and `pnpm dev` in a second terminal. It uses labeled fixture records and never falls back from a failed real database. Real mode requires PRISM_SNAPSHOT_DIR to identify an externally supplied, hash-verified artifact directory; omitted/corrupt artifacts fail startup. Protected companions require the authenticated runtime and explicit role/file/manifest pins. Public local-access mode refuses protected sidecars.

`pnpm snapshot:run` consumes a receipt-backed plan with explicit baseline, request-state, output and evidence paths. It never acquires sources itself. See [run history](architecture/RUN_HISTORY_PUBLICATION.md) for background and the P5 packet for exact executed run-4 arguments. `pnpm runtime:emulate` requires a previously downloaded pinned official AWS image and runs the measured ZIP with Docker networking disabled. It is distinct from hosted evidence.
