# Oakland County property intelligence

Oracle turns Oakland County parcel and address sources into portable, source-backed property intelligence. Its hosted workspace shows coverage, run history, query results and provenance; the Roofing CRM uses the same read model for map discovery, leads and grounded agent answers.

Open the [Oracle workspace](https://dknck94i8grek.cloudfront.net) with the low-privilege evaluator capability in the approved PR access section. No AWS account or local installation is needed. The [evaluator guide](docs/EVALUATOR_GUIDE.md) gives the short walkthrough, access window, quotas and recovery steps. [Known limitations](docs/KNOWN_LIMITATIONS.md) explains the completed free-source outcome, including the unavailable current-active/long-open permit cohort. No paid source is required to reproduce the admitted runtime.

The [original employer assignment](docs/history/ASSIGNMENT_README.md) remains the contract. [Implementation](IMPLEMENTATION.md), [architecture](docs/ARCHITECTURE.md), the [sixteen-stage county onboarding map](docs/COUNTY_ONBOARDING_ALIGNMENT.md), [field authority](docs/DATA_FIELD_AUTHORITY_MATRIX.md) and the [documentation index](docs/README.md) describe the delivered system without replacing it.

## Run locally

Use Node 24, pnpm 11.25.0 and Linux x64 for the pinned native tooling:

```sh
pnpm install --frozen-lockfile
pnpm tooling:install
pnpm exec playwright install chromium
PRISM_DATA_MODE=synthetic PRISM_ACCESS_MODE=local pnpm api
```

In a second terminal run `pnpm dev`, then open http://127.0.0.1:4173. These explicit flags select labeled fixtures. Real inputs require verified immutable artifacts and source-specific observation manifests; authenticated storage does not classify every record as private. See [local development](docs/LOCAL_DEVELOPMENT.md).

## Verify a release

`pnpm ci:verify` runs the canonical local verification sequence with Chromium and the pinned Docker runtime image. Exact local results, hosted acceptance and remote GitHub Actions are separate evidence. [Testing](docs/TESTING.md) and the [release checklist](docs/RELEASE_CHECKLIST.md) define the gates.

For the deployed identity, match authenticated `/api/health` and served frontend identity to the dated external release receipt. [Release status](docs/RELEASE_STATUS.json) preserves the exact previously accepted identities and this binding rule; a documentation commit alone cannot certify deployment. [Deployment](docs/DEPLOYMENT.md) describes guarded updates to the existing review stack.
