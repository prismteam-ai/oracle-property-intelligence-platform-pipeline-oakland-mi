import type { Property, Permit } from "../../contracts/src/index.ts";
export const AS_OF = "2026-10-26";
export const SNAPSHOT_ID = "demo-oakland-v1";
export function syntheticProperties(count = 48): Property[] {
  return Array.from({ length: count }, (_, i) => {
    const id = `SYN-${String(i + 1).padStart(4, "0")}`;
    const provenance = [
      {
        sourceId: "synthetic-oakland-fixture",
        recordId: id,
        observedAt: "2026-10-26T12:00:00.000Z",
        digest: `fixture-v1-${id}`,
        kind: "synthetic" as const,
      },
    ];
    const permits: Permit[] =
      i % 3 === 0
        ? []
        : [
            {
              id: `PERMIT-${id}`,
              status: i % 4 === 0 ? "closed" : "open",
              kind: i % 7 === 0 ? "roof_repair" : "roof_replacement",
              openedAt: i % 11 === 0 ? null : `${2014 + (i % 10)}-04-12`,
              closedAt: i % 4 === 0 ? "2025-05-20" : null,
              contractor: {
                reportedName:
                  i % 5 === 0
                    ? null
                    : `Synthetic Roofing Cooperative ${(i % 6) + 1}`,
                verifiedCompanyId:
                  i % 4 === 0 ? `SYN-COMPANY-${(i % 6) + 1}` : null,
                license: i % 4 === 0 ? `SYN-MI-LICENSE-${(i % 6) + 1}` : null,
                rating: i % 8 === 0 ? 90 : null,
              },
              provenance,
            },
          ];
    return {
      id,
      nativeId: i === 0 ? "A-01" : i === 1 ? "A01" : `SYN-PIN-${i + 1}`,
      parcelIds:
        i === 2
          ? ["SYN-PARCEL-2", "SYN-PARCEL-3"]
          : i === 3
            ? ["SYN-PARCEL-3"]
            : [`SYN-PARCEL-${i + 1}`],
      address: `Synthetic property ${i + 1} · ${["Pontiac area", "Waterford area", "Auburn Hills area", "Rochester area"][i % 4]}`,
      usage:
        i % 9 === 0
          ? "condominium"
          : i % 4 === 0
            ? "commercial"
            : "residential",
      coordinates:
        i === count - 1
          ? null
          : {
              lat: 42.66 + ((i % 8) - 3.5) * 0.009,
              lng: -83.29 + (Math.floor(i / 8) - 2.5) * 0.013,
            },
      roof: {
        ageYears: i % 9 === 0 ? null : 7 + (i % 30),
        basis:
          i % 9 === 0
            ? "unknown"
            : i % 3 === 0
              ? "completed_roof"
              : "built_year",
        confidence: i % 9 === 0 ? "unknown" : i % 3 === 0 ? "high" : "low",
        asOf: AS_OF,
        caveats:
          i % 3 === 0
            ? []
            : ["Built-year proxy; unobserved replacements may exist"],
      },
      permits,
      ownership: {
        lastTransferDate: i % 6 === 0 ? "2010-05-01" : null,
        historyCoverage: i % 6 === 0 ? "full" : "unknown",
        ownerRegion: i % 5 === 0 ? "out_of_area" : "unknown",
      },
      provenance,
    };
  });
}
