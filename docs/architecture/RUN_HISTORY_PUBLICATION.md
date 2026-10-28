# Run history publication

`pnpm publication:local <verified-snapshot-directory>` keeps the legacy eight-file data root. The explicit `--profile run-history-v2` option adds `runs.json` and a strict, minimized `run-manifest.json` to those eight files. It verifies the new run's history, source content digests, counts, dataset identity, and public field allowlists before creating a deterministic CAR. It makes no network requests or provider changes.

The run profile retains the prior dataset CID and snapshot ID in history. A genuine complete source reconciliation with zero added, changed, or deleted facts can still produce a new run root from observation history, contract changes, or provenance. Its manifest states fact changes separately from schema/provenance changes; a new CID alone is not evidence that county facts changed. The source observation window is not a transactional server snapshot.

Publishing the resulting bytes is a separate authorized operation. Raw source responses, protected observations, owner names and contacts, and vendor/municipal records without redistribution rights are excluded from both profiles.
