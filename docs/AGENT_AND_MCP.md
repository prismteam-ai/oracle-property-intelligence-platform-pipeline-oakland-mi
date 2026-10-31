# Grounded agent and MCP

Oracle owns the prepared source read model; CRM consumes its versioned contract and never re-ingests county/provider data. The authenticated hosted `/api/mcp` endpoint uses the official MCP SDK and the loaded snapshot. Its read-only tools are `search_properties` (maximum 50 returned), `property_evidence` and `snapshot_status`. It exposes no arbitrary SQL, filesystem, acquisition, model execution, publication or administrative mutation.

For a fixture-only local client, after the [local installation](LOCAL_DEVELOPMENT.md), use:

```sh
PRISM_DATA_MODE=synthetic pnpm mcp:stdio
```

For real stdio use, select separately verified real inputs through the private operator configuration. Hosted direct clients use the supplied low-privilege session flow and `/api/mcp`; no privileged AWS credential belongs in a client example. Initialization, tool listing, bounded calls and malformed/refused paths form part of exact-release [acceptance](TESTING.md).

## How grounded retrieval works

CRM applies, refuses or surfaces every material constraint before a model call. A preflight can establish empty evidence without inference. A nonempty accepted turn permits one Vercel AI SDK/Bedrock attempt with a typed `retrieveProperties` tool and at most two bounded Oracle reads against the same approved query. Deterministic server code validates arguments, digests and citations and renders authoritative facts. Model prose cannot invent property identities, permit status/dates, counts, contractors or BBB ratings.

Source predicates keep building-year proxy, native status, provider activity, issue age and documented continuous-open duration distinct. Stronger unsupported claims and actions are refused visibly. The accepted Novi example uses `roofMinAgeYears=15`, unknown excluded and age greater than 15; missing positive permit evidence remains the [documented source limitation](KNOWN_LIMITATIONS.md).

Model calls share the durable limits and dated headroom in the [evaluator guide](EVALUATOR_GUIDE.md). Empty/refused cases are not grounded model successes; retries and new sessions do not reset reservations.

For the older-open permit prompt, the server first runs `confirmed_open` with the source-calendar year threshold. A strict-empty result can trigger one separate `status_verification_needed` read with the same place/radius/age constraints. That deterministic two-read fallback uses no model call and exposes separately labeled section queries, counts, citations and apply authority; the strict primary result stays empty. Explicit continuous-open requests keep their original interval requirement. The read-only search API and MCP `search_properties` share the optional 0.7.0 mode/age/issue-sort fields described in [permit opportunities](PERMIT_OPPORTUNITIES.md).

## External discovery boundary

The public Elephant MCP repository returned `Repository not found` during the dated 2026-10-29 reference check. This records access/availability, not proof the service does not exist. Local MCP compatibility does not establish shared MCP synchronization, internal registry writes, Atlas registration or global discovery. [Publication](IPFS_PUBLICATION.md) separates local compatibility from those unperformed external effects.

Data classification follows the [field authority matrix](DATA_FIELD_AUTHORITY_MATRIX.md). Existing public-artifact-only and authenticated observation modes remain separate technical profiles. Legacy `private_`/`protected-real` names do not classify all official facts as secrets. Use the current source-backed observation manifest for actual admitted facts; official permitted identities may be visible in evaluator/media even when transport is authenticated. Restricted-source payloads and credentials retain their own limits.
