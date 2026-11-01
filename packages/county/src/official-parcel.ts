import {
  OfficialParcelObservationSchema,
  type OfficialParcelObservation,
} from "../../contracts/src/index.ts";
import {
  sourceFieldProfileDigest,
  validateSourceFieldProfile,
  type SourceFieldProfile,
} from "../../source-profiles/src/field-authority.ts";
import {
  deriveOwnerLocation,
  OWNER_DERIVATION_VERSION,
  sha256,
} from "./model.ts";
import type { FullSourceConfig } from "./private-full-source.ts";

export const OFFICIAL_PARCEL_URL =
  "https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/1";
export const OFFICIAL_OWNER_FIELDS = [
  "NAME1",
  "NAME2",
  "POSTALADDRESS",
] as const;
export interface OfficialParcelProfileEnvelope {
  version: "official-parcel-profile-v1";
  publicSnapshotId: string;
  sourceFileSha256: string;
  sourceSchemaSha256: string;
  sourceRecordCount: number;
  fieldClassificationDigest: string;
  profile: SourceFieldProfile;
  availability: {
    receiptSha256: string;
    observedAt: string;
    currentParcelRows: number;
    retainedRowsAreNotCurrentCensus: true;
    wholePopulationTrimmedNonEmptyCount: null;
    fields: Record<
      string,
      {
        state:
          | "AVAILABLE"
          | "EXPOSED_BUT_NULL_OR_EMPTY"
          | "ACCESS_BLOCKED"
          | "SOURCE_TERMS_RESTRICTED"
          | "NOT_IN_SOURCE";
        nonNullCount: number | null;
        nonEmptyStringCount: number | null;
      }
    >;
  };
}

/** Verify the exact held body that will be parsed; path validation alone is insufficient. */
export function parsePinnedOfficialParcelProfile(
  bytes: Uint8Array,
  expectedSha256: string | undefined,
): OfficialParcelProfileEnvelope {
  if (
    bytes.length > 1024 * 1024 ||
    !expectedSha256 ||
    !/^[a-f0-9]{64}$/.test(expectedSha256) ||
    sha256(bytes) !== expectedSha256
  )
    throw new Error("Official parcel profile body integrity required");
  return JSON.parse(
    Buffer.from(bytes).toString("utf8"),
  ) as OfficialParcelProfileEnvelope;
}

export interface OfficialFieldCensus {
  endpoint: string;
  sourceMetadata: { layerBodySha256: string; completeFieldNames: string[] };
  observedIntervalUtc: { closingCountFinishedAt: string };
  currentPopulation: { closingTotal: number };
  fields: Record<
    string,
    {
      exposed: boolean;
      sourceAvailability:
        | "AVAILABLE"
        | "EXPOSED_BUT_NULL_OR_EMPTY"
        | "ACCESS_BLOCKED"
        | "SOURCE_TERMS_RESTRICTED"
        | "NOT_IN_SOURCE";
      nonNullCount?: number;
      nonNullAndNotEmptyStringCount?: number;
    }
  >;
}

