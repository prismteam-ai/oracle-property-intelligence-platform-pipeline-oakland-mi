import { describe, it, expect } from "vitest";
import {
  normalizeTroyIssued,
  normalizeTroyPin,
  normalizeTroyAddress,
  troyBusinessName,
  troyIssuedDate,
  matchTroyIssued,
  classifyTroyPermit,
} from "../packages/county/src/troy.ts";
const raw = {
  permitNumber: "SYN-PERMIT-1",
  issuedDate: "Apr 15, 2011",
  siteAddress: "100 NORTH EXAMPLE ROAD",
  applicant: "Synthetic Roofing LLC",
  parcel: "88-20-01-001-001",
  reportedPermitType: "Res., Roof",
  description:
    "Tear off and replace roofing. Contact owner example@example.test",
  value: "$12,500.00",
};
const provenance = {
  observedAt: "2026-10-28T01:00:00Z",
  receiptDigest: "a".repeat(64),
};
describe("Troy issued-roof source boundary", () => {
  it("preserves issuance separately and never invents open status or installation", () => {
    const x = normalizeTroyIssued(raw, provenance);
    expect(x.permit).toMatchObject({
      issuedAt: "2011-04-15",
      status: "unknown",
      statusBasis: "issued_only",
      openedAt: null,
      closedAt: null,
      kind: "roof_replacement",
    });
    expect(x.permit.proposedWorkScope).toContain("completion not established");
    expect(JSON.stringify(x)).not.toContain("example@example.test");
    expect(x.sourceDeclaredValue).toBe(12500);
  });
  it("retains significant commercial re-roof work under its original broad type", () => {
    const p = normalizeTroyIssued(
      {
        ...raw,
        reportedPermitType: "Commercial, Add/Alter",
        description:
          "Re-roof 25,000 square feet of existing commercial roof; replace EPDM roofing membrane.",
      },
      provenance,
    );
    expect(p.permit).toMatchObject({
      reportedPermitType: "Commercial, Add/Alter",
      kind: "roof_replacement",
      status: "unknown",
      statusBasis: "issued_only",
    });
    expect(p.classificationBasis).toBe("description_explicit_roof_replacement");
  });
  it("retains incidental non-roof permit facts as other and rejects unexpected contact columns", () => {
    const p = normalizeTroyIssued(
      {
        ...raw,
        reportedPermitType: "Satellite/Antennas",
        description: "Install satellite antenna on existing roof.",
      },
      provenance,
    );
    expect(p.permit).toMatchObject({
      reportedPermitType: "Satellite/Antennas",
      kind: "other",
      statusBasis: "issued_only",
    });
    expect(p.classificationBasis).toBe("roof_mention_unclassified");
    expect(() =>
      normalizeTroyIssued(
        { ...raw, applicantPhone: "555-555-5555" },
        provenance,
      ),
    ).toThrow();
  });
  it("does not turn negated roofs, mounted equipment, or unrelated replacement into roofing predicates", () => {
    for (const description of [
      "Replace windows; no roof work included.",
      "Roof replacement not included.",
      "Install roof-mounted antenna.",
      "Replace rooftop air conditioning unit.",
      "Repair windows; existing roof to remain.",
      "This is not a roofing permit.",
    ]) {
      expect(
        classifyTroyPermit("Commercial, Add/Alter", description).kind,
      ).toBe("other");
    }
    expect(classifyTroyPermit("Res., Roof", "Replace windows").kind).toBe(
      "roof_unspecified",
    );
    expect(
      classifyTroyPermit(
        "Commercial, Add/Alter",
        "Replace windows, repair the existing roof.",
      ).kind,
    ).toBe("roof_repair");
    expect(
      classifyTroyPermit(
        "Commercial, Add/Alter",
        "Construct a new roof on addition.",
      ).kind,
    ).toBe("roof_unspecified");
    expect(
      classifyTroyPermit("Res., Roof", "No roof work included.").kind,
    ).toBe("other");
  });
  it("withholds unclassified people and contact strings while retaining clear reported business", () => {
    for (const name of [
      "Jane Example",
      "HOMEOWNER",
      "Example Roofing 555-555-5555",
      "Roofing owner@example.test",
    ])
      expect(troyBusinessName(name)).toBeNull();
    expect(troyBusinessName("Synthetic Roofing LLC")).toBe(
      "Synthetic Roofing LLC",
    );
  });
  it("keeps unspecified roof work distinct and rejects impossible/future dates", () => {
    expect(
      normalizeTroyIssued({ ...raw, description: "Work on roof" }, provenance)
        .permit.kind,
    ).toBe("roof_unspecified");
    expect(() => troyIssuedDate("Feb 30, 2020")).toThrow();
    expect(() =>
      normalizeTroyIssued({ ...raw, issuedDate: "Oct 29, 2026" }, provenance),
    ).toThrow();
  });
  it("normalizes only documented municipal PIN prefix and conservative address aliases", () => {
    expect(normalizeTroyPin(raw.parcel)).toBe("2001001001");
    expect(normalizeTroyPin("99-20-01-001-001")).toBeNull();
    expect(normalizeTroyAddress(raw.siteAddress)).toBe("100 N EXAMPLE RD");
  });
  it("quarantines an exact parcel candidate with conflicting address evidence", () => {
    const x = matchTroyIssued(normalizeTroyIssued(raw, provenance), [
      {
        propertyId: "SYN-P1",
        parcelPin: "20-01-001-001",
        siteAddress: "102 N EXAMPLE RD",
        city: "Troy",
      },
    ]);
    expect(x.propertyId).toBeNull();
    expect(x.permit.matchEvidence).toMatchObject({
      basis: "ambiguous",
      addressAgreement: "differs",
    });
  });
  it("accepts only a terminal omitted street suffix after a unique parcel match", () => {
    const observation = normalizeTroyIssued(
      { ...raw, siteAddress: "100 NORTH EXAMPLE" },
      provenance,
    );
    const candidate = {
      propertyId: "SYN-P1",
      parcelPin: "20-01-001-001",
      siteAddress: "100 N EXAMPLE RD",
      city: "Troy",
    };
    expect(matchTroyIssued(observation, [candidate])).toMatchObject({
      propertyId: "SYN-P1",
      permit: {
        matchEvidence: {
          addressAgreement: "agrees",
          basis: "exact_normalized_parcel",
        },
      },
    });
    expect(
      matchTroyIssued({ ...observation, normalizedParcel: null }, [candidate])
        .propertyId,
    ).toBeNull();
  });
  it("handles missing canonical representative addresses without inventing disagreement", () => {
    const x = matchTroyIssued(normalizeTroyIssued(raw, provenance), [
      {
        propertyId: "SYN-P1",
        parcelPin: "20-01-001-001",
        siteAddress: null,
        city: "Troy",
      },
    ]);
    expect(x.propertyId).toBe("SYN-P1");
    expect(x.permit.matchEvidence?.addressAgreement).toBe("unknown");
  });
  it("uses only a unique exact Troy address fallback and leaves duplicates ambiguous", () => {
    const obs = normalizeTroyIssued({ ...raw, parcel: "" }, provenance);
    const candidate = {
      propertyId: "SYN-P1",
      parcelPin: null,
      siteAddress: "100 N EXAMPLE RD",
      city: "Troy",
    };
    expect(matchTroyIssued(obs, [candidate]).propertyId).toBe("SYN-P1");
    expect(
      matchTroyIssued(obs, [candidate, { ...candidate, propertyId: "SYN-P2" }])
        .permit.matchEvidence?.basis,
    ).toBe("ambiguous");
    expect(
      matchTroyIssued(obs, [{ ...candidate, city: "Other city" }]).propertyId,
    ).toBeNull();
  });
});
