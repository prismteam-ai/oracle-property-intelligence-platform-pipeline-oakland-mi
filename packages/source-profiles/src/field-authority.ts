import { sha256, stableJson } from "../../county/src/model.ts";

export interface SourceFieldProfile {
  version: "source-field-authority-v1";
  sourceId: string;
  sourceUrl: string;
  sourceMetadataSha256: string;
  termsUrl: string;
  termsSha256: string;
  reviewedAt: string;
  fields: Record<
    string,
    {
      classification: "official_public" | "restricted_source" | "credential";
      exposed: boolean;
      acquisitionAllowed: boolean;
      runtimeAllowed: boolean;
      publication:
        "eligible_pending_human" | "source_terms_restricted" | "excluded";
    }
  >;
}

export const sourceFieldProfileDigest = (profile: SourceFieldProfile): string =>
  sha256(stableJson(profile));

/** Source/terms-bound field rules replace name-based owner/contact suppression. */
export function validateSourceFieldProfile(
  profile: SourceFieldProfile,
  expected: {
    sourceUrl: string;
    termsSha256: string;
    fieldClassificationDigest: string;
    requestedFields: readonly string[];
  },
): void {
  const hash = /^[a-f0-9]{64}$/;
  if (
    !profile ||
    profile.version !== "source-field-authority-v1" ||
    !profile.sourceId ||
    profile.sourceUrl !== expected.sourceUrl ||
    !hash.test(profile.sourceMetadataSha256) ||
    !hash.test(profile.termsSha256) ||
    profile.termsSha256 !== expected.termsSha256 ||
    !Number.isFinite(Date.parse(profile.reviewedAt)) ||
    sourceFieldProfileDigest(profile) !== expected.fieldClassificationDigest
  )
    throw new Error(
      "Source-specific field profile and exact terms binding required",
    );
  for (const value of [profile.sourceUrl, profile.termsUrl]) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash)
      throw new Error("Public source/terms URL required");
  }
  if (!profile.fields || !Object.keys(profile.fields).length)
    throw new Error("Source field classifications required");
  for (const [name, rule] of Object.entries(profile.fields)) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(name) ||
      !["official_public", "restricted_source", "credential"].includes(
        rule.classification,
      ) ||
      typeof rule.exposed !== "boolean" ||
      typeof rule.acquisitionAllowed !== "boolean" ||
      typeof rule.runtimeAllowed !== "boolean" ||
      ![
        "eligible_pending_human",
        "source_terms_restricted",
        "excluded",
      ].includes(rule.publication) ||
      (!rule.exposed && (rule.acquisitionAllowed || rule.runtimeAllowed)) ||
      (rule.classification === "credential" &&
        (rule.acquisitionAllowed ||
          rule.runtimeAllowed ||
          rule.publication !== "excluded")) ||
      (rule.classification === "restricted_source" &&
        rule.publication === "eligible_pending_human")
    )
      throw new Error("Inconsistent source-specific field classification");
  }
  if (
    !expected.requestedFields.length ||
    new Set(expected.requestedFields).size !==
      expected.requestedFields.length ||
    expected.requestedFields.some((field) => {
      const rule = profile.fields[field];
      return (
        !rule ||
        !rule.exposed ||
        !rule.acquisitionAllowed ||
        rule.classification === "credential"
      );
    })
  )
    throw new Error(
      "Requested field is absent, credential, or excluded by this source's terms",
    );
}

/** Candidate bytes only: eligibility does not authorize an irreversible upload. */
export function eligiblePublicationFields(
  profile: SourceFieldProfile,
): string[] {
  return Object.entries(profile.fields)
    .filter(
      ([, rule]) =>
        rule.classification === "official_public" &&
        rule.exposed &&
        rule.publication === "eligible_pending_human",
    )
    .map(([name]) => name)
    .sort();
}