/** Metadata preparation only; no data acquisition or publication permission. */
export function createOfficialParcelProfile(options: {
  source: FullSourceConfig;
  publicSnapshotId: string;
  census: OfficialFieldCensus;
  censusSha256: string;
  termsUrl: string;
  termsSha256: string;
}): OfficialParcelProfileEnvelope {
  const c = options.census;
  if (c.endpoint !== OFFICIAL_PARCEL_URL)
    throw new Error("Exact official county source required");
  const fields: SourceFieldProfile["fields"] = {};
  for (const name of c.sourceMetadata.completeFieldNames.filter((name) =>
    /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(name),
  ))
    fields[name] = {
      classification: "official_public",
      exposed: true,
      acquisitionAllowed: true,
      runtimeAllowed: true,
      publication: "eligible_pending_human",
    };
  for (const name of ["PHONE", "EMAIL"])
    if (!fields[name])
      fields[name] = {
        classification: "official_public",
        exposed: false,
        acquisitionAllowed: false,
        runtimeAllowed: false,
        publication: "excluded",
      };
  const profile: SourceFieldProfile = {
    version: "source-field-authority-v1",
    sourceId: "official-oakland-tax-parcel-full-attributes",
    sourceUrl: OFFICIAL_PARCEL_URL,
    sourceMetadataSha256: c.sourceMetadata.layerBodySha256,
    termsUrl: options.termsUrl,
    termsSha256: options.termsSha256,
    reviewedAt: c.observedIntervalUtc.closingCountFinishedAt,
    fields,
  };
  const value: OfficialParcelProfileEnvelope = {
    version: "official-parcel-profile-v1",
    publicSnapshotId: options.publicSnapshotId,
    sourceFileSha256: options.source.sha256,
    sourceSchemaSha256: options.source.sourceSchemaSha256,
    sourceRecordCount: options.source.sourceRecordCount,
    fieldClassificationDigest: sourceFieldProfileDigest(profile),
    profile,
    availability: {
      receiptSha256: options.censusSha256,
      observedAt: c.observedIntervalUtc.closingCountFinishedAt,
      currentParcelRows: c.currentPopulation.closingTotal,
      retainedRowsAreNotCurrentCensus: true,
      wholePopulationTrimmedNonEmptyCount: null,
      fields: Object.fromEntries(
        [...OFFICIAL_OWNER_FIELDS, "PHONE", "EMAIL"].map((name) => {
          const field = c.fields[name];
          if (!field)
            throw new Error("All five requested field outcomes required");
          return [
            name,
            {
              state: field.sourceAvailability,
              nonNullCount: field.nonNullCount ?? null,
              nonEmptyStringCount: field.nonNullAndNotEmptyStringCount ?? null,
            },
          ];
        }),
      ),
    },
  };
  validateOfficialParcelProfile(
    value,
    options.source,
    options.publicSnapshotId,
  );
  return value;
}

export function validateOfficialParcelProfile(
  value: OfficialParcelProfileEnvelope,
  source: FullSourceConfig,
  publicSnapshotId: string,
): void {
  const hash = /^[a-f0-9]{64}$/;
  if (
    !value ||
    value.version !== "official-parcel-profile-v1" ||
    value.publicSnapshotId !== publicSnapshotId ||
    source.role !== "county-parcels" ||
    !hash.test(source.sha256) ||
    !hash.test(source.sourceSchemaSha256) ||
    !/^oakland-real-[a-f0-9]{20}$/.test(publicSnapshotId) ||
    !Number.isSafeInteger(source.sourceRecordCount) ||
    source.sourceRecordCount < 0 ||
    source.sourceRecordCount > 1_200_000 ||
    value.sourceFileSha256 !== source.sha256 ||
    value.sourceSchemaSha256 !== source.sourceSchemaSha256 ||
    value.sourceRecordCount !== source.sourceRecordCount ||
    value.profile.sourceId !== "official-oakland-tax-parcel-full-attributes"
  )
    throw new Error(
      "Official parcel profile must bind the retained source and snapshot",
    );
  validateSourceFieldProfile(value.profile, {
    sourceUrl: OFFICIAL_PARCEL_URL,
    termsSha256: value.profile.termsSha256,
    fieldClassificationDigest: value.fieldClassificationDigest,
    requestedFields: OFFICIAL_OWNER_FIELDS,
  });
  if (
    OFFICIAL_OWNER_FIELDS.some(
      (field) =>
        value.profile.fields[field]?.classification !== "official_public" ||
        !value.profile.fields[field]?.runtimeAllowed,
    )
  )
    throw new Error(
      "Official observation requires field-specific public runtime permission",
    );
  const a = value.availability;
  if (
    !a ||
    !hash.test(a.receiptSha256) ||
    !Number.isFinite(Date.parse(a.observedAt)) ||
    !Number.isSafeInteger(a.currentParcelRows) ||
    a.currentParcelRows < 1 ||
    a.currentParcelRows > 1_200_000 ||
    a.retainedRowsAreNotCurrentCensus !== true ||
    a.wholePopulationTrimmedNonEmptyCount !== null ||
    JSON.stringify(Object.keys(a.fields).sort()) !==
      JSON.stringify(["EMAIL", "NAME1", "NAME2", "PHONE", "POSTALADDRESS"])
  )
    throw new Error("Finite source availability evidence required");
  for (const field of Object.values(a.fields)) {
    if (
      ![
        "AVAILABLE",
        "EXPOSED_BUT_NULL_OR_EMPTY",
        "ACCESS_BLOCKED",
        "SOURCE_TERMS_RESTRICTED",
        "NOT_IN_SOURCE",
      ].includes(field.state) ||
      [field.nonNullCount, field.nonEmptyStringCount].some(
        (n) =>
          n !== null &&
          (!Number.isSafeInteger(n) || n < 0 || n > a.currentParcelRows),
      ) ||
      (field.nonNullCount !== null &&
        field.nonEmptyStringCount !== null &&
        field.nonEmptyStringCount > field.nonNullCount)
    )
      throw new Error("Invalid finite field availability counts");
  }
}

