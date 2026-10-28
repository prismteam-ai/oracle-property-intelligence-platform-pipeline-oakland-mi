# Protected source intake

The private working database retains all twelve visible Troy source fields, including source Applicants who are people or unclassified, Applicant postal fields, Lot, Subdivision, the source Work Description, and Value. The existing property model remains a separate minimized projection. An Applicant is not claimed to be a contractor.

`private-source-intake.parquet` contains every acquired source record, including records without a safe current-property assignment. Its nine outer columns are `source_id`, `native_id`, `source_record_digest`, `observed_at`, `public_snapshot_id`, `source_fields_json`, nullable `matched_property_id`, `join_status`, and `source_receipt_digest`.

`source_fields_json` has exactly these twelve string keys: Permit Type, Permit Number, Date Issued, Address, Applicant, Applicant Address, Applicant City State Zip, Parcel #, Lot, Subdivision, Work Description, Value. Blank source values stay blank. The intake preserves the visible text extracted from the saved official HTML; the extraction normalizes display whitespace, while the unchanged original HTML remains privately retained. A digest over all twelve values and the recorded response digest bind each record to its source observation. No field is repurposed as proof of contractor role, completed work, active licensing, or permit status.

The runtime loads the bounded `private_source_intake` table and the `private_troy_source_fields` inspection view. The view expands the twelve source fields into `permit_type`, `permit_number`, `date_issued`, `address`, `applicant`, `applicant_address`, `applicant_city_state_zip`, `parcel_number`, `lot`, `subdivision`, `work_description`, and `value`, with source and join metadata. This is internal authenticated working data. There is no new HTTP, MCP, agent, or model SQL tool exposing these tables. Property/search responses never project these full-source fields. The internal `auditPrivateSourceIntake()` method returns aggregate counts and field names only.

For a bounded private operator inspection, these queries return counts without source rows:

```sql
SELECT join_status, count(*) AS records
FROM private_source_intake
GROUP BY join_status;

SELECT count(*) AS records,
       count(*) FILTER (WHERE applicant_address != '') AS with_source_postal_field,
       count(*) FILTER (WHERE matched_property_id IS NULL) AS unassigned
FROM private_troy_source_fields;
```

Non-null property assignments must have exactly one current canonical property and align with the minimized permit projection. Unmatched or conflicting source records retain null assignments; they are never discarded or assigned a fabricated property. Source/native identity, exact keys, field bounds, complete record digests, response digests, public snapshot identity, and uniqueness are checked before use. Intake is capped at 10,000 records, 32,768 UTF-8 bytes per source JSON, and 128 MiB per private sidecar. Existing safe-path, symlink/hardlink, hash, authenticated-runtime, and disabled-external-access guards apply.

Supplemental private manifest version 3 requires exactly four roles: owner, enrichment, permits, and source-intake. Historical version 1 remains exactly owner/enrichment, and version 2 remains exactly owner/enrichment/permits. Public manifest parsing remains version 1. The intake digest participates in the protected snapshot identity; adding full intake changes the protected identity even when the other three sidecars remain byte-identical. Runtime wiring uses `PRISM_PRIVATE_SOURCE_INTAKE` and `PRISM_PRIVATE_SOURCE_INTAKE_SHA256`, requires authenticated mode, and keeps the file out of all public publication allowlists. Canonical Property/Query contract version 0.3.0 is unchanged.

The complete visible-filter source cohort and all field-presence counts are recorded in aggregate evidence. Source rows, person names, postal fields, raw descriptions, and Parquet bytes stay outside Git and returned artifacts, in the protected source/working-data storage only.
