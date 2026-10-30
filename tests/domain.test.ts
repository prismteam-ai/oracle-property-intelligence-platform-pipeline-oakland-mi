import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  QuerySchema,
  PropertySchema,
} from "../packages/contracts/src/index.ts";
import {
  digest,
  nativeIdentity,
  safeArtifactKey,
  resolveCompany,
} from "../packages/identity/src/index.ts";
import { deriveRoofAge } from "../packages/transform/src/index.ts";
import {
  syntheticProperties,
  SNAPSHOT_ID,
} from "../packages/test-support/src/fixtures.ts";
import {
  SnapshotReader,
  distanceMeters,
  openDays,
} from "../packages/query/src/index.ts";
import { DuckSnapshot } from "../packages/query/src/duckdb.ts";
import { RunLedger } from "../packages/run-ledger/src/index.ts";
import { preserveReceipt } from "../packages/receipts/src/index.ts";
import { callTool } from "../packages/mcp-adapter/src/index.ts";
import {
  SourceAccessGuard,
  classifySourceResponse,
} from "../packages/source-profiles/src/index.ts";
import {
  transformOaklandFeature,
  polygonCentroid,
} from "../packages/adapters/src/oakland.ts";
import { dryManifest } from "../packages/publication/src/index.ts";
const query = {
  snapshotId: SNAPSHOT_ID,
  lat: 42.66,
  lng: -83.29,
  radiusMeters: 8046.72,
  limit: 5,
};
describe("contract and stable source-native identity", () => {
  test("does not collapse punctuation/leading zeros or property-parcel relationships", () => {
    expect(nativeIdentity("source", "A-01")).not.toBe(
      nativeIdentity("source", "A01"),
    );
    expect(nativeIdentity("source", "001")).not.toBe(
      nativeIdentity("source", "1"),
    );
    expect(safeArtifactKey("a/b")).not.toBe(safeArtifactKey("a?b"));
    const rows = syntheticProperties();
    expect(rows[2]!.parcelIds).toHaveLength(2);
    expect(rows[2]!.parcelIds).toContain(rows[3]!.parcelIds[0]);
  });
  test.each([
    { lat: 91 },
    { lng: -181 },
    { radiusMeters: 0 },
    { radiusMeters: Infinity },
    { roofMinAgeYears: -1 },
    { minOpenDays: -10 },
    { sql: "ATTACH database" },
  ])("rejects invalid/unknown query %j", (extra) => {
    expect(QuerySchema.safeParse({ ...query, ...extra }).success).toBe(false);
  });
  test("keeps contractor evidence official and temporally bounded", () => {
    expect(
      resolveCompany(
        [
          {
            companyId: "a",
            licenseId: "l",
            official: false,
            validFrom: "2020-01-01",
            validTo: null,
          },
        ],
        "2026-01-01",
      ).state,
    ).toBe("unresolved");
    expect(
      resolveCompany(
        [
          {
            companyId: "a",
            licenseId: "l",
            official: true,
            validFrom: "2020-01-01",
            validTo: "2022-01-01",
          },
        ],
        "2026-01-01",
      ).state,
    ).toBe("unresolved");
    expect(
      resolveCompany(
        ["a", "b"].map((companyId) => ({
          companyId,
          licenseId: "l",
          official: true,
          validFrom: "2020-01-01",
          validTo: null,
        })),
        "2026-01-01",
      ).state,
    ).toBe("ambiguous");
  });
});
describe("roof and permit chronology", () => {
  test("open, repair and impossible dates cannot reset roof", () => {
    const r = deriveRoofAge(
      [
        { type: "built_year", status: "closed", date: null, year: 2000 },
        { type: "roof_replacement", status: "open", date: "2025-01-01" },
        { type: "roof_repair", status: "closed", date: "2025-01-01" },
        { type: "roof_replacement", status: "closed", date: "2025-02-30" },
      ],
      "2026-10-26",
    );
    expect(r.ageYears).toBe(26);
    expect(r.confidence).toBe("low");
  });
  test("accepted primary replacement uses whole elapsed years", () => {
    expect(
      deriveRoofAge(
        [{ type: "roof_replacement", status: "closed", date: "2010-11-01" }],
        "2026-10-26",
      ).ageYears,
    ).toBe(15);
    expect(deriveRoofAge([], "2026-10-26").ageYears).toBeNull();
    expect(() => deriveRoofAge([], "invalid")).toThrow();
    expect(openDays(null, "2026-10-26")).toBeNull();
    expect(openDays("2027-01-01", "2026-10-26")).toBeNull();
    expect(openDays("2025-02-30", "2026-10-26")).toBeNull();
  });
});
describe("immutable receipt and durable run journal", () => {
  test("receipt writes are content addressed and immutable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "prism-receipt-"));
    try {
      const a = await preserveReceipt(
        root,
        "fixture",
        "body",
        "2026-01-01T00:00:00Z",
      );
      const b = await preserveReceipt(
        root,
        "fixture",
        "body",
        "2026-01-02T00:00:00Z",
      );
      expect(a.rawRef).toBe(b.rawRef);
      expect(a.bodyDigest).toBe(digest("body"));
      expect(await readFile(a.rawRef, "utf8")).toBe("body");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test("checkpoint resume, repeated run, changed content, tombstone and ready repair", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "prism-ledger-"));
    try {
      const l = new RunLedger(root, () => "2026-01-01T00:00:00Z");
      const items = [
        { nativeId: "a", content: { value: 1 } },
        { nativeId: "b", content: { value: 2 } },
        { nativeId: "c", content: { value: 3 } },
      ];
      await expect(l.run("first", items, { crashAfter: 1 })).rejects.toThrow(
        "interruption",
      );
      expect((await l.inspect()).runs[0]!.processed).toBe(1);
      const first = await l.run("first", items);
      expect(first.added).toBe(3);
      expect(first.state).toBe("complete");
      expect(await l.run("first", items)).toEqual(first);
      const marker = (await readdir(root)).find(
        (n) =>
          n.startsWith(
            safeArtifactKey(JSON.stringify(["synthetic-fixture", "a"])),
          ) && n.endsWith(".ready.json"),
      )!;
      await writeFile(path.join(root, marker), "corrupt");
      const second = await l.run(
        "second",
        [
          ...items.slice(0, 1),
          { nativeId: "b", content: { value: 4 } },
          { nativeId: "c", content: {}, tombstone: true },
        ],
        { transformVersion: "v1" },
      );
      expect(second).toMatchObject({
        added: 0,
        changed: 1,
        deleted: 1,
        unchanged: 1,
      });
      expect(
        JSON.parse(await readFile(path.join(root, marker), "utf8")).contentHash,
      ).toBe(digest([{ value: 1 }, "v1"]));
      expect(
        Object.values((await l.inspect()).records).map((r) => r.nativeId),
      ).toEqual(["a", "b"]);
      await expect(
        l.run("first", [{ nativeId: "a", content: { value: 9 } }]),
      ).rejects.toThrow("changed manifest");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
describe("bounded spatial snapshot query and DuckDB parity", () => {
  test("radius geometry identity and combined filters", () => {
    const data = syntheticProperties();
    const reader = new SnapshotReader(SNAPSHOT_ID, data);
    expect(reader.search({ ...query, limit: 200 }).total).toBe(47);
    const result = reader.search({
      ...query,
      roofMinAgeYears: 15,
      permitStatus: "open",
      minOpenDays: 1825,
      limit: 200,
    });
    expect(result.total).toBeGreaterThan(0);
    for (const p of result.rows) {
      expect(p.roof.ageYears).toBeGreaterThan(15);
      expect(
        p.permits.some(
          (x) =>
            x.kind !== "other" &&
            x.status === "open" &&
            (openDays(x.openedAt, p.roof.asOf) ?? -1) >= 1825,
        ),
      ).toBe(true);
      expect(p.distanceMeters).toBeLessThanOrEqual(query.radiusMeters);
    }
    expect(distanceMeters(42, -83, 42, -83)).toBe(0);
  });
  test("snapshot/cursor strictness and no SQL tool", () => {
    const reader = new SnapshotReader(SNAPSHOT_ID, syntheticProperties());
    const a = reader.search(query);
    expect(a.nextCursor).toBeTruthy();
    expect(() => reader.search({ ...query, snapshotId: "other" })).toThrow(
      "snapshot",
    );
    expect(() =>
      reader.search({ ...query, cursor: a.nextCursor, radiusMeters: 10 }),
    ).toThrow("Cursor");
    expect(() => reader.detail("SYN-0001", "other")).toThrow("snapshot");
    for (const tool of ["querySQL", "ATTACH", "readFile", "fetch", "sendEmail"])
      expect(() => callTool(reader, { tool, args: {} })).toThrow(
        "Only bounded evidence tools",
      );
  });
  test("property-based radius boundary and malformed cursor cases", () => {
    const reader = new SnapshotReader(SNAPSHOT_ID, syntheticProperties());
    for (let r = 500; r <= 10000; r += 500) {
      const result = reader.search({ ...query, radiusMeters: r, limit: 200 });
      expect(result.rows.every((p) => p.distanceMeters <= r)).toBe(true);
      expect(result.rows.length).toBe(result.total);
    }
    for (const cursor of ["{bad", "AA", "eyJvZmZzZXQiOi0xfQ"])
      expect(() => reader.search({ ...query, cursor })).toThrow("Cursor");
  });
  test("SQL query matches deterministic reference, pages and prioritization", async () => {
    const properties = syntheticProperties(),
      ref = new SnapshotReader(SNAPSHOT_ID, properties),
      db = await DuckSnapshot.create(SNAPSHOT_ID, properties);
    try {
      for (const filter of [
        {},
        { roofMinAgeYears: 15 },
        { permitStatus: "open" },
        { permitStatus: "open", roofMinAgeYears: 15, minOpenDays: 1825 },
        { minConfidence: "high" },
        { roofMinAgeYears: 0, includeUnknown: true },
      ]) {
        const q = { ...query, ...filter };
        const actual = await db.search(q),
          expected = ref.search(q);
        expect(actual.total).toBe(expected.total);
        expect(actual.rows.map((p) => p.id)).toEqual(
          expected.rows.map((p) => p.id),
        );
        if (actual.nextCursor) {
          const next = await db.search({ ...q, cursor: actual.nextCursor });
          expect(next.rows.map((p) => p.id)).toEqual(
            ref
              .search({ ...q, cursor: expected.nextCursor! })
              .rows.map((p) => p.id),
          );
        }
      }
    } finally {
      db.close();
    }
  });
  test("non-roofing permit cannot qualify", async () => {
    const row = syntheticProperties()[1]!;
    row.permits[0]!.kind = "other";
    const ref = new SnapshotReader(SNAPSHOT_ID, [row]),
      db = await DuckSnapshot.create(SNAPSHOT_ID, [row]);
    try {
      expect(ref.search({ ...query, permitStatus: "open" }).total).toBe(0);
      expect((await db.search({ ...query, permitStatus: "open" })).total).toBe(
        0,
      );
    } finally {
      db.close();
    }
  });
});
describe("source boundary, private adapter and dry publication", () => {
  test("403/captcha/2 successive429 and finite retries are stop states", () => {
    expect(classifySourceResponse(403, "")).toMatchObject({ state: "blocked" });
    expect(classifySourceResponse(200, "CAPTCHA")).toMatchObject({
      state: "blocked",
    });
    const guard = new SourceAccessGuard();
    expect(guard.observe(429, "", "12").retryAfterSeconds).toBe(12);
    expect(guard.observe(429, "").state).toBe("blocked");
    expect(guard.observe(200, "").state).toBe("blocked");
  });
  test("parcel adapter accepts profiled public fields and rejects unknown fields or missing identity", () => {
    expect(() =>
      transformOaklandFeature(
        { attributes: { KEYPIN: "synthetic", UNPROFILED_FIELD: "reject" } },
        "2026-10-26T00:00:00Z",
      ),
    ).toThrow("non-allowlisted");
    expect(() =>
      transformOaklandFeature(
        { attributes: { KEYPIN: "synthetic", NAME1: "Synthetic public name" } },
        "2026-10-26T00:00:00Z",
      ),
    ).not.toThrow();
    expect(() =>
      transformOaklandFeature({ attributes: {} }, "2026-10-26T00:00:00Z"),
    ).toThrow("Missing");
    const p = transformOaklandFeature(
      {
        attributes: { KEYPIN: "SYN-KEY", SITEADDRESS: "Synthetic shape" },
        geometry: {
          rings: [
            [
              [-83, 42],
              [-82, 42],
              [-82, 43],
              [-83, 43],
              [-83, 42],
            ],
          ],
        },
      },
      "2026-10-26T00:00:00Z",
    );
    expect(p.coordinates).toEqual({ lng: -82.5, lat: 42.5 });
    expect(p.roof.ageYears).toBeNull();
    expect(p.ownership.historyCoverage).toBe("unknown");
    expect(PropertySchema.safeParse(p).success).toBe(true);
    expect(
      polygonCentroid([
        [
          [0, 0],
          [0, 0],
        ],
      ]),
    ).toBeNull();
  });
  test("dry manifest has real measured bytes/hash but no invented CID", () => {
    const m = dryManifest(SNAPSHOT_ID, syntheticProperties());
    expect(m.publicationAuthorized).toBe(false);
    expect(m.items[0]!.cid).toBeNull();
    expect(m.items[0]!.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(m.ipfs.replicas).toBe(0);
  });
});

test("HTTP-date Retry-After is honored relative to injected clock", () => {
  const now = Date.parse("2026-10-27T00:00:00Z");
  expect(
    classifySourceResponse(429, "", "Tue, 27 Oct 2026 00:03:00 GMT", now)
      .retryAfterSeconds,
  ).toBe(180);
  const guard = new SourceAccessGuard(() => now);
  expect(
    guard.observe(429, "", "Tue, 27 Oct 2026 00:03:00 GMT").retryAfterSeconds,
  ).toBe(180);
});
