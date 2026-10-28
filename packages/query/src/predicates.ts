export {
  permitEvidenceMatches,
  needsPermitEvidence,
  hasMinimumVerifiedTenure,
} from "../../contracts/src/query-predicates.ts";
/** All presence conditions apply to the same permit that satisfies status and duration. */
export const PERMIT_EVIDENCE_SQL = `
AND (NOT $requiresContractor OR nullif(trim(x.verified_company_id),'') IS NOT NULL)
AND (NOT $requiresVerifiedLicense OR (nullif(trim(json_extract_string(x.canonical_json,'$.contractor.licenseEvidence.identifier')),'') IS NOT NULL AND json_extract_string(x.canonical_json,'$.contractor.licenseEvidence.confidence')='high'))
AND (NOT $requiresBbbRating OR nullif(trim(json_extract_string(x.canonical_json,'$.contractor.ratingEvidence.value')),'') IS NOT NULL)`;
