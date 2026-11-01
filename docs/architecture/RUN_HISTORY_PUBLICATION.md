> Historical baseline reference. Current operating instructions are in the [documentation index](../README.md). Source identities and observations below describe their recorded earlier revision.

> Historical implementation/reference document, superseded for current operation by [the current documentation index](../README.md). Preserve its dated claims as historical evidence.

# Run history publication

`pnpm publication:local <verified-snapshot-directory>` keeps the legacy eight-file data root. The explicit `--profile run-history-v2 --previous <trusted-legacy-publication-directory>` option adds `runs.json` and a strict, minimized `run-manifest.json` to those eight files. It strictly validates every history row and nested field, verifies the prior publication files and CAR, and binds prior CID/snapshot history and schema/provenance claims to that trusted local input. It also verifies source content digests, counts, dataset identity, and public field allowlists before creating a deterministic CAR. It makes no network requests or provider changes.

The run profile retains the prior dataset CID and snapshot ID in history. A genuine complete source reconciliation with zero added, changed, or deleted facts can still produce a new run root from observation history, contract changes, or provenance. Its manifest states fact changes separately from schema/provenance changes; a new CID alone is not evidence that county facts changed. The source observation window is not a transactional server snapshot.

Publishing the resulting bytes is a separate authorized operation. Raw source responses, protected observations, owner names and contacts, and vendor/municipal records without redistribution rights are excluded from both profiles.