/** Exact strings and null/absence are retained; no name or mailing-address parsing. */
export function projectOfficialParcelObservation(
  row: Record<string, unknown>,
  envelope: OfficialParcelProfileEnvelope,
): OfficialParcelObservation {
  validateSourceFieldProfile(envelope.profile, {
    sourceUrl: OFFICIAL_PARCEL_URL,
    termsSha256: envelope.profile.termsSha256,
    fieldClassificationDigest: envelope.fieldClassificationDigest,
    requestedFields: OFFICIAL_OWNER_FIELDS,
  });
  if (
    OFFICIAL_OWNER_FIELDS.some(
      (field) =>
        envelope.profile.fields[field]?.classification !== "official_public" ||
        !envelope.profile.fields[field]?.runtimeAllowed,
    )
  )
    throw new Error(
      "Official observation requires field-specific public runtime permission",
    );
  const raw = String(row.source_record_json);
  if (Buffer.byteLength(raw) > 256 * 1024 || sha256(raw) !== row.record_digest)
    throw new Error("Official source record digest/size mismatch");
  const attributes = JSON.parse(raw) as Record<string, unknown>;
  if (
    String(attributes.OBJECTID_12 ?? attributes.OBJECTID) !== row.native_id ||
    row.property_id !== `oakland-parcel-${String(row.native_id)}`
  )
    throw new Error(
      "Official source native ID and canonical property association mismatch",
    );
  const read = (field: string): string | null => {
    const value = attributes[field];
    if (value === null || value === undefined) return null;
    if (typeof value !== "string")
      throw new Error(
        "Official owner field must retain its source string type",
      );
    return value;
  };
  const name1 = read("NAME1"),
    name2 = read("NAME2"),
    postal = read("POSTALADDRESS");
  const values = { NAME1: name1, NAME2: name2, POSTALADDRESS: postal };
  const state = (field: keyof typeof values) =>
    !Object.hasOwn(attributes, field)
      ? ("not_observed_in_retained_record" as const)
      : values[field]?.trim()
        ? ("observed_value" as const)
        : ("observed_null_or_empty" as const);
  return OfficialParcelObservationSchema.parse({
    canonicalPropertyId: row.property_id,
    sourceId: envelope.profile.sourceId,
    sourceUrl: envelope.profile.sourceUrl,
    nativeId: row.native_id,
    pin: attributes.PIN == null ? null : String(attributes.PIN),
    name1,
    name2,
    postalAddressAsObserved: postal,
    fieldAvailability: {
      NAME1: state("NAME1"),
      NAME2: state("NAME2"),
      POSTALADDRESS: state("POSTALADDRESS"),
    },
    observedAt: row.observed_at,
    recordSha256: row.record_digest,
    sourceMetadataSha256: envelope.profile.sourceMetadataSha256,
    termsSha256: envelope.profile.termsSha256,
    sourceProfileSha256: sourceFieldProfileDigest(envelope.profile),
    classification: "official_public",
    ownerLocation: {
      ...deriveOwnerLocation(
        postal,
        attributes.SITEADDRESS,
        attributes.SITECITY,
      ),
      basis: "observed_postal_state_and_exact_site_tokens",
      derivationVersion: OWNER_DERIVATION_VERSION,
      sourceRecordSha256: row.record_digest,
    },
    limitations: [
      "Source-reported name/mail observations are not verified legal ownership, residence, title, contractor role or continuous tenure.",
      "Mailing address is retained verbatim; no phone, email, name-part or address-component inference is made.",
      "The retained record's original observation time differs from the separately dated current field-availability census.",
    ],
  });
}
