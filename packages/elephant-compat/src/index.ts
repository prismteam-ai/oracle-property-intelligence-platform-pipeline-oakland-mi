/** Local conversion of verified public ArcGIS captures, never Query DB exports. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const SOURCE_BASE =
  "https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer";
export const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
export type SourceRequest = {
  method: "GET";
  url: string;
  multiValueQueryString: Record<string, string[]>;
};
export type PublicFeature = {
  attributes: Record<string, unknown>;
  geometry?: { x?: unknown; y?: unknown };
};
export function verifyCapture(
  bytes: Uint8Array,
  expectedSha256: string,
  actualRequestUrl: string,
  expectedRequestSha256: string,
): { features: PublicFeature[]; sourceRequest: SourceRequest } {
  assert.equal(sha256(bytes), expectedSha256, "Source response hash mismatch");
  assert.equal(
    sha256(actualRequestUrl),
    expectedRequestSha256,
    "Source request hash mismatch",
  );
  const url = new URL(actualRequestUrl);
  assert(
    [SOURCE_BASE + "/0/query", SOURCE_BASE + "/1/query"].includes(
      url.origin + url.pathname,
    ),
    "Unapproved county source",
  );
  assert(!url.username && !url.password && !url.hash, "Unexpected credentials");
  const allowed = new Set([
    "f",
    "where",
    "resultRecordCount",
    "outFields",
    "returnGeometry",
    "orderByFields",
    "outSR",
  ]);
  for (const key of url.searchParams.keys())
    assert(allowed.has(key), "Unexpected source request parameter");
  const body = JSON.parse(Buffer.from(bytes).toString("utf8")) as {
    features?: PublicFeature[];
    error?: unknown;
    exceededTransferLimit?: boolean;
  };
  assert(
    !body.error && !body.exceededTransferLimit && Array.isArray(body.features),
    "Incomplete or failed source response",
  );
  return {
    features: body.features,
    sourceRequest: {
      method: "GET",
      url: url.origin + url.pathname,
      multiValueQueryString: Object.fromEntries(
        [...new Set(url.searchParams.keys())].map((key) => [
          key,
          url.searchParams.getAll(key),
        ]),
      ),
    },
  };
}
function nonblank(value: unknown, label: string): string {
  assert(typeof value === "string" && value.trim(), "Missing " + label);
  return value; // Preserve source parcel punctuation and leading zeros.
}
export function buildRealGroups(
  parcel: PublicFeature,
  parcelRequest: SourceRequest,
  address: PublicFeature,
  addressRequest: SourceRequest,
): Record<string, unknown> {
  const pin = nonblank(parcel.attributes.PIN, "parcel PIN");
  assert.equal(address.attributes.PIN, pin, "Exact source PIN join required");
  const addressId = address.attributes.OBJECTID;
  const parcelId = parcel.attributes.OBJECTID_12;
  assert(Number.isSafeInteger(addressId) && Number.isSafeInteger(parcelId));
  const street = nonblank(
    address.attributes.SITESTREETADDRESS,
    "original site address",
  );
  const lat = address.geometry?.y;
  const lon = address.geometry?.x;
  assert(
    typeof lat === "number" &&
      typeof lon === "number" &&
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180,
    "Actual source WGS84 point required",
  );
  return {
    "seed-data-group.json": {
      label: "Seed",
      relationships: {
        address_has_parcel: { "/": "./address-has-parcel.json" },
      },
    },
    "county-data-group.json": {
      label: "County",
      relationships: {
        address_has_geometry: { "/": "./address-has-geometry.json" },
      },
    },
    "parcel.json": {
      parcel_identifier: pin,
      request_identifier: String(parcelId),
      source_http_request: parcelRequest,
    },
    "address.json": {
      // Current Lexicon permits the original address without normalizing it.
      // county_name is optional and its enum omits Oakland. County/FIPS remain
      // in the separately generated Atlas page and exact capture provenance.
      unnormalized_address: street,
      request_identifier: String(addressId),
      source_http_request: addressRequest,
    },
    "geometry.json": {
      latitude: lat,
      longitude: lon,
      request_identifier: String(addressId),
      source_http_request: addressRequest,
    },
    "address-has-parcel.json": {
      from: { "/": "./address.json" },
      to: { "/": "./parcel.json" },
    },
    "address-has-geometry.json": {
      from: { "/": "./address.json" },
      to: { "/": "./geometry.json" },
    },
  };
}
