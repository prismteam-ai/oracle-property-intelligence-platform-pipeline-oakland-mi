# Testing and evidence scope

Use Node 24 and the exact `pnpm` version in `package.json`. Follow [local development](LOCAL_DEVELOPMENT.md) for a frozen installation, Chromium, the pinned runtime image and native workflow validator. Run `pnpm run ci:verify` from the repository root. Its declared command sequence is maintained in `scripts/ci-verify.ts`; package scripts are the command authority.

The canonical campaign covers formatting, lint, types, unit/integration behavior, contract drift, source/privacy patterns, workflow validation, production build, packaged Lambda behavior, CDK/resource policy assertions, dependency checks and browser behavior. Run `pnpm run docs:check` for active links. Local tests use explicit synthetic fixtures unless separately supplied verified real inputs are selected. Synthetic behavior does not establish a real positive source outcome.

The recorded accepted P6 campaign is historical evidence: Oracle 292 tests in 51 files; CRM 532 tests in 46 files, 46 browser journeys and two actual-map checks; final hosted API/MCP 33 checks and 123 HTTP requests; three desktop plus one mobile context. The final model corpus had 70 passing cases: 36 measured grounded model turns, 16 evidence-empty responses and 18 refusals. Empty/refused answers are not measured model successes. These counts do not claim a fresh P7 campaign or a GitHub-hosted run.

P7 acceptance must bind fresh source heads, contract/module hash, lockfile, Lambda ZIP, frontend assets, public/protected snapshot identities and deployed stack to one receipt. Separate local correctness, real native-data fidelity, hosted acceptance, first-use concurrency, source-positive outcomes, privacy review and independent review. Preserve failed attempts and earlier-head evidence with their original identities.

Safe local plans may be executed to validate syntax. Actual deployment, access rotation and destruction are effectful and require the operator contract. A dry run is never a successful remote operation. The current [release status](RELEASE_STATUS.json) and [release checklist](RELEASE_CHECKLIST.md) show remaining gates.
