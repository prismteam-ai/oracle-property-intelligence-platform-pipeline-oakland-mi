# Local development

Use Node 24, pnpm 11.25.0 and Linux x64 for the pinned native tooling. Install with `pnpm install --frozen-lockfile`. The workspace explicitly permits the pinned esbuild build script; a string placeholder previously broke clean installs and is now repaired.

Run `pnpm tooling:install` for the checksum-pinned official actionlint binary and `pnpm exec playwright install chromium` for the synthetic browser campaign. Run `PRISM_DATA_MODE=synthetic PRISM_ACCESS_MODE=local pnpm api` and `pnpm dev` in separate terminals for the synthetic local UI at http://127.0.0.1:4173. The API listens at http://127.0.0.1:4310.

`pnpm ci:verify` runs format, lint, typecheck, tests, contract drift, source scan, workflow validation, production build, Lambda package, CDK policy assertions, production dependency audit, native runtime emulation, synthetic browser and documentation checks. Before the canonical campaign, obtain the exact official runtime image:

```sh
docker pull public.ecr.aws/lambda/nodejs@sha256:92b7cccd985332238af80ac8da42d6965d418552e88955e315da4e3c0c76ca79
```

`pnpm runtime:emulate` runs the measured API package with networking disabled. `pnpm runtime:alert:emulate` separately checks the packaged disabled alert entrypoint at its 128 MiB limit, with no secret/provider call and a private-log canary. Hosted tests and real protected data checks are separate operator campaigns. Local test fixtures do not satisfy real positive source outcomes.

Producer commands require explicit receipt-backed plans and private destinations. `pnpm snapshot:run`, `pnpm snapshot:build`, `pnpm publication:local`, `pnpm publication:restore` and `pnpm benchmark:real` are documented in their source entrypoints and historical design records; running without required inputs fails rather than silently using another dataset. The continuous producer does not acquire sources inside the CRM.

The API defaults to real mode and authenticated review access. Plain `pnpm api` does not select a fixture or grant local access. The explicit development flags above select labeled synthetic data and loopback local access. For real public data, supply a separately verified `PRISM_SNAPSHOT_DIR` with explicit real mode; protected sidecars additionally require the authenticated private operator configuration. Never copy that configuration into this guide.
