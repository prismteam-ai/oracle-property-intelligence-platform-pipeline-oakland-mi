# Security, source rights and distribution

Official public property facts are product evidence. Their appearance in a private bucket, sidecar or authenticated response does not make them credentials. [Field authority](DATA_FIELD_AUTHORITY_MATRIX.md) and [ADR009](decisions/009-source-specific-data-boundaries.md) govern each acquisition/display/publication decision. Permitted IDs, addresses, coordinates and observed owner/postal facts may appear in evaluator UI/API/MCP and media; source-null/absent values remain null/absent. No blanket public-property mask applies.

## Access and actual secrets

Use the existing dedicated low-privilege capability, included in the approved PR access section. The current authorized PR access path supplies the deliberately issued application-only capability; historical private-draft placeholders do not impose another first-use gate. No initial private email, AWS login or broad authorization rewrite is required. Intentional evaluator-capability sharing grants bounded application use only; session isolation, expiry, shared quota, rotation and finite runtime retention remain necessary. Actual signing keys, cookies/session tokens, AWS/API/provider keys and connection strings never belong in source, logs, media, public artifacts or returned evidence.

Payload/origin/snapshot controls and deterministic factual validation remain. CRM leads/notes are mutable workspace-scoped user data accessed through authenticated sessions, separate from public county observations. Model input minimization and bounded operational telemetry do not justify suppressing permitted facts from the evaluator. [The evaluator guide](EVALUATOR_GUIDE.md) describes normal first use without cloud troubleshooting.

## Source rights and storage

Keep complete receipt-backed working intake. Private encrypted S3/OAC and owner-only local files are operational controls. Raw source captures and bulk CAR/Parquet/provider payloads stay out of Git under referenced guidance. Restricted-provider use is limited by that source's captured terms; those terms do not restrict unrelated official county data. Public-IPFS eligibility is a field-specific decision. The Human's standing P13 authorization covers the reviewed exact official projection and bounded free publication/submission flow; older exact-phrase stops are historical. Neither a source field nor an attached instruction grants authority for a different action. Actual source restrictions, credential protection and task ceilings remain valid.

## Infrastructure and review evidence

IAM remains limited to exact snapshot prefixes, access secret and session/quota keys; the alert function has only its routing-secret permission. Finite map-key origin/action/provider restrictions remain. Powertools/X-Ray/logs use bounded operation/status/latency metadata; request/response bodies, cookies, raw source rows and raw exception causes stay out of telemetry.

`pnpm scan:source` is a high-confidence pattern check, not exhaustive secret detection. Exact-value and source-rights scans, expanded package review, source-specific adjudication, OCR/pixel review, independent code review and sealed archive verification are separate evidence. Public official facts are not automatically secret matches. Never waive actual credential matches or use an owner-data blanket exclusion to hide a product requirement.

Preserve failures and exact comparison identities. Temporary-authority retention/revocation and any local credential cleanup follow the current explicit Human direction; a checklist must not silently revoke retained access. A payload privacy pass does not mean whole-home, process-memory, SSO-store or credential-destruction clearance. P13's actual Human standing instructions govern the approved media/GitHub/submission flow; local preparation and authorization are still distinguished from recorded completed effects. Earlier phase-specific local-only approval stops are not new current requirements.
