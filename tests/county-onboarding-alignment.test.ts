import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("maps every reference onboarding stage to implementation, evidence, deviations and blockers", async () => {
  const text = await readFile("docs/COUNTY_ONBOARDING_ALIGNMENT.md", "utf8");
  const rows = text.split("\n").filter((line) => /^\|\s*CO-\d{2}\b/.test(line));
  const ids = rows.map((line) => line.match(/CO-\d{2}/)![0]);
  expect(ids).toEqual(
    Array.from(
      { length: 16 },
      (_, i) => `CO-${String(i + 1).padStart(2, "0")}`,
    ),
  );
  for (const row of rows) {
    const cells = row
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      .map((cell) => cell.trim());
    expect(cells).toHaveLength(7);
    expect(cells.every((cell) => cell.length > 0)).toBe(true);
    expect(cells[3]).toMatch(/(?:history|evidence|operations)\//);
  }
  expect(text).toContain("PENDING");
  expect(text).toMatch(/Atlas/);
  expect(text).toMatch(/IPNS/);
  expect(text).toMatch(/Restate/);
});

it("states source-specific authority without turning runtime access into IPFS permission", async () => {
  const matrix = await readFile("docs/DATA_FIELD_AUTHORITY_MATRIX.md", "utf8");
  for (const authority of [
    "ORIGINAL_EXPLICIT",
    "REFERENCE_WORKFLOW",
    "SOURCE_TERMS_OR_LICENSE",
    "CREDENTIAL_OR_SECURITY",
    "OPERATIONAL_CHOICE",
    "UNSUPPORTED_OVERREACH",
  ])
    expect(matrix).toContain(authority);
  for (const field of ["NAME1", "NAME2", "POSTALADDRESS", "PHONE", "EMAIL"])
    expect(matrix).toContain(field);
  expect(matrix).toMatch(/Human/);
  expect(matrix).toMatch(/runtime/i);
  expect(matrix).toMatch(/IPFS/);
  const adr = await readFile(
    "docs/decisions/009-source-specific-data-boundaries.md",
    "utf8",
  );
  expect(adr).toMatch(/supersed/i);
  expect(adr).toMatch(/owner/i);
});
