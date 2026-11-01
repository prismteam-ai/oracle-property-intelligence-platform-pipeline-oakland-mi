import {
  createOfficialParcelProfile,
  OFFICIAL_PARCEL_URL,
  type OfficialFieldCensus,
} from "../packages/county/src/official-parcel.ts";
import { sha256 } from "../packages/county/src/model.ts";
import type { FullSourceConfig } from "../packages/county/src/private-full-source.ts";
export const source: FullSourceConfig = {
  role: "county-parcels",
  file: "/synthetic/source.parquet",
  sha256: sha256("synthetic retained file"),
  sourceSchemaSha256: sha256("synthetic source schema"),
  sourceRecordCount: 3,
  sourceValidationSha256: sha256("synthetic source validation"),
  sourceValidatedOffline: true,
};
export const snapshot = "oakland-real-" + "a".repeat(20);
export const observedAt = "2026-10-28T03:18:00.000Z";
export function officialProfileFixture() {
  const census: OfficialFieldCensus = {
    endpoint: OFFICIAL_PARCEL_URL,
    sourceMetadata: {
      layerBodySha256: sha256("synthetic metadata"),
      completeFieldNames: [
        "OBJECTID_12",
        "PIN",
        "NAME1",
        "NAME2",
        "POSTALADDRESS",
        "SITEADDRESS",
        "SITECITY",
      ],
    },
    observedIntervalUtc: { closingCountFinishedAt: "2026-10-30T05:11:04.000Z" },
    currentPopulation: { closingTotal: 5 },
    fields: {
      NAME1: {
        exposed: true,
        sourceAvailability: "EXPOSED_BUT_NULL_OR_EMPTY",
        nonNullCount: 0,
        nonNullAndNotEmptyStringCount: 0,
      },
      NAME2: {
        exposed: true,
        sourceAvailability: "EXPOSED_BUT_NULL_OR_EMPTY",
        nonNullCount: 0,
        nonNullAndNotEmptyStringCount: 0,
      },
      POSTALADDRESS: {
        exposed: true,
        sourceAvailability: "AVAILABLE",
        nonNullCount: 4,
        nonNullAndNotEmptyStringCount: 4,
      },
      PHONE: { exposed: false, sourceAvailability: "NOT_IN_SOURCE" },
      EMAIL: { exposed: false, sourceAvailability: "NOT_IN_SOURCE" },
    },
  };
  return createOfficialParcelProfile({
    source,
    publicSnapshotId: snapshot,
    census,
    censusSha256: sha256("synthetic actual census receipt"),
    termsUrl: "https://official.invalid/terms",
    termsSha256: sha256("synthetic terms"),
  });
}
