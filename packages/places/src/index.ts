import { z } from "zod";
import source from "./official-index.json" with { type: "json" };
import {
  DomainError,
  PlaceReferenceSchema,
  type PlaceReference,
  type QueryInput,
} from "../../contracts/src/index.ts";

const IndexSchema = z.object({
  version: z.literal("1"),
  sourceUrl: z.url(),
  observedAt: z.iso.datetime({ offset: true }),
  indexDigest: z.string().regex(/^[a-f0-9]{64}$/),
  places: z.array(z.record(z.string(), z.unknown())).min(1).max(200),
});
export type PlaceResolution =
  | { status: "resolved"; place: PlaceReference }
  | { status: "ambiguous"; candidates: PlaceReference[] }
  | {
      status: "outside-county" | "not-found" | "unavailable";
      reason: string;
    };

/** Normalization changes orthography, never the jurisdiction or municipality type. */
export function normalizePlaceName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[’‘]/g, "'")
    .replace(/[.,;:!?"()[\]]/g, " ")
    .replace(/[‐‑‒–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createPlaceResolver(input: unknown) {
  const parsed = IndexSchema.parse(input);
  const places = parsed.places.map((record) =>
    PlaceReferenceSchema.parse({
      ...record,
      sourceUrl: parsed.sourceUrl,
      observedAt: new Date(parsed.observedAt).toISOString(),
      indexDigest: parsed.indexDigest,
    }),
  );
  const byId = new Map<string, PlaceReference>();
  const byAlias = new Map<string, PlaceReference[]>();
  for (const place of places) {
    if (
      byId.has(place.placeId) ||
      place.stateFips !== "26" ||
      place.countyFips !== "125" ||
      (place.resolutionEligible && place.localFips === null)
    )
      throw new Error("Official place index identity or county is invalid");
    byId.set(place.placeId, place);
    for (const alias of new Set([place.name, ...place.aliases])) {
      const key = normalizePlaceName(alias);
      const list = byAlias.get(key) ?? [];
      if (!list.some((candidate) => candidate.placeId === place.placeId))
        list.push(place);
      byAlias.set(key, list);
    }
  }
  const resolve = (value: string): PlaceResolution => {
    if (!value.trim() || value.length > 200)
      return {
        status: "not-found",
        reason: "A bounded place name is required",
      };
    const key = normalizePlaceName(value);
    const matches = byAlias.get(key) ?? [];
    if (matches.length > 1)
      return { status: "ambiguous", candidates: [...matches] };
    const match = matches[0];
    if (match && !match.resolutionEligible)
      return {
        status: "unavailable",
        reason: match.limitations.join(" "),
      };
    if (match) return { status: "resolved", place: match };
    const county = /\bin\s+([a-z ]+)\s+county\b/.exec(key)?.[1];
    if (county && county !== "oakland")
      return {
        status: "outside-county",
        reason:
          "Only source-verified Oakland County, Michigan places are supported",
      };
    return {
      status: "not-found",
      reason:
        "No unambiguous eligible Oakland County alias matched. Name the city, village or township and Michigan explicitly when needed; no old map center was substituted.",
    };
  };
  return {
    indexDigest: parsed.indexDigest,
    sourceUrl: parsed.sourceUrl,
    observedAt: parsed.observedAt,
    stateFips: "26" as const,
    countyFips: "125" as const,
    places,
    resolve,
    get: (id: string) => byId.get(id),
  };
}

export const officialPlaceResolver = createPlaceResolver(source);
export const resolvePlace = officialPlaceResolver.resolve;

/** Named geometry is bound on both client and server; stale/tampered centers refuse. */
export function resolveQueryPlace(
  query: QueryInput,
): PlaceReference | undefined {
  if (!query.placeId && !query.placeIndexDigest) return undefined;
  if (!query.placeId || !query.placeIndexDigest)
    throw new DomainError(
      "INVALID_INPUT",
      "Place ID and index digest must be paired",
    );
  const place = officialPlaceResolver.get(query.placeId);
  if (
    !place ||
    !place.resolutionEligible ||
    query.placeIndexDigest !== officialPlaceResolver.indexDigest ||
    Math.abs(place.center.lat - query.lat) > 1e-8 ||
    Math.abs(place.center.lng - query.lng) > 1e-8
  )
    throw new DomainError(
      "INVALID_INPUT",
      "Named-place source, center or index binding is invalid; resolve the place again or explicitly choose a map pin",
    );
  return place;
}
