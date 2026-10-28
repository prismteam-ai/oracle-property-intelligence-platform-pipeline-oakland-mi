import { z } from "zod";
import { PermitSchema, type Permit } from "../../contracts/src/index.ts";
import { sha256, stableJson } from "./model.ts";
export const TROY_SOURCE = "official-troy-issued-permits";
export const TROY_PUBLIC_PAGE = "https://apps.troymi.gov/PermitsIssued";
const SourceRow = z
  .object({
    permitNumber: z.string().trim().min(1).max(120),
    issuedDate: z.string().trim().min(1).max(40),
    siteAddress: z.string().trim().min(1).max(250),
    applicant: z.string().trim().max(500),
    parcel: z.string().trim().max(80),
    reportedPermitType: z.string().trim().min(1).max(120),
    description: z.string().max(5000),
    value: z.string().max(100),
  })
  .strict();
export interface CanonicalJoinCandidate {
  propertyId: string;
  parcelPin: string | null;
  siteAddress: string | null;
  city: string | null;
}
export function normalizeTroyPin(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  // Troy displays municipal prefix88; the county's observed PIN is exactly10digits.
  return /^88\d{10}$/.test(digits)
    ? digits.slice(2)
    : /^\d{10}$/.test(digits)
      ? digits
      : null;
}
export function normalizeTroyAddress(input: string | null | undefined): string {
  if (typeof input !== "string") return "";
  const aliases: Record<string, string> = {
    NORTH: "N",
    SOUTH: "S",
    EAST: "E",
    WEST: "W",
    STREET: "ST",
    ROAD: "RD",
    DRIVE: "DR",
    AVENUE: "AVE",
    COURT: "CT",
    CIRCLE: "CIR",
    LANE: "LN",
    BOULEVARD: "BLVD",
    TRAIL: "TRL",
    PLACE: "PL",
    PARKWAY: "PKWY",
    HIGHWAY: "HWY",
  };
  return input
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((x) => aliases[x] ?? x)
    .join(" ");
}
export function troyBusinessName(input: string): string | null {
  const text = input.replace(/\s+/g, " ").trim();
  if (
    !text ||
    text.length > 200 ||
    /@|\b(?:HOMEOWNER|RESIDENT|OWNER|CONTACT|PHONE|EMAIL)\b/i.test(text) ||
    /(?:\d[\s().+-]*){7,}/.test(text)
  )
    return null;
  return /\b(?:L\.?L\.?C\.?|INC\.?|INCORPORATED|CORP\.?|CORPORATION|LTD\.?|COMPANY|CO\.?|ROOFING|EXTERIORS|SIDING|CONSTRUCTION|BUILDERS|RESTORATION|REMODELING|RENOVATIONS?)\b/i.test(
    text,
  ) || /\bHOME IMPROVEMENTS?\b/i.test(text)
    ? text
    : null;
}
export function troyIssuedDate(value: string): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const match = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(value);
  if (!match) throw new Error("Troy issued-date format rejected");
  const month = months.indexOf(match[1]!);
  const year = Number(match[3]);
  const day = Number(match[2]);
  const date = new Date(Date.UTC(year, month, day));
  if (
    month < 0 ||
    year < 1900 ||
    year > 2100 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  )
    throw new Error("Troy issued date rejected");
  return date.toISOString().slice(0, 10);
}
export function normalizeTroyIssued(
  input: unknown,
  provenance: { observedAt: string; receiptDigest: string },
) {
  const row = SourceRow.parse(input);
  z.iso.datetime().parse(provenance.observedAt);
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(provenance.receiptDigest);
  if (!/^(?:Res\.|Commercial|Com\.),?\s*Roof$/i.test(row.reportedPermitType))
    throw new Error(
      "Permit type is not explicitly roofing; a description mention alone is insufficient",
    );
  const issuedAt = troyIssuedDate(row.issuedDate);
  if (issuedAt > provenance.observedAt.slice(0, 10))
    throw new Error("Future-issued record rejected");
  const replace =
    /\breplace(?:ment)?\b|\bre-?roof\b|\breroof\b|\btear[ -]?off\b|\bre-?shingl/i.test(
      row.description,
    );
  const repair = /\brepair\b|\bpatch\b/i.test(row.description);
  const kind = replace
    ? "roof_replacement"
    : repair
      ? "roof_repair"
      : "roof_unspecified";
  const proposedWorkScope = replace
    ? "Proposed roof replacement described; completion not established."
    : repair
      ? "Proposed roof repair described; completion not established."
      : "Roof work reported; proposed repair/replacement scope unspecified.";
  const reportedName = troyBusinessName(row.applicant);
  const numeric = row.value.replace(/[$,\s]/g, "");
  const sourceDeclaredValue = /^\d+(?:\.\d{1,2})?$/.test(numeric)
    ? Number(numeric)
    : null;
  const workDescriptionDigest = sha256(row.description);
  const fields = {
    permitNumber: row.permitNumber,
    issuedAt,
    reportedPermitType: row.reportedPermitType,
    proposedWorkScope,
    workDescriptionDigest,
    sourceDeclaredValue,
    reportedName,
    normalizedParcel: normalizeTroyPin(row.parcel),
    siteAddress: row.siteAddress,
  };
  const recordDigest = sha256(stableJson(fields));
  const permit = PermitSchema.parse({
    id: "troy-issued-" + sha256(row.permitNumber).slice(0, 24),
    permitNumber: row.permitNumber,
    jurisdiction: "City of Troy, Oakland County, Michigan",
    issuedAt,
    status: "unknown",
    statusBasis: "issued_only",
    reportedStatus: null,
    reportedPermitType: row.reportedPermitType,
    proposedWorkScope,
    openedAt: null,
    closedAt: null,
    kind,
    contractor: {
      reportedName,
      verifiedCompanyId: null,
      license: null,
      rating: null,
      licenseEvidence: null,
      ratingEvidence: null,
    },
    provenance: [
      {
        sourceId: TROY_SOURCE,
        recordId: row.permitNumber,
        observedAt: provenance.observedAt,
        digest: recordDigest,
        kind: "real-minimized",
      },
    ],
  });
  return {
    permit,
    siteAddress: row.siteAddress,
    normalizedParcel: fields.normalizedParcel,
    normalizedAddress: normalizeTroyAddress(row.siteAddress),
    recordDigest,
    receiptDigest: provenance.receiptDigest,
    observedAt: provenance.observedAt,
    sourceDeclaredValue,
    workDescriptionDigest,
    applicantClassification: reportedName
      ? "reported-business-indicator"
      : "withheld-unclassified-applicant",
    rawDescriptionRetained: false as const,
  };
}
export type TroyIssuedObservation = ReturnType<typeof normalizeTroyIssued>;
export function matchTroyIssued(
  observation: TroyIssuedObservation,
  candidates: readonly CanonicalJoinCandidate[],
) {
  const byParcel = observation.normalizedParcel
    ? candidates.filter(
        (p) =>
          normalizeTroyPin(p.parcelPin ?? "") === observation.normalizedParcel,
      )
    : [];
  const unique = (rows: readonly CanonicalJoinCandidate[]) => [
    ...new Map(rows.map((p) => [p.propertyId, p])).values(),
  ];
  const exactParcel = unique(byParcel);
  const addressMatches = unique(
    candidates.filter(
      (p) =>
        normalizeTroyAddress(p.siteAddress) === observation.normalizedAddress &&
        /^TROY(?:\s|$)/i.test(p.city ?? ""),
    ),
  );
  const selected = exactParcel.length ? exactParcel : addressMatches;
  const basis = exactParcel.length
    ? "exact_normalized_parcel"
    : "exact_normalized_site_address";
  const knownAddresses = byParcel.filter(
    (p) => normalizeTroyAddress(p.siteAddress).length > 0,
  );
  const suffixOmitted = (address: string | null) => {
    const canonical = normalizeTroyAddress(address);
    const suffix =
      / (?:ST|RD|DR|AVE|CT|CIR|LN|BLVD|TRL|PL|PKWY|HWY|WAY|TER|RUN|CV|PATH|PT|SQ)$/;
    return (
      suffix.test(canonical) &&
      canonical.replace(suffix, "") === observation.normalizedAddress
    );
  };
  const sourceOmitsSuffix =
    exactParcel.length === 1 &&
    knownAddresses.some(
      (p) =>
        p.propertyId === exactParcel[0]!.propertyId &&
        suffixOmitted(p.siteAddress),
    );
  const agreement =
    exactParcel.length === 1 && knownAddresses.length > 0
      ? knownAddresses.some(
          (p) =>
            p.propertyId === exactParcel[0]!.propertyId &&
            (normalizeTroyAddress(p.siteAddress) ===
              observation.normalizedAddress ||
              suffixOmitted(p.siteAddress)),
        )
        ? "agrees"
        : "differs"
      : "unknown";
  const addressConflict = exactParcel.length === 1 && agreement === "differs";
  const evidence =
    selected.length === 1 && !addressConflict
      ? {
          basis,
          confidence: basis === "exact_normalized_parcel" ? "high" : "medium",
          score: basis === "exact_normalized_parcel" ? 0.99 : 0.9,
          candidateCount: 1,
          addressAgreement: agreement,
          caveats: [
            "A normalized current parcel/address match does not establish uninterrupted historical parcel identity.",
            ...(sourceOmitsSuffix
              ? [
                  "After a unique exact parcel match, the source site address agrees with the current address except for an omitted terminal street suffix. This relaxation is never used for address-only joins.",
                ]
              : []),
          ],
        }
      : {
          basis: selected.length ? "ambiguous" : "unmatched",
          confidence: "unknown",
          score: 0,
          candidateCount: selected.length,
          addressAgreement: addressConflict ? "differs" : "unknown",
          caveats: [
            addressConflict
              ? "Exact parcel candidate conflicts with the source site address; withheld for manual review without automatic property assignment."
              : selected.length
                ? "Multiple canonical candidates; no automatic property assignment."
                : "No unique exact parcel or Troy site-address match; record excluded from property staging.",
          ],
        };
  return {
    propertyId:
      selected.length === 1 && !addressConflict
        ? selected[0]!.propertyId
        : null,
    permit: PermitSchema.parse({
      ...observation.permit,
      matchEvidence: evidence,
    }) as Permit,
  };
}
