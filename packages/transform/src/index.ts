import type { Property } from "../../contracts/src/index.ts";
export interface RoofEvidence {
  type: "roof_replacement" | "roof_repair" | "construction" | "built_year";
  status: "open" | "closed";
  date: string | null;
  year?: number;
  primary?: boolean;
}
function validDate(s: string): boolean {
  const d = new Date(s + "T00:00:00Z");
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(d.valueOf()) &&
    d.toISOString().slice(0, 10) === s
  );
}
export function deriveRoofAge(
  evidence: RoofEvidence[],
  asOf: string,
): Property["roof"] {
  if (!validDate(asOf)) throw new Error("Invalid as-of date");
  const dated = evidence
    .filter(
      (e) =>
        e.status === "closed" &&
        e.primary !== false &&
        ["roof_replacement", "construction"].includes(e.type) &&
        e.date &&
        validDate(e.date) &&
        e.date <= asOf,
    )
    .sort((a, b) => b.date!.localeCompare(a.date!));
  const anchor = dated[0];
  if (anchor?.date) {
    const end = new Date(asOf),
      start = new Date(anchor.date);
    let age = end.getUTCFullYear() - start.getUTCFullYear();
    if (end.toISOString().slice(5, 10) < start.toISOString().slice(5, 10))
      age--;
    return {
      ageYears: age,
      basis:
        anchor.type === "roof_replacement"
          ? "completed_roof"
          : "completed_construction",
      confidence: anchor.type === "roof_replacement" ? "high" : "medium",
      asOf,
      caveats: [
        "Estimate describes accepted evidence, not physical roof condition",
      ],
    };
  }
  const built = evidence.find(
    (e) =>
      e.type === "built_year" &&
      e.year &&
      e.year >= 1700 &&
      e.year <= Number(asOf.slice(0, 4)),
  );
  return built?.year
    ? {
        ageYears: Number(asOf.slice(0, 4)) - built.year,
        basis: "built_year",
        confidence: "low",
        asOf,
        caveats: ["Year precision only; later replacements may be unobserved"],
      }
    : {
        ageYears: null,
        basis: "unknown",
        confidence: "unknown",
        asOf,
        caveats: ["No accepted roof-age anchor"],
      };
}
