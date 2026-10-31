import { z } from "zod";
import { sha256 } from "./model.ts";

export const INDEPENDENCE_INLINE_EVIDENCE_VERSION =
  "independence-inline-source-observations-v1";
const SOURCE = "official-independence-public-permits";
const SourceRow = z
  .object({
    source_id: z.literal(SOURCE),
    native_id: z.string().regex(/^[0-9]{1,20}$/),
    source_record_json: z.string().min(1).max(32_768),
    record_digest: z.string().regex(/^[a-f0-9]{64}$/),
    observed_at: z.iso.datetime(),
    property_id: z.string().nullable(),
  })
  .passthrough();
const CLOSEOUT = {
  nativeId: "2623310",
  permitNumber: "PB260514",
  propertyId: "oakland-parcel-444063",
  recordDigest:
    "d416eedb70868f582e8b8bb4f8acd1edf248148cd173ca81f38f1938ed0e23f3",
  issuedAt: "2026-05-27",
  reportedStatus: "CLOSED",
  closedAt: "2026-06-09",
  quote:
    "PERMIT CLOSED OUT PER REQUEST OF CONTRACTOR APPROVED PER DM 06/09/2026",
} as const;
const BUSINESS_NOTE = {
  nativeId: "2622164",
  permitNumber: "PB250524",
  propertyId: "oakland-parcel-451882",
  recordDigest:
    "180989711883e41475ad868e6f30c368df3989d270b398e8f022e0f5e42c0ec5",
  issuedAt: "2025-06-23",
  reportedStatus: "EXPIRED",
  name: "CRAFTSMAN EXTERIORS",
  quote:
    "9/15/25 CRAFTSMAN EXTERIORS SUBMITTED AN ADDITIONAL PROJECT FOR SIDING.",
} as const;

export interface IndependenceInlineObservation {
  version: typeof INDEPENDENCE_INLINE_EVIDENCE_VERSION;
  sourceId: typeof SOURCE;
  recordId: string;
  recordDigest: string;
  observedAt: string;
  propertyId: string;
  permitNumber: string;
  reportedStatus: string;
  sourceField: "Work_Description";
  closeout?: {
    date: string;
    quote: string;
    basis: "explicit_dated_permit_closeout_not_roof_completion";
  };
  mentionedBusiness?: {
    name: string;
    quote: string;
    role: "business_mentioned_in_siding_note_job_contractor_unverified";
    licenseVerified: false;
    bbbRatingAvailable: false;
  };
}

/** Two reviewed official notes; no generic name/date extraction or network call. */
export function deriveIndependenceInlineEvidence(
  input: unknown,
): IndependenceInlineObservation | null {
  try {
    const row = SourceRow.parse(input);
    if (sha256(row.source_record_json) !== row.record_digest) throw new Error();
    const expected =
      row.native_id === CLOSEOUT.nativeId
        ? CLOSEOUT
        : row.native_id === BUSINESS_NOTE.nativeId
          ? BUSINESS_NOTE
          : null;
    if (!expected) return null;
    const raw = JSON.parse(row.source_record_json) as {
      attributes?: Record<string, unknown>;
    };
    const attrs = raw.attributes;
    if (
      row.record_digest !== expected.recordDigest ||
      row.property_id !== expected.propertyId ||
      attrs?.OBJECTID !== Number(expected.nativeId) ||
      attrs.Permit_Number !== expected.permitNumber ||
      attrs.Status !== expected.reportedStatus ||
      typeof attrs.Date_Issued !== "number" ||
      !Number.isSafeInteger(attrs.Date_Issued) ||
      new Date(attrs.Date_Issued).toISOString().slice(0, 10) !==
        expected.issuedAt ||
      typeof attrs.Work_Description !== "string" ||
      !attrs.Work_Description.includes(expected.quote) ||
      expected.issuedAt > row.observed_at.slice(0, 10)
    )
      throw new Error();
    const result: IndependenceInlineObservation = {
      version: INDEPENDENCE_INLINE_EVIDENCE_VERSION,
      sourceId: SOURCE,
      recordId: expected.nativeId,
      recordDigest: expected.recordDigest,
      observedAt: row.observed_at,
      propertyId: expected.propertyId,
      permitNumber: expected.permitNumber,
      reportedStatus: expected.reportedStatus,
      sourceField: "Work_Description",
    };
    if (expected === CLOSEOUT) {
      if (CLOSEOUT.closedAt > row.observed_at.slice(0, 10)) throw new Error();
      result.closeout = {
        date: CLOSEOUT.closedAt,
        quote: CLOSEOUT.quote,
        basis: "explicit_dated_permit_closeout_not_roof_completion",
      };
    } else {
      result.mentionedBusiness = {
        name: BUSINESS_NOTE.name,
        quote: BUSINESS_NOTE.quote,
        role: "business_mentioned_in_siding_note_job_contractor_unverified",
        licenseVerified: false,
        bbbRatingAvailable: false,
      };
    }
    return result;
  } catch {
    throw new Error("Official inline permit observation binding rejected");
  }
}

/** Legacy null dates remain valid; this predicate admits only the pinned closeout. */
export function isSupportedIndependenceCloseout(input: {
  sourceId: string;
  nativeId: string;
  propertyId: string;
  recordDigest: string;
  permitNumber: string | undefined;
  reportedStatus: string | null | undefined;
  issuedAt: string | null | undefined;
  observedAt: string;
  closedAt: string | null;
}): boolean {
  return (
    input.sourceId === SOURCE &&
    input.nativeId === CLOSEOUT.nativeId &&
    input.propertyId === CLOSEOUT.propertyId &&
    input.recordDigest === CLOSEOUT.recordDigest &&
    input.permitNumber === CLOSEOUT.permitNumber &&
    input.reportedStatus === CLOSEOUT.reportedStatus &&
    input.issuedAt === CLOSEOUT.issuedAt &&
    input.closedAt === CLOSEOUT.closedAt &&
    input.issuedAt <= input.closedAt &&
    input.closedAt <= input.observedAt.slice(0, 10)
  );
}
