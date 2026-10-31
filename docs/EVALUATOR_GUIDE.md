# Try the property-intelligence workspace

Open [Oracle](https://dknck94i8grek.cloudfront.net) and enter the low-privilege evaluator capability in this PR's access section. You need a browser, not an AWS account, clone, Docker or local server. The paired [Roofing CRM](https://d1rvqgm0k272e6.cloudfront.net) uses the same source-backed query model for map discovery, leads and agent answers.

The approved PR supplies the live links, application-only capability, dated retained-through limits, model headroom and playable video. No private email exchange is needed to begin. A sign-in session lasts one hour; capability lifetime, runtime/map expiry and quota are separate finite limits. Use the latest release receipt rather than an older date in source history.

## Five-minute walkthrough

1. In Oracle, inspect the run summary, source coverage, capture dates and immutable run history.
2. Open **Query lab**. Set **Center latitude** to `42.4810994939`, **Center longitude** to `-83.4950218553`, **Radius (miles)** to `5`, **Roof older than (years)** to `15`, **Permit opportunity** to **No permit filter**, **Permit status** to **All permits**, and **Minimum open days** to `0`; leave the other source filters at their defaults. Click **Run query**. These are the source-verified City of Novi center coordinates. Setting a positive roof-age threshold automatically excludes unknown ages; there is no separate city selector or unknown-age checkbox in Oracle. The dated accepted snapshot returned **648 matches / 50 rows**. Its unchanged predicate means age greater than 15; building year is a labeled proxy, not a roof-installation date.
3. Inspect the real address, PIN/KEYPIN or source ID, canonical identity, coordinates, roof basis, native permit dates/status and provenance. Official permitted identities are visible. Show the official parcel/postal observation when admitted; null names or absent contacts remain explicitly unavailable. Current-PIN deed-index gaps carry their cutoff and do not establish legal ownership continuity.
4. Open Artifacts & lineage to inspect the runtime identity and historical public manifests/CIDs. Source-specific runtime observations and local-only roots are not proof of public publication.
5. In CRM, apply the same radius/age query, compare map/list/detail, create an isolated review lead and inspect its history. Ask the grounded agent for the same constraints, then inspect applied predicates, retrieval counts and citations. Archive review test leads and use CRM’s **Sign out** when finished. Oracle has a one-hour session and an API logout boundary; no Oracle Sign out button is implied.

For permit opportunities, change the center to source-covered City of Troy (`42.5790196146, -83.1483459216`), retain five miles and clear the separate roof-age threshold. Compare **Confirmed open / active** at the five-year issue/status-age threshold with **Status verification needed**. When strict open is empty, the latter shows a distinct follow-up cohort; it never relabels issued-only or unknown records OPEN. Inspect the date, age basis, native status, reported party and provenance. The [permit guide](PERMIT_OPPORTUNITIES.md) distinguishes the measured full cohort from actual radius counts; [known limitations](KNOWN_LIMITATIONS.md) preserves the confirmed-open/continuous-duration source gap. No paid source or subscription is needed.

## Access and quota

The capability permits bounded source-backed reads and isolated lead workflows. Authentication is an access choice, not a claim that official county facts are secret. It grants no administration, source acquisition, publication or outreach. Expired/revoked sessions deny protected reads. Oracle health reports access mode `review`; CRM reports `review-session`. These valid names differ.

Agent limits are shared across operator, media and evaluator use: **120 model reservations total, 80 per UTC day and 40 per session-hour**; validated requests are 200 total, 160 per UTC day and 40 per session-hour, with a separate 240/day endpoint cap. Later operator/media/evaluator activity consumes the same durable balances. A new session or deployment never resets them. The approved PR's dated readback gives actual remaining headroom; source history is not current capacity.

## Failure recovery

- **401:** the one-hour session may have expired. Sign in again with the current capability. A rotated/revoked capability must remain denied; it is not an AWS login problem.
- **429:** stop repeated agent requests. Respect the applicable UTC-day/session/total limit and the dated headroom; a new browser does not create more quota.
- **Loading or map failure:** let the bounded cold request finish, then refresh once. Verify HTTPS and the release access sheet's retention date. Do not replace map keys or enter privileged credentials.
- **Persistent failure:** retain the time, step and safe error/status or snapshot identity. Exclude the capability, cookies and actually restricted/private user details. A source-specific permitted official address or parcel ID is not itself a secret. This guide does not require cloud troubleshooting by the evaluator.

The [release binding](RELEASE_STATUS.json) matches authenticated health and served frontend identity to exact source/package/snapshot acceptance. Dated prior technical acceptance is retained as history; the displayed release and any new owner/postal admission require their own current receipt. Historical results are not a new deployment claim or a guarantee of indefinite availability.
