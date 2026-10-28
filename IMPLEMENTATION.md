# Oakland property evidence — evaluator orientation

The original [assignment README](README.md) is preserved. This implementation acquires official Oakland parcel/address observations, retains provenance, reconciles immutable runs and serves bounded spatial evidence through an authenticated API and MCP. The separate CRM consumes the same versioned contract.

The current working snapshot has 490,799 canonical properties, 490,775 parcel records and 559,701 address records. Run 4 genuinely reobserved the selected public fields; it does not refresh every protected county attribute. The protected working view retains the full earlier county attribute intake, 7,500 Troy source records and 33,014 Independence Public permit records, including unassigned records. Property responses contain 38,367 assigned permit observations; only 31 assigned roof-qualified records have literal CLOSED status. No explicit OPEN or continuous long-open evidence was found in the acquired cohorts.

Original objectives remain partly unmet: a built-year proxy is not observed roof age, partial reported sales are not uninterrupted ownership, and source Applicants are not verified contractors. These gaps remain visible. See [coverage](docs/DATA_COVERAGE.md), [limitations](docs/KNOWN_LIMITATIONS.md) and the [evaluator guide](docs/EVALUATOR_GUIDE.md).

Two immutable assessment-product roots were previously published through independent providers. Run 4 is prepared locally and delivered only through the private review read plane; it is unpublished on IPFS. Current Elephant CLI/Lexicon local conformance is separately evidenced and is not Atlas publication. No GitHub push, PR, media recording or final submission is part of this local closure.

Start with [local development](docs/LOCAL_DEVELOPMENT.md), [architecture](docs/ARCHITECTURE.md) and [release gates](docs/RELEASE_CHECKLIST.md). Release evidence in the accompanying P5 review packet binds the exact head, tree, package and snapshot identities; documentation alone is not proof of hosted acceptance.
