# Delivered implementation and release status

Oracle keeps a controlled local producer and a scale-to-zero authenticated AWS read plane. Source intake, normalization, reconciliation, immutable run history, public publication eligibility, protected observation projection and query access are separate modules. The original assignment is preserved in [the frozen README](docs/history/ASSIGNMENT_README.md).

The accepted county baseline contains 490,775 parcel records and 559,701 site-address records, reconciled into 490,799 canonical properties. Its protected companion has 39,282 normalized permit observations, 3,747 reported-owner observations, and 669 building-year observations across 659 distinct nonconflicting properties. These are observation counts, not verified roof installations, ownership continuity or unique current open permits. The source campaign may promote a new companion only through exact reviewed manifests.

Current candidate changes add pinned least-privilege CI, explicit package-build permission, standard CDK assets/deployment, neutral review identities, 90-day logs, active X-Ray and Powertools, bounded alert delivery, and selective query/UI decomposition. Source status/rights and final deployment are independently recorded by the operator; local implementation does not imply a new live release.

Historical public CIDs and source semantics remain unchanged. No new real public publication, global discovery mutation, PR, submission or media work is performed by these local changes. See [known limitations](docs/KNOWN_LIMITATIONS.md), [architecture](docs/ARCHITECTURE.md) and [release checklist](docs/RELEASE_CHECKLIST.md).
