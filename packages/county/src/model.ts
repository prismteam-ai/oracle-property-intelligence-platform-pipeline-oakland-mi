import { createHash } from "node:crypto";
import type { SourceFieldProfile } from "../../source-profiles/src/field-authority.ts";
export const TRANSFORM_VERSION = "oakland-public-v3";
export const OWNER_DERIVATION_VERSION = "postal-state-v2-exact-tokens";
/** Historical approved publication projection, not a ban on official runtime fields. */
export const PUBLIC_PARCEL_FIELDS = [
  "OBJECTID_12",
  "OBJECTID",
  "KEYPIN",
  "PIN",
  "REVISIONDATE",
  "CVTTAXCODE",
  "CVTTAXDESCRIPTION",
  "CLASSCODE",
  "SITEADDRESS",
  "SITECITY",
  "SITESTATE",
  "SITEZIP5",
] as const;
export const PUBLIC_ADDRESS_FIELDS = [
  "OBJECTID",
  "TYPE",
  "PIN",
  "SITESTREETADDRESS",
  "SITECITY",
  "SITESTATE",
  "SITEZIPCODE",
] as const;
export interface SourcePage {
  path: string;
  sha256: string;
  observedAt: string;
  index?: number;
  records?: number;
}
export interface SourceLayer {
  source: string;
  oidField: string;
  fields: string[];
  publicFields: string[];
  privateFields: string[];
  count: number;
  complete: boolean;
  objectIdsPath: string;
  pages: SourcePage[];
  schemaDigest?: string;
  sourceProfile?: SourceFieldProfile;
  sourceFieldClassificationDigest?: string;
}
export interface CountySourceManifest {
  version: string;
  layers: { parcel: SourceLayer; address: SourceLayer };
  termsDigest: string;
  fieldClassificationDigest: string;
  runs?: unknown[];
}
export function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + stableJson(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function nullableText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number")
    throw new Error("Unexpected non-scalar source attribute");
  return String(value).trim() || null;
}
export function sourceOid(value: unknown): string {
  const v = nullableText(value);
  if (!v || !/^\d{1,16}$/.test(v)) throw new Error("Invalid source object ID");
  return v;
}
export function sourceDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const d = new Date(typeof value === "number" ? value : String(value));
  return Number.isFinite(d.valueOf()) ? d.toISOString() : null;
}
export function officialPoint(
  geometry: unknown,
): { lat: number; lng: number } | null {
  if (!geometry || typeof geometry !== "object") return null;
  const g = geometry as { x?: unknown; y?: unknown };
  if (
    typeof g.x !== "number" ||
    typeof g.y !== "number" ||
    !Number.isFinite(g.x) ||
    !Number.isFinite(g.y) ||
    Math.abs(g.x) > 180 ||
    Math.abs(g.y) > 90
  )
    return null;
  return { lat: g.y, lng: g.x };
}
export type OwnerDerivative = {
  ownerRegion: "regional" | "out_of_area" | "unknown";
  locationClass:
    "local" | "in_county" | "in_state" | "out_of_state" | "unknown";
  siteAddressMatch: boolean | null;
  evidenceClass: "derived_deterministically" | "unknown";
};
/** Deterministic derivative of a source-observed postal string; no county inference from ZIP. */
export function deriveOwnerLocation(
  postal: unknown,
  siteAddress: unknown,
  siteCity: unknown,
): OwnerDerivative {
  const text = typeof postal === "string" ? postal.toUpperCase().trim() : "";
  const stateMatch = /\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*$/.exec(text);
  const state = stateMatch?.[1];
  const states = new Set(
    "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(
      " ",
    ),
  );
  const tokens = (value: unknown) =>
    typeof value === "string"
      ? (value.toUpperCase().match(/[A-Z0-9]+/g) ?? [])
      : [];
  const site = tokens(siteAddress),
    city = tokens(siteCity),
    prefix = stateMatch ? tokens(text.slice(0, stateMatch.index)) : [];
  const same = (a: string[], b: string[]) =>
    a.length === b.length && a.every((v, i) => v === b[i]);
  const cityMatches =
    city.length > 0 &&
    prefix.length > city.length &&
    same(prefix.slice(-city.length), city);
  const street = cityMatches ? prefix.slice(0, -city.length) : [];
  const match =
    stateMatch && site.length >= 2 && cityMatches
      ? state === "MI" && same(street, site)
      : null;
  if (!state || !states.has(state))
    return {
      ownerRegion: "unknown",
      locationClass: "unknown",
      siteAddressMatch: null,
      evidenceClass: "unknown",
    };
  return {
    ownerRegion: state === "MI" ? "regional" : "out_of_area",
    locationClass:
      state !== "MI" ? "out_of_state" : match ? "local" : "in_state",
    siteAddressMatch: match === null ? null : Boolean(match),
    evidenceClass: "derived_deterministically",
  };
}
export const COUNTY_LIMITATIONS = [
  "Complete selected GIS parcel/address layers are not a verified assessed-property denominator or complete permit history.",
  "Official Site Address points approximate parcel centers and may be stacked; they are not surveyed roof locations.",
  "Exact PIN joins retain all source-native records and all address associations, including unmatched address-only entities.",
  "Roof age, permits, ownership-transfer tenure, verified contractors/licenses and ratings remain unknown unless separately sourced.",
  "Official owner/mail observations are governed by their source-specific availability and terms; runtime display is separate from exact-byte approval for irreversible publication.",
  "A source revision timestamp is not an ownership-transfer or roof-installation date.",
];
export const PROPERTY_RELATION_SELECT_SQL = `SELECT id,source_id,native_id,pin,keypin,revision_date,jurisdiction_code,jurisdiction_name,class_code,address,city,state,postal_code,content_hash,observed_at FROM parcels UNION ALL SELECT 'oakland-address-'||a.native_id AS id,a.source_id,a.native_id,a.pin,NULL AS keypin,NULL AS revision_date,NULL AS jurisdiction_code,NULL AS jurisdiction_name,NULL AS class_code,a.address,a.city,a.state,a.postal_code,a.content_hash,a.observed_at FROM site_addresses a WHERE NOT EXISTS(SELECT 1 FROM parcels p WHERE p.pin IS NOT NULL AND p.pin=a.pin)`;
export const PROPERTY_VIEW_SQL =
  "CREATE VIEW properties AS " + PROPERTY_RELATION_SELECT_SQL;
export const PROPERTY_TABLE_SQL =
  "CREATE TABLE properties AS " + PROPERTY_RELATION_SELECT_SQL;
