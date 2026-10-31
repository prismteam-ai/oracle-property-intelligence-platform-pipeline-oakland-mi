import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Permit } from "../packages/contracts/src/index.ts";
import {
  deriveIndependenceInlineEvidence,
  INDEPENDENCE_INLINE_EVIDENCE_VERSION,
} from "../packages/county/src/independence-inline-evidence.ts";
import { validateProtectedPermitRow } from "../packages/county/src/private-permits.ts";
import { sha256 } from "../packages/county/src/model.ts";

interface SourceRow extends Record<string, unknown> {
  native_id: string;
  source_id: string;
  property_id: string;
  record_digest: string;
  source_record_json: string;
  observed_at: string;
}
interface PermitRow extends Record<string, unknown> {
  native_id: string;
  source_id: string;
  property_id: string;
  record_digest: string;
  permit_json: string;
  public_snapshot_id: string;
  observed_at: string;
}
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/independence-inline-source.json", import.meta.url),
    "utf8",
  ),
) as {
  sourceRows: SourceRow[];
  legacyClosedCanonicalRow: PermitRow;
};
const closure = fixture.sourceRows.find((r) => r.native_id === "2623310")!;
const business = fixture.sourceRows.find((r) => r.native_id === "2622164")!;
const original = fixture.legacyClosedCanonicalRow;
const snapshot = original.public_snapshot_id;
function withPermit(change: (permit: Permit) => void): PermitRow {
  const row = structuredClone(original);
  const permit = JSON.parse(row.permit_json) as Permit;
  change(permit);
  row.permit_json = JSON.stringify(permit);
  return row;
}

describe("reviewed Independence inline official evidence", () => {
  it("binds the explicit permit closeout to the actual source and exact quote", () => {
    const before = structuredClone(closure);
    expect(deriveIndependenceInlineEvidence(closure)).toMatchObject({
      version: INDEPENDENCE_INLINE_EVIDENCE_VERSION,
      recordId: "2623310",
      permitNumber: "PB260514",
      propertyId: "oakland-parcel-444063",
      reportedStatus: "CLOSED",
      sourceField: "Work_Description",
      closeout: {
        date: "2026-06-09",
        quote:
          "PERMIT CLOSED OUT PER REQUEST OF CONTRACTOR APPROVED PER DM 06/09/2026",
        basis: "explicit_dated_permit_closeout_not_roof_completion",
      },
    });
    expect(closure).toEqual(before);
  });
  it("keeps the siding-note business separate from a verified job contractor", () => {
    const derived = deriveIndependenceInlineEvidence(business);
    expect(derived).toMatchObject({
      permitNumber: "PB250524",
      reportedStatus: "EXPIRED",
      mentionedBusiness: {
        name: "CRAFTSMAN EXTERIORS",
        quote:
          "9/15/25 CRAFTSMAN EXTERIORS SUBMITTED AN ADDITIONAL PROJECT FOR SIDING.",
        role: "business_mentioned_in_siding_note_job_contractor_unverified",
        licenseVerified: false,
        bbbRatingAvailable: false,
      },
    });
    expect(derived).not.toHaveProperty("contractor");
    expect(derived).not.toHaveProperty("closeout");
  });
  it("rejects modified source bytes even if the caller retains the old digest", () => {
    expect(() =>
      deriveIndependenceInlineEvidence({
        ...closure,
        source_record_json: closure.source_record_json.replace(
          "06/09/2026",
          "06/10/2026",
        ),
      }),
    ).toThrow("binding rejected");
  });
  it("does not accept an attacker-recomputed digest as the reviewed source", () => {
    const raw = closure.source_record_json.replace("06/09/2026", "06/10/2026");
    expect(() =>
      deriveIndependenceInlineEvidence({
        ...closure,
        source_record_json: raw,
        record_digest: sha256(raw),
      }),
    ).toThrow("binding rejected");
  });
  for (const override of [
    { source_id: "official-troy-issued-permits" },
    { property_id: "oakland-parcel-451882" },
    { observed_at: "2026-06-08T00:00:00.000Z" },
    { record_digest: "a".repeat(64) },
  ])
    it(`rejects transplantation or chronology change ${JSON.stringify(override)}`, () => {
      expect(() =>
        deriveIndependenceInlineEvidence({ ...closure, ...override }),
      ).toThrow("binding rejected");
    });
  it("does not generically promote HVAC names, photo dates or extensions", () => {
    const raw = JSON.stringify({
      attributes: {
        OBJECTID: 2632758,
        Status: "CLOSED",
        Work_Description:
          "ROOF-TOP HVAC INSTALLED BY NICHOLS HEATING & COOLING MAY2006; NEW CONTRACTOR DID NOT INSTALL. EXTENDED1/22/23. OPEN ROOF PHOTOS12/4/24.",
      },
    });
    expect(
      deriveIndependenceInlineEvidence({
        ...closure,
        native_id: "2632758",
        source_record_json: raw,
        record_digest: sha256(raw),
      }),
    ).toBeNull();
  });
});

describe("narrow canonical closeout admission", () => {
  it("preserves the V1 null-date row exactly", () => {
    const before = structuredClone(original);
    expect(
      validateProtectedPermitRow(original, snapshot).permit.closedAt,
    ).toBeNull();
    expect(original).toEqual(before);
  });
  it("admits only the source-bound closeout while leaving opening unknown", () => {
    const derived = deriveIndependenceInlineEvidence(closure)!;
    const row = withPermit((p) => {
      p.closedAt = derived.closeout!.date;
    });
    const result = validateProtectedPermitRow(row, snapshot);
    expect(result.permit).toMatchObject({
      status: "closed",
      statusBasis: "explicit_closed",
      openedAt: null,
      closedAt: "2026-06-09",
      contractor: { reportedName: null, license: null, rating: null },
    });
    expect(result.openDays).toBeNull();
  });
  for (const date of ["2026-05-26", "2026-06-10", "2027-01-01"])
    it(`rejects a different or out-of-window closeout ${date}`, () => {
      expect(() =>
        validateProtectedPermitRow(
          withPermit((p) => {
            p.closedAt = date;
          }),
          snapshot,
        ),
      ).toThrow();
    });
  for (const override of [
    { native_id: "2622164" },
    { record_digest: "a".repeat(64) },
    { property_id: "oakland-parcel-451882" },
    { observed_at: "2026-06-08T00:00:00.000Z" },
  ])
    it(`rejects canonical date transplantation ${JSON.stringify(override)}`, () => {
      const row = withPermit((p) => {
        p.closedAt = "2026-06-09";
      });
      expect(() =>
        validateProtectedPermitRow({ ...row, ...override }, snapshot),
      ).toThrow();
    });
  it("does not permit relabeling a source terminal status or copying a business into contractor", () => {
    for (const change of [
      (p: Permit) => {
        p.reportedStatus = "ISSUED";
        p.status = "open";
        p.statusBasis = "explicit_open";
      },
      (p: Permit) => {
        p.issuedAt = "2026-06-10";
      },
      (p: Permit) => {
        p.contractor.reportedName = "CRAFTSMAN EXTERIORS";
      },
    ]) {
      const row = withPermit((p) => {
        p.closedAt = "2026-06-09";
        change(p);
      });
      expect(() => validateProtectedPermitRow(row, snapshot)).toThrow();
    }
  });
});
