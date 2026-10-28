import { z } from "zod";
import path from "node:path";
export const FULL_SOURCE_COLUMNS = [
  "version",
  "source_id",
  "native_id",
  "public_snapshot_id",
  "source_schema_sha256",
  "source_record_json",
  "record_digest",
  "observed_at",
  "property_id",
] as const;
export const FULL_SOURCE_DEFINITIONS = {
  "county-parcels": {
    name: "county-parcels.parquet",
    sourceId: "official-oakland-tax-parcel-full-attributes",
    version: "county-full-attributes-v1",
    table: "private_county_parcels",
    maximum: 1_200_000,
    title: "Full official county parcel source intake",
    geometryIncluded: false,
    nativeIdPattern: "[0-9]{1,20}",
  },
  "county-addresses": {
    name: "county-addresses.parquet",
    sourceId: "official-oakland-site-address-full-attributes",
    version: "county-full-attributes-v1",
    table: "private_county_addresses",
    maximum: 1_200_000,
    title: "Full official county address source intake",
    geometryIncluded: false,
    nativeIdPattern: "[0-9]{1,20}",
  },
  "municipal-source": {
    name: "municipal-permit-source.parquet",
    sourceId: "official-independence-public-permits",
    version: "official-municipal-permits-full-v2",
    table: "private_municipal_permit_sources",
    maximum: 50_000,
    title: "Full official Independence permit source intake",
    geometryIncluded: true,
    nativeIdPattern: "[0-9]{1,20}",
  },
  "rochester-source": {
    name: "rochester-hills-building-reports.parquet",
    sourceId: "official-rochester-hills-building-permit-reports",
    version: "official-municipal-building-pdf-full-v2",
    table: "private_rochester_building_reports",
    maximum: 5000,
    title: "Full official Rochester Hills building report intake",
    geometryIncluded: false,
    nativeIdPattern: "[a-f0-9]{64}:row:[1-9][0-9]{0,5}",
  },
} as const;
export type FullSourceRole = keyof typeof FULL_SOURCE_DEFINITIONS;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const Config = z
  .object({
    role: z.enum([
      "county-parcels",
      "county-addresses",
      "municipal-source",
      "rochester-source",
    ]),
    file: z
      .string()
      .min(1)
      .refine((file) => path.isAbsolute(file)),
    sha256: hash,
    sourceSchemaSha256: hash,
    sourceRecordCount: z.number().int().nonnegative(),
    sourceValidationSha256: hash,
    sourceValidatedOffline: z.literal(true),
  })
  .strict();
export type FullSourceConfig = z.infer<typeof Config>;
export interface FullSourceAudit {
  role: FullSourceRole;
  sourceId: string;
  table: string;
  records: number;
  uniqueNativeIds: number;
  matched: number;
  unassigned: number;
  sourceSchemaSha256: string;
  sourceValidationSha256: string;
  sourceValidatedOffline: true;
  rawRowsReturned: false;
}
export function parseFullSourceConfigs(value: unknown): FullSourceConfig[] {
  try {
    const configs = z.array(Config).max(4).parse(value),
      roles = new Set<string>();
    for (const c of configs) {
      if (
        roles.has(c.role) ||
        c.sourceRecordCount > FULL_SOURCE_DEFINITIONS[c.role].maximum
      )
        throw new Error();
      roles.add(c.role);
    }
    if (configs.reduce((n, c) => n + c.sourceRecordCount, 0) > 1_200_000)
      throw new Error();
    return configs;
  } catch {
    throw new Error("Protected full-source configuration rejected");
  }
}
