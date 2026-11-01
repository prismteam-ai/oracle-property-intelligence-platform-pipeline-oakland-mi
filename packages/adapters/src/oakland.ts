import { PropertySchema, type Property } from "../../contracts/src/index.ts";
import { digest, nativeIdentity } from "../../identity/src/index.ts";
import { oaklandParcelProfile } from "../../source-profiles/src/index.ts";
export interface ArcGISFeature {
  attributes: Record<string, unknown>;
  geometry?: { x?: number; y?: number; rings?: number[][][] };
}
export function polygonCentroid(
  rings: number[][][],
): { lat: number; lng: number } | null {
  let doubleArea = 0,
    xsum = 0,
    ysum = 0;
  for (const ring of rings)
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i],
        b = ring[i + 1];
      if (!a || !b || a.length < 2 || b.length < 2) continue;
      const ax = a[0]!,
        ay = a[1]!,
        bx = b[0]!,
        by = b[1]!;
      if (
        Math.abs(ax) > 180 ||
        Math.abs(ay) > 90 ||
        Math.abs(bx) > 180 ||
        Math.abs(by) > 90
      )
        throw new Error("Expected WGS84 polygon coordinates");
      const cross = ax * by - bx * ay;
      doubleArea += cross;
      xsum += (ax + bx) * cross;
      ysum += (ay + by) * cross;
    }
  if (Math.abs(doubleArea) < 1e-14) return null;
  return { lng: xsum / (3 * doubleArea), lat: ysum / (3 * doubleArea) };
}
export function transformOaklandFeature(
  feature: ArcGISFeature,
  observedAt: string,
): Property {
  const unexpected = Object.keys(feature.attributes).filter(
    (k) => !oaklandParcelProfile.fields.some((f) => f === k),
  );
  if (unexpected.length)
    throw new Error(
      "Sample contains non-allowlisted fields; do not preserve or transform",
    );
  const a = feature.attributes;
  const native = String(a.KEYPIN ?? a.PIN ?? "");
  if (!native) throw new Error("Missing source-native parcel ID");
  // P1 requests outSR=4326 and returnCentroid=true or accepts point geometry only.
  const x = feature.geometry?.x,
    y = feature.geometry?.y;
  const coordinates = feature.geometry?.rings
    ? polygonCentroid(feature.geometry.rings)
    : typeof x === "number" &&
        typeof y === "number" &&
        x >= -180 &&
        x <= 180 &&
        y >= -90 &&
        y <= 90
      ? { lat: y, lng: x }
      : null;
  const provenance = [
    {
      sourceId: oaklandParcelProfile.sourceId,
      recordId: native,
      observedAt,
      digest: digest(feature),
      kind: "real-minimized" as const,
    },
  ];
  return PropertySchema.parse({
    id: nativeIdentity(oaklandParcelProfile.sourceId, native),
    nativeId: native,
    parcelIds: [native],
    address: String(a.SITEADDRESS ?? "Source situs unavailable"),
    usage: "unknown",
    coordinates,
    roof: {
      ageYears: null,
      basis: "unknown",
      confidence: "unknown",
      asOf: observedAt.slice(0, 10),
      caveats: ["Parcel sample does not establish roof age"],
    },
    permits: [],
    ownership: {
      lastTransferDate: null,
      historyCoverage: "unknown",
      ownerRegion: "unknown",
    },
    provenance,
  });
}
export const ADAPTER_REGISTRY = new Map([
  [
    "oakland",
    { profile: oaklandParcelProfile, transform: transformOaklandFeature },
  ],
]);
