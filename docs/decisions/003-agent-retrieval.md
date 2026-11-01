# Typed retrieval and deterministic factual rendering

Status: accepted local implementation decision; factual source/external results remain separately measured gates.

Oracle exposes bounded validated query/MCP interfaces. The CRM owns the Vercel AI SDK provider and typed retrieval/selection path. Server-side predicates, source rights and deterministic rendering remain authoritative. No raw SQL, filesystem, arbitrary browser or secret access is added for model convenience. The shared contract changes only through the serialized source/schema freeze.
