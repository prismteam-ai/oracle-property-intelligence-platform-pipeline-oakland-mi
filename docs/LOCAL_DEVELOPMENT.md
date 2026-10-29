# Local development

Use Node 24, pnpm 11.25.0 and Linux x64 for the pinned native tooling. The workspace permits only the declared dependency build scripts. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm tooling:install
pnpm exec playwright install chromium
PRISM_DATA_MODE=synthetic PRISM_ACCESS_MODE=local pnpm api
```

In a second terminal run `pnpm dev`. Open http://127.0.0.1:4173; the API is http://127.0.0.1:4310. Explicit synthetic/local flags select labeled fixtures and loopback access. Plain `pnpm api` defaults to real data and authenticated review access; it does not grant local access or choose fixtures.

## Verify the workspace

The complete local sequence is `pnpm ci:verify`. Before it, obtain the pinned official Lambda runtime image:

```sh
docker pull public.ecr.aws/lambda/nodejs@sha256:92b7cccd985332238af80ac8da42d6965d418552e88955e315da4e3c0c76ca79
```

`pnpm tooling:install` installs checksum-pinned actionlint. `pnpm runtime:emulate` exercises the packaged API with networking disabled. `pnpm runtime:alert:emulate` separately checks the disabled 128 MiB alert entrypoint with a private-log canary and no secret/provider call. [Testing](TESTING.md) separates local checks from hosted acceptance.

## Real inputs and producer work

A real local run needs explicit real mode and a separately verified `PRISM_SNAPSHOT_DIR`. Protected sidecars additionally require the approved private operator configuration; never put it in Git or these guides. No paid source or new acquisition is needed to reproduce the admitted snapshot. Synthetic fixtures prove behavior, not real business-source outcomes.

Producer scripts `pnpm snapshot:run`, `pnpm snapshot:build`, `pnpm publication:local`, `pnpm publication:restore` and `pnpm benchmark:real` require receipt-backed inputs and private destinations as defined by their source entrypoints. Missing inputs fail closed. They are not default developer setup steps or permission to resume source discovery. Stop task-owned API/UI servers after local work.
