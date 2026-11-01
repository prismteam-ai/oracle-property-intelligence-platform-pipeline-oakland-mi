import { resolveQueryPlace } from "../../places/src/index.ts";
import { needsPermitEvidence, hasMinimumVerifiedTenure } from "./predicates.ts";
import { createHash } from "node:crypto";
import {
  CONTRACT_VERSION,
  recordedDeedGapMatches,
  DomainError,
  QuerySchema,
  SearchResponseSchema,
  type Property,
  type SearchResponse,
} from "../../contracts/src/index.ts";
import {
  distanceMeters,
  reportedSaleOlderThan,
  compareQueryRows,
  permitMatchesQuery,
} from "../../contracts/src/query-predicates.ts";
export {
  distanceMeters,
  openDays,
  observedPermitStatus,
  observedPermitOpenDays,
  latestReportedSale,
  reportedSaleOlderThan,
} from "../../contracts/src/query-predicates.ts";
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
    const placeResolution = resolveQueryPlace(q);
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
          q.ownerRegion &&
          q.ownerRegion !== "any" &&
          p.ownership.ownerRegion !== q.ownerRegion
        )
          return [];
        if (
          q.minOwnershipYears !== undefined &&
          !hasMinimumVerifiedTenure(p, q.minOwnershipYears)
        )
          return [];
        if (
          q.minRecordedDeedGapYears !== undefined &&
          !(p.ownership.recordedTransferIndexObservations ?? []).some((row) =>
            recordedDeedGapMatches(row, q.minRecordedDeedGapYears!),
          )
        )
          return [];
        if (
          q.minReportedSaleAgeYears !== undefined &&
          !reportedSaleOlderThan(p, q.minReportedSaleAgeYears)
        )
          return [];
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
        if (
          q.permitStatus !== "any" ||
          q.minOpenDays > 0 ||
          needsPermitEvidence(q)
        ) {
          const permit = p.permits.some((x) =>
            permitMatchesQuery(x, q, p.roof.asOf),
          );
          if (!permit) return [];
        }
        return [{ ...p, distanceMeters: distance }];
      })
      .sort((a, b) => compareQueryRows(a, b, q));
    const rows = selected.slice(offset, offset + q.limit),
      more = offset + rows.length < selected.length;
    return SearchResponseSchema.parse({
      contractVersion: CONTRACT_VERSION,
      snapshotId: this.snapshotId,
      queryHash,
      placeResolution,
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
        ...(q.minReportedSaleAgeYears !== undefined
          ? [
              "Reported-sale age uses only the latest observed reported-sale event and snapshot date. Partial observations do not establish ownership tenure or rule out unobserved later sales; unknown dates are excluded.",
            ]
          : []),
      ],
    });
  }
}
