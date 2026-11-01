/** Bounded report-level metadata verified from retained official P2 documents.
 * No observations, owner/contact fields or source document bytes are embedded.
 * Registry evidence: P3 protected_source_context_registry.json, verified 2026-10-27.
 */
const historicalPublicationScope =
  "Historical publication scope only: the previously approved exact-byte public snapshots excluded raw PDFs and these owner/address/contact/provider observations. That scope does not prohibit retained working facts or categorically exclude official public facts. Each new public candidate needs its own source-specific eligibility decision and exact-byte approval; restricted-provider payloads and credentials remain excluded.";
const sources = {
  "official-novi-residential-sales-pdf": {
    sourceId: "official-novi-residential-sales-pdf",
    officialReportUrl:
      "https://www.cityofnovi.org/media/w1efyceh/residential-non-condo-401-sales.pdf",
    officialLandingPageUrl:
      "https://www.cityofnovi.org/services/assessing/sales-data/",
    bodySha256:
      "05b8756408ed83da7589af437c9eb8ac3423b8b8a2431ee47967a37119f1bbb5",
    sourceObservedAt: "2026-10-27T08:17:03.790110+00:00",
    reportPages: 18,
    visibleTitle: "RESIDENTIAL NON-CONDO 401 SALES",
    declaredReportPeriod: null,
    declaredReportPeriodStatus:
      "not_stated_in_reviewed_report_headers_or_period-labelled_text",
    observedSaleDateRange: {
      from: "2023-04-03",
      to: "2025-12-31",
      basis: "range_of_extracted_observations_not_declared_report_period",
    },
    exactPinMatchMethod:
      "Explicit published 50-XX-XX-XXX-XXX parcel format: remove only literal50- and dashes; exact normalized10-digit PIN membership checked against complete county baseline",
    matchMethodClass:
      "source_format_normalization_then_exact_county_PIN_membership_no_fuzzy_match",
    partialHistory: true,
    tenYearTenureInference: false,
    yearBuiltIsRoofAge: false,
    caveats: [
      "Reported sale observations are a partial assessor study cohort, not complete deed or transfer history.",
      "Observed sale-date range, PDF metadata dates and URL year are separate facts; none is substituted for a declared report period.",
      "Reported built year is a building-year proxy with low confidence for roof age; roof replacement/condition is unverified.",
      historicalPublicationScope,
    ],
    semanticBasis: "building_year_proxy",
  },
  "official-auburn-hills-residential-sales-pdf": {
    sourceId: "official-auburn-hills-residential-sales-pdf",
    officialReportUrl:
      "https://www.auburnhills.org/wp-content/uploads/2025/03/2024-residential-report.pdf",
    officialLandingPageUrl:
      "https://www.auburnhills.org/departments/assessing/reports-sales/",
    bodySha256:
      "45696bdbd461630d3266617df903ef2f8af2582ef6b0e2821e47490d75d47f91",
    sourceObservedAt: "2026-10-27T08:17:03.585039+00:00",
    reportPages: 24,
    visibleTitle: "Sales Data",
    declaredReportPeriod: null,
    declaredReportPeriodStatus:
      "not_stated_in_reviewed_report_headers_or_period-labelled_text",
    observedSaleDateRange: {
      from: "2021-04-01",
      to: "2023-03-31",
      basis: "range_of_extracted_observations_not_declared_report_period",
    },
    exactPinMatchMethod:
      "Published XX-XX-XXX-XXX parcel format: remove dashes only; no county prefix inferred; exact10-digit PIN membership checked against complete county baseline",
    matchMethodClass:
      "source_format_normalization_then_exact_county_PIN_membership_no_fuzzy_match",
    partialHistory: true,
    tenYearTenureInference: false,
    yearBuiltIsRoofAge: false,
    caveats: [
      "Reported sale observations are a partial assessor study cohort, not complete deed or transfer history.",
      "Observed sale-date range, PDF metadata dates and URL year are separate facts; none is substituted for a declared report period.",
      "Reported built year is a building-year proxy with low confidence for roof age; roof replacement/condition is unverified.",
      historicalPublicationScope,
    ],
    semanticBasis: "building_year_proxy",
  },
} as const;
export type MunicipalSourceId = keyof typeof sources;
export function isMunicipalReportSourceId(
  sourceId: string,
): sourceId is MunicipalSourceId {
  return Object.hasOwn(sources, sourceId);
}
export function sourceContext(sourceId: string, page?: number) {
  if (!isMunicipalReportSourceId(sourceId)) return null;
  const source = sources[sourceId];
  if (
    page !== undefined &&
    (!Number.isInteger(page) || page < 1 || page > source.reportPages)
  )
    return null;
  return {
    ...source,
    page: page ?? null,
    pageUrl:
      page === undefined ? null : `${source.officialReportUrl}#page=${page}`,
  };
}
export type SourceContext = NonNullable<ReturnType<typeof sourceContext>>;
