# Data coverage and source semantics

The selected county layers contain **490,775 parcels, 559,701 site addresses, 559,708 parcel/address links and 490,799 canonical properties**. The latter includes 24 address-only entities; it is not a verified assessed-property denominator. There are 559,695 populated site-coordinate pairs, six address rows without coordinates and 463,196 canonical properties with site coordinates. Site points are not surveyed roof locations. Completeness of these selected layers is separate from all-source county completeness.

The current official public projection is [published by CID](IPFS_PUBLICATION.md), with 15 logical database relations and an explicit [reconciliation report](https://dknck94i8grek.cloudfront.net/assessment-reconciliation-report.json). Working API observations and public eligibility are separate views; licensed provider rows are not silently added to public totals.

## Permit rows, observations and joins

P13 completely revalidated three official Independence Township views: 7,791 + 8,479 + 33,014 = **49,284 view representations of 33,014 distinct native records**. The smaller views are exact subsets of the Dashboard view. All 33,014 retained V9 attribute/geometry records were unchanged: zero added, changed or deleted raw facts. This was revalidation, not a first acquisition of those rows.

The public database contains **39,282 normalized permit observations / 39,282 distinct canonical permit IDs across 15,032 properties**:

- Independence: 33,014 native records; 31,525 normalized across 7,952 properties; 1,489 held. Retained association checks held 856 without an official site coordinate, 606 for source/site coordinate conflict and 27 for jurisdiction conflict.
- Troy: all 7,500 native records and all 12 source fields retained; 6,842 normalized across 6,226 properties; 658 held, comprising 567 address conflicts and 91 unmatched rows.
- Rochester Hills: 4,180 monthly report events, including 3,207 APPLIED and 973 ISSUED events. Exact-address/jurisdiction matching joined 3,751; 915 joined ISSUED events became normalized permit observations across 854 properties. The 2,836 joined APPLIED events remain source/owner observations, not issued permits; 429 events are held (371 APPLIED, 58 ISSUED). A native permit number was absent, so these report events are not asserted unique construction jobs.

No duplicate normalized source/native keys or canonical permit IDs were found. The measured same-property/permit-number/issued-date cross-source alias key found zero groups; broader job deduplication is unestablished. Held identities and source-native facts remain available. A unique PIN did not automatically pass coordinate/jurisdiction association checks; these holds are not privacy filtering.

There are 6,896 normalized roofing-kind observations. Source-confirmed open remains zero. Terminal native values are preserved and excluded from verification candidates; `ISSUED`, suspension and missing completion dates do not establish current-open work. Two reviewed native notes are separate derived evidence: one explicit 2026-06-09 permit closeout, and one CRAFTSMAN EXTERIORS siding-submission mention with role unverified. Canonical V9 dates were not restamped or filled from these notes.

## Ownership, roof proxies, business and license evidence

The projection preserves 3,747 source-reported owner-name observations across 1,885 properties, not verified legal ownership: 3,746 Rochester report observations and one Troy assessing observation. Seven parcel derivatives have a documented regional/in-state mailing class; 490,768 remain unknown and no out-of-area class is established. Thirteen current-PIN recorded-index observations cover the documented 2016-10-18–2026-10-19 window; five match the strict greater-than-ten-year gap predicate. They do not establish a complete predecessor-PIN chain or uninterrupted legal ownership.

There are 1,211 assessor observations, with 669 populated building-year observations across 659 properties. Building year is an allowed, labeled low-confidence roof-age proxy, not an installation or replacement date. The exact City of Novi five-mile / roof-age-greater-than-15 / unknown-excluded query returned 648 matches, with a bounded 50-row page. Unknown-age inclusion is a separate query.

Troy source Applicant values produce 4,752 normalized reported-business observations and 746 distinct normalized reported business names. They are applicant-role evidence, not verified roofing-job contractors. **907 permit-linked observations carry medium-confidence LARA license evidence, covering 10 distinct official identifiers**: 894 linked rows record Issued across nine identifiers; 13 record Inactive across one identifier. Original observed dates and exact normalized-name match basis remain visible. These are not 907 licenses, verified company identities, current eligibility certifications or job-contractor matches. Eight later exact-number LARA lookups were a bounded historical availability check, not eight newly admitted contractors.

No BBB rating/rating-evidence row is available in the admitted sources. The explicit unavailable state is not a numeric zero. Live BBB integration is outside the CRM assignment.

## Field availability and dates

All 33,014 municipal records explicitly contain null Name, Contact, Address, Description, Construction_Type, Date_Time_Completed, Inspection_Type, Inspector, Result and Work_Done_By_Owner values. Their absence is in the source, not an implemented removal.

The retained 490,775 parcel records have NAME1/NAME2 present but unpopulated, 490,740 populated POSTALADDRESS values and no PHONE/EMAIL fields. Those observations date to 2026-10-28T03:17:52.724Z–03:29:36.156Z. A later bounded Tax Parcel Plus census saw 490,784 features and 490,749 non-null postal strings; those nine newer features are not an admitted full refresh. Metadata, live census, retained rows and runtime display are distinct evidence.

Normalized permit issue windows are Independence 2010-01-04–2026-10-20, Troy 2000-01-28–2026-10-27 and Rochester report events 2026-04-01–2026-09-30. P13 revalidation/publication timestamps do not make the individual records current. The source report retains exact observation windows, rights/profile digests and limitations.

## Working versus public views

The historical bounded provider fetch contained 133 recent Troy records: 131 persisted accepted observations and two held; 51 joined existing municipal permits and 80 were additional provider candidates. Provider-normalized ISSUED does not override municipal status or prove open work. These licensed rows remain separate and **zero enter the official public projection**. Historical v8/v9 companion and run04 identities remain history; the current public run admits retained eligible official facts under a new immutable CID.

[Field authority](DATA_FIELD_AUTHORITY_MATRIX.md) permits actual source-backed official facts while retaining source-specific restrictions and credential/user-state separation. The current Human-authorized P13 flow supersedes old packet-only/exact-phrase approval stops; no blanket owner/contact masking rule is introduced. [Known limitations](KNOWN_LIMITATIONS.md) preserves the eight original positive-source gaps.
