import { it, expect } from "vitest";
import {
  syntheticProperties,
  SNAPSHOT_ID,
} from "../packages/test-support/src/fixtures.ts";
import {
  SnapshotReader,
  observedPermitOpenDays,
} from "../packages/query/src/index.ts";
import { DuckSnapshot } from "../packages/query/src/duckdb.ts";
import { protectedPermitOpenDays } from "../packages/county/src/private-permits.ts";
it("all readers freeze explicit-open duration at observed status and exclude issued-only contradictions", async () => {
  const template = structuredClone(syntheticProperties()[0]!);
  const original = syntheticProperties().flatMap((x) => x.permits)[0]!;
  const explicit = {
    ...original,
    id: "SYN-EXPLICIT",
    kind: "roof_repair" as const,
    status: "open" as const,
    statusBasis: "explicit_open" as const,
    openedAt: "2020-01-01",
    closedAt: null,
    statusObservedAt: "2020-01-11T14:00:00Z",
  };
  const issued = {
    ...explicit,
    id: "SYN-ISSUED",
    statusBasis: "issued_only" as const,
  };
  const rows = [
    {
      ...template,
      id: "SYN-P1",
      roof: { ...template.roof, asOf: "2026-10-27" },
      permits: [explicit],
    },
    {
      ...template,
      id: "SYN-P2",
      roof: { ...template.roof, asOf: "2026-10-27" },
      permits: [issued],
    },
  ];
  expect(observedPermitOpenDays(explicit, "2026-10-27")).toBe(10);
  expect(
    protectedPermitOpenDays(explicit, explicit.statusObservedAt.slice(0, 10)),
  ).toBe(10);
  expect(
    observedPermitOpenDays(
      { ...explicit, statusObservedAt: undefined },
      "2026-10-27",
    ),
  ).toBeNull();
  expect(observedPermitOpenDays(issued, "2026-10-27")).toBeNull();
  const reference = new SnapshotReader(SNAPSHOT_ID, rows),
    duck = await DuckSnapshot.create(SNAPSHOT_ID, rows);
  try {
    for (const days of [0, 10, 11, 1827]) {
      const q = {
        snapshotId: SNAPSHOT_ID,
        lat: template.coordinates!.lat,
        lng: template.coordinates!.lng,
        radiusMeters: 100,
        permitStatus: "open" as const,
        minOpenDays: days,
      };
      const a = reference.search(q),
        b = await duck.search(q);
      expect(b.total).toBe(a.total);
      expect(b.rows.map((x) => x.id)).toEqual(a.rows.map((x) => x.id));
      expect(a.total).toBe(days <= 10 ? 1 : 0);
    }
  } finally {
    duck.close();
  }
});
