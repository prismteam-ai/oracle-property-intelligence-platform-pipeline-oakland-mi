import { describe, it, expect } from "vitest";
import {
  SOURCE_BASE,
  sha256,
  verifyCapture,
  buildRealGroups,
  type PublicFeature,
} from "../packages/elephant-compat/src/index.ts";

describe("receipt-backed local Elephant conversion", () => {
  const url = SOURCE_BASE + "/1/query?f=json&where=OBJECTID_12%3D12";
  const body = Buffer.from(JSON.stringify({ features: [] }));
  const req = verifyCapture(body, sha256(body), url, sha256(url)).sourceRequest;
  const parcel: PublicFeature = {
    attributes: { PIN: "00-012-003", OBJECTID_12: 12 },
  };
  const address: PublicFeature = {
    attributes: {
      PIN: "00-012-003",
      OBJECTID: 34,
      SITESTREETADDRESS: "1 EXAMPLE ST",
      NAME1: "PRIVATE CANARY MUST NOT PROJECT",
    },
    geometry: { x: -83.1, y: 42.6 },
  };
  it("binds both exact captured request and response bytes", () => {
    expect(() => verifyCapture(body, "0".repeat(64), url, sha256(url))).toThrow(
      /response hash/,
    );
    expect(() =>
      verifyCapture(body, sha256(body), url + "0", sha256(url)),
    ).toThrow(/request hash/);
    const external = "https://example.org/query?f=json";
    expect(() =>
      verifyCapture(body, sha256(body), external, sha256(external)),
    ).toThrow(/source/);
    const token = url + "&token=canary";
    expect(() =>
      verifyCapture(body, sha256(body), token, sha256(token)),
    ).toThrow(/parameter/);
    const partial = Buffer.from(
      JSON.stringify({ features: [], exceededTransferLimit: true }),
    );
    expect(() =>
      verifyCapture(partial, sha256(partial), url, sha256(url)),
    ).toThrow(/Incomplete/);
  });
  it("retains real identity/geometry without fabricating source facts", () => {
    const files = buildRealGroups(parcel, req, address, req);
    expect(files["parcel.json"]).toMatchObject({
      parcel_identifier: "00-012-003",
      request_identifier: "12",
    });
    expect(files["geometry.json"]).toMatchObject({
      latitude: 42.6,
      longitude: -83.1,
    });
    const text = JSON.stringify(files);
    expect(text).not.toMatch(
      /PRIVATE CANARY|property_type|built_year|owner|Dallas/,
    );
    expect(files["address.json"]).not.toHaveProperty("county_name");
    expect(files["county-data-group.json"]).toMatchObject({ label: "County" });
    expect(files["seed-data-group.json"]).toMatchObject({
      relationships: {
        address_has_parcel: { "/": "./address-has-parcel.json" },
      },
    });
    expect(files["address-has-geometry.json"]).toEqual({
      from: { "/": "./address.json" },
      to: { "/": "./geometry.json" },
    });
  });
  it("rejects ambiguous substitutions, missing addresses and invented geometry", () => {
    expect(() =>
      buildRealGroups(
        parcel,
        req,
        { ...address, attributes: { PIN: "0012003" } },
        req,
      ),
    ).toThrow(/Exact/);
    expect(() =>
      buildRealGroups(parcel, req, { ...address, geometry: {} }, req),
    ).toThrow(/Actual source/);
    expect(() =>
      buildRealGroups(
        parcel,
        req,
        {
          ...address,
          attributes: { ...address.attributes, SITESTREETADDRESS: null },
        },
        req,
      ),
    ).toThrow(/Missing/);
  });
});
