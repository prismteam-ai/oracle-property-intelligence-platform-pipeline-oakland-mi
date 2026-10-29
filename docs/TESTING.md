# Testing and acceptance evidence

From the repository root, use Node 24 and pnpm 11.25.0, then follow [local development](LOCAL_DEVELOPMENT.md) for the frozen install, Chromium, checksum-pinned actionlint and official runtime image. Run `pnpm ci:verify`. Its sequence is maintained in `scripts/ci-verify.ts`; `package.json` is the command authority. `pnpm docs:check` checks active internal links.

The canonical sequence covers formatting, lint, types, unit/integration behavior, contract drift, source patterns, workflow validation, production build, Lambda packaging, CDK assertions, dependency audit, network-disabled runtime emulation and synthetic browser journeys. Explicit fixtures establish local behavior. Separate verified real public/protected inputs establish native data fidelity. Neither alone proves hosted first use or a missing source-positive outcome.

## Dated accepted evidence

The accepted technical release on 2026-10-29 passed Oracle 15/15 canonical steps at `6d14d60` and CRM 17/17 at `f40b75a`. CRM had 45 browser tests plus two controlled-map tests; actual AWS rendering was separately measured. Native Oracle checks reproduced 490,799 properties, 559,701 addresses, strict Novi 648 / 50 and source contexts 131 / 0 / 0 / 0 / 5. Earlier cold-adapter timing is explicitly unchanged-component reuse.

Hosted evidence included three fresh desktop contexts, one mobile context, 123 API/MCP calls with 32 passed checks plus a separately closed correctly signed-expiry check, actual map resources/draws, session cleanup and the complete grounded-agent UI flow. The backend corpus passed 70 cases: 36 distinct grounded model turns, 16 evidence-empty cases and 18 refusals. Three measured UI responses included two failed harness attempts and one full pass; they are not three passing flows or extra distinct-query credit. Earlier failures remain dated history.

These results bind the exact accepted heads/packages in [release status](RELEASE_STATUS.json). They are not fresh results for a later documentation commit, GitHub-hosted Actions, an employer score or a guarantee of future availability.

## Accepting a later release

The external release receipt must bind clean source head/tree, contract/module graph, lockfile, Lambda ZIP, frontend assets, public/protected snapshot and deployed identity. Repeat clean first use, API/MCP, model/map, lead/session isolation, expiry/logout/revocation, telemetry, privacy and independent review for that identity. Preserve failed attempts and quota consumption. Native BugBot was unavailable in the accepted baseline; its independent fallback is explicitly labeled and is not a native invocation.

[The release checklist](RELEASE_CHECKLIST.md) separates local, hosted, privacy, media and submission gates. A plan or successful health response is not complete acceptance; CI does not promote missing business outcomes.
