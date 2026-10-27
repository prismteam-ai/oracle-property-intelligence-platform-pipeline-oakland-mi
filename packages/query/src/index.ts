import { createHash } from "node:crypto";
import {
  CONTRACT_VERSION,
  DomainError,
  QuerySchema,
  SearchResponseSchema,
  type Property,
  type SearchResponse,
} from "../../contracts/src/index.ts";
const EARTH_RADIUS_METERS = 6371008.8;
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const r = Math.PI / 180,
    a = (lat2 - lat1) * r,
    b = (lng2 - lng1) * r;
  const h =
    Math.sin(a / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(b / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function openDays(openedAt: string | null, asOf: string): number | null {
  if (!openedAt || openedAt > asOf) return null;
  const start = Date.parse(openedAt),
    end = Date.parse(asOf);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    new Date(start).toISOString().slice(0, 10) !== openedAt
  )
    return null;
  return Math.floor((end - start) / 86400000);
}
export class SnapshotReader {
  constructor(
    readonly snapshotId: string,
    readonly properties: readonly Property[],
  ) {}
  detail(id: string, snapshotId: string): Property {
    if (snapshotId !== this.snapshotId)
      throw new DomainError(
        "SNAPSHOT_UNAVAILABLE",
        "Requested snapshot is unavailable",
      );
    const row = this.properties.find((p) => p.id === id);
    if (!row) throw new DomainError("INVALID_INPUT", "Property not found");
    return row;
  }
  search(input: unknown): SearchResponse {
    const parsed = QuerySchema.safeParse(input);
    if (!parsed.success)
      throw new DomainError(
        "INVALID_INPUT",
        "Search parameters are outside the contract",
      );
    const q = parsed.data;
    if (q.snapshotId !== this.snapshotId)
      throw new DomainError(
        "SNAPSHOT_UNAVAILABLE",
        "Requested snapshot is unavailable",
      );
    const { cursor, ...filter } = q,
      queryHash = createHash("sha256")
        .update(JSON.stringify(filter))
        .digest("hex");
    let offset = 0;
    if (cursor) {
      try {
        const c = JSON.parse(
          Buffer.from(cursor, "base64url").toString("utf8"),
        ) as { snapshotId: string; queryHash: string; offset: number };
        if (
          c.snapshotId !== q.snapshotId ||
          c.queryHash !== queryHash ||
          !Number.isSafeInteger(c.offset) ||
          c.offset < 0
        )
          throw new Error();
        offset = c.offset;
      } catch {
        throw new DomainError(
          "INVALID_CURSOR",
          "Cursor belongs to a different snapshot or filter",
        );
      }
    }
    const confidence = { high: 3, medium: 2, low: 1, unknown: 0 };
    const selected = this.properties
      .flatMap((p) => {
        if (!p.coordinates) return [];
        const distance = distanceMeters(
          q.lat,
          q.lng,
          p.coordinates.lat,
          p.coordinates.lng,
        );
        if (distance > q.radiusMeters) return [];
        if (
          q.roofMinAgeYears !== undefined &&
          (p.roof.ageYears === null
            ? !q.includeUnknown
            : p.roof.ageYears <= q.roofMinAgeYears)
        )
          return [];
        if (
          q.minConfidence !== "any" &&
          confidence[p.roof.confidence] < confidence[q.minConfidence]
        )
          return [];
        if (q.permitStatus !== "any" || q.minOpenDays > 0) {
          const permit = p.permits.some(
            (x) =>
              x.kind !== "other" &&
              (q.permitStatus === "any" || x.status === q.permitStatus) &&
              (q.minOpenDays === 0 ||
                (x.status === "open" &&
                  (openDays(x.openedAt, p.roof.asOf) ?? -1) >= q.minOpenDays)),
          );
          if (!permit) return [];
        }
        return [{ ...p, distanceMeters: distance }];
      })
      .sort((a, b) => {
        const priority = (p: Property) =>
          Math.max(
            -1,
            ...p.permits
              .filter((x) => x.kind !== "other" && x.status === "open")
              .map((x) => openDays(x.openedAt, p.roof.asOf) ?? -1),
          );
        return (
          (q.permitStatus === "open" || q.minOpenDays > 0
            ? priority(b) - priority(a)
            : 0) ||
          a.distanceMeters - b.distanceMeters ||
          a.id.localeCompare(b.id)
        );
      });
    const rows = selected.slice(offset, offset + q.limit),
      more = offset + rows.length < selected.length;
    return SearchResponseSchema.parse({
      contractVersion: CONTRACT_VERSION,
      snapshotId: this.snapshotId,
      queryHash,
      rows,
      total: selected.length,
      truncated: more,
      nextCursor: more
        ? Buffer.from(
            JSON.stringify({
              snapshotId: q.snapshotId,
              queryHash,
              offset: offset + rows.length,
            }),
          ).toString("base64url")
        : null,
      limitations: [
        "Synthetic fixture coverage is not county coverage",
        "Unknown roof evidence is excluded unless requested",
        "No public IPFS/Atlas publication or live model inference in P1",
      ],
    });
  }
}
