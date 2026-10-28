# Security and privacy

Public artifacts contain only approved county-safe projections. Protected runtime data is a minimized rights-compatible projection. Raw owner/contact/provider records remain in the private working tier and never enter Git, logs, CI artifacts, screenshots or public publication. No source field is fabricated to close a business outcome.

Authenticated review access uses a private secret, expiring signed session cookies and server-side revocation. Requests retain payload limits, read quotas, origin checks, snapshot binding and deterministic factual validation. The operator supplies access details privately; credentials and live tokens must not appear in this repository.

Powertools receives bounded operation/status/latency values only. Request/response bodies, cookies, query inputs, source rows and raw exceptions are excluded from logs and trace metadata. Custom metrics use only service dimensions to limit both privacy exposure and billing cardinality. Alerts transmit a fixed operational summary and hashed alarm correlation key; no raw alarm reason or account identifier is sent to PagerDuty.

Infrastructure blocks public S3 access, uses OAC, encryption and TLS, applies exact task tags, enables active X-Ray and retains logs for 90 days. Runtime IAM is limited to its snapshot prefix, access secret and session/quota keys. The alert function can read only its routing secret and cannot query county data.

`pnpm scan:source` is a custom high-confidence key/bulk-artifact/TypeScript check, not exhaustive secret detection. Final operator exact-source/private-value scans, package expansion, screenshot/OCR review and independent code review remain separate required evidence.
