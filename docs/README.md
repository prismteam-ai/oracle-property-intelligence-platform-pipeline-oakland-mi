# Documentation guide

Start with the [evaluator guide](EVALUATOR_GUIDE.md) to use the hosted workspace. For implementation review, read [architecture](ARCHITECTURE.md), [coverage](DATA_COVERAGE.md) and [known limitations](KNOWN_LIMITATIONS.md). The [original employer assignment](history/ASSIGNMENT_README.md) remains the assessment contract.

## Current guides

- [County onboarding: all sixteen referenced stages](COUNTY_ONBOARDING_ALIGNMENT.md)
- [Field authority and every data boundary](DATA_FIELD_AUTHORITY_MATRIX.md)
- [Current source-specific classification decision](decisions/009-source-specific-data-boundaries.md)

- [Architecture and decisions](ARCHITECTURE.md)
- [Permit opportunities: lifecycle and verification](PERMIT_OPPORTUNITIES.md)
- [Data coverage and source semantics](DATA_COVERAGE.md)
- [Local development](LOCAL_DEVELOPMENT.md)
- [Testing and evidence scope](TESTING.md)
- [Deployment and rollback](DEPLOYMENT.md)
- [Evaluator access and walkthrough](EVALUATOR_GUIDE.md)
- [Agent and MCP](AGENT_AND_MCP.md)
- [Current public CID, portable DuckDB and publication history](IPFS_PUBLICATION.md)
- [Costs, retention and teardown](COST_MODEL.md)
- [Security and privacy](SECURITY_PRIVACY.md)
- [Known limitations](KNOWN_LIMITATIONS.md)
- [Release identity authority](RELEASE_STATUS.json)
- [Release checklist](RELEASE_CHECKLIST.md)

## Supporting records

[Public reference pins](PUBLIC_REFERENCE_PINS.json), [immutable reference pins](reference-pins.json), [local publication receipt](LOCAL_PUBLICATION_CHECK.json), [parameterized cost estimate](COST_ESTIMATE.json), [observability](OBSERVABILITY.md) and [decision records](decisions/README.md) retain their stated dates and scopes. [Historical authority](history/README.md) and Git history preserve earlier requirements, designs and evidence. A dated observation is not a promise that a later release repeated it.

Package scripts are the command authority. Active links are checked by `pnpm docs:check`; the external release receipt records which exact source passed full verification and hosted rehearsal. Runtime health and served frontend identity, rather than a self-referential Git hash in these guides, identify the deployed release. Moving engineering references do not rewrite the original assignment.
