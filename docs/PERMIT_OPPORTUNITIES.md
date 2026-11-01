# Roofing permit opportunities

Use two separate signals: **source-confirmed lifecycle** and **a reason to follow up**. A status-verification candidate is an older roofing-permit observation whose current lifecycle needs municipal verification. It is not a confirmed-open or stalled-open permit.

## Choose a workflow

Leave **Permit opportunity** at **No permit filter** for the normal aged-roof search. This omits the optional permit mode and keeps properties without a roofing permit in scope. **Any roofing permit** is an explicit filter requiring an admitted roofing-related observation; it is not the default.

Select **Confirmed open / active** for explicit admitted open/active evidence. **Minimum open days** additionally requires a justified continuous interval. An old issue date, an absent final date or a literal `ISSUED` label cannot supply that interval.

For follow-up work, select **Status verification needed** and set **Minimum age since issue/status (years)** to **5**. Classification, date, native/reported status, listed party and provenance stay attached to the same observation. Age is strictly older than the selected observation's source-calendar anniversary; it is not five times 365 days or the browser's current date. Same-permit closed/final/completed/cancelled/revoked/expired evidence excludes a verification candidate. A terminal observation on another permit does not erase an independent candidate.

**Confirmed closed / final** and **Lifecycle unknown** remain separate choices. Unknown includes insufficient lifecycle evidence; not every unknown record meets the older-roofing verification preset. Verification results rank by qualifying observation age and join confidence, then distance and identity. Confirmed-open results prioritize justified open duration. Map/list counts and details refer to the selected query and bounded page.

## Use covered places and read the evidence

Keep City of Novi for the five-mile aged-roof example: `roofMinAgeYears=15`, unknown ages excluded, with the accepted historical 648 total/50 returned. Building year is a labeled roof-age proxy, not an installation date. Use City of Troy for the measured permit follow-up workflow, with roof-age filtering cleared so it does not silently remove permit candidates.

The deterministic admitted-data census as of **2026-10-28** found **4,487 candidate permits across 4,227 properties** before radius selection; two candidate permits/properties have no canonical mapped point. These are full admitted-cohort counts, not a five-mile result or a countywide denominator. Actual radius/page counts come from the matching release's query receipt. No new source acquisition is implied.

The municipal Troy candidate records retain `reportedStatus: null` where no native label was supplied. Their `issued_only` basis describes the evidence; it does not fabricate a native `ISSUED` status. A different source may report `ISSUED` literally, which still does not mean OPEN. A listed applicant/business is an unverified reported party unless independent role evidence establishes more. License availability alone does not verify the job contractor; missing BBB is unavailable, not zero.

## Shared 0.7.0 API and MCP query

The producer and consumer share contract 0.7.0. The following authenticated Oracle `POST /api/search` body also supplies the arguments for read-only MCP `search_properties` at `/api/mcp`. Replace the snapshot placeholder with the current loaded snapshot from authenticated health; MCP bounds the returned page to 50.

```json
{
  "snapshotId": "<loaded-snapshot-id>",
  "lat": 42.5790196146,
  "lng": -83.1483459216,
  "radiusMeters": 8046.72,
  "permitOpportunityMode": "status_verification_needed",
  "minPermitObservationAgeYears": 5,
  "sort": "permit_issue_age_desc",
  "permitStatus": "any",
  "minOpenDays": 0,
  "includeUnknown": false,
  "limit": 50
}
```

For the strict comparison, change `permitOpportunityMode` to `confirmed_open` and retain the five-year source-calendar threshold. Use `any_roofing_permit`, `confirmed_closed` or `lifecycle_unknown` for their respective scopes; omit the new age field when no age constraint is intended. Omit all three new mode/age/issue-sort fields for the legacy no-permit-filter search. The new age and `permit_issue_age_desc` sort require a mode. Contradictory lifecycle/open-duration combinations refuse rather than silently broaden. Mode, age and sort participate in query hashes and cursor identity; rerun after changing them instead of reusing the old cursor.

For “show me open roofing permits older than five years within five miles of Troy,” the agent first retrieves strict confirmed-open evidence. When it is empty, it returns a separate **Status verification needed** section with its own query, count, source facts, citations and apply action. Those alternatives are explicitly not confirmed open. This strict-empty fallback uses deterministic retrieval and no model call; it is not labeled successful model inference. An explicit continuous-open request keeps its interval semantics and is not replaced by issue-age candidates.

The original 114-row trace, its 62 null / 52 false historical flags and eight source-positive gaps are unchanged. The useful verification lane does not prove current-open or uninterrupted long-open source coverage, complete ownership history, new public publication or later hosted acceptance. Current source functionality, actual release verification and the preserved historical source outcome remain distinct. See [coverage](DATA_COVERAGE.md), [known limitations](KNOWN_LIMITATIONS.md) and [agent/MCP](AGENT_AND_MCP.md).
