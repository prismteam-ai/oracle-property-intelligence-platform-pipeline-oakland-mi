import { test, expect } from "@playwright/test";
import {
  CONTRACT_VERSION,
  type QueryInput,
} from "../../packages/contracts/src/index.ts";
import {
  syntheticProperties,
  SNAPSHOT_ID,
} from "../../packages/test-support/src/fixtures.ts";
test("synthetic responses exercise real-view issued, contractor and reported-sale labels", async ({
  page,
}) => {
  const property = structuredClone(syntheticProperties()[0]!);
  property.permits = [
    {
      id: "SYN-ISSUED",
      permitNumber: "SYN-ISSUED",
      jurisdiction: "Synthetic municipality",
      issuedAt: "2011-01-01",
      status: "unknown",
      statusBasis: "issued_only",
      reportedStatus: null,
      reportedPermitType: "Res., Roof",
      proposedWorkScope: "Proposed roof work; completion not established.",
      kind: "roof_unspecified",
      openedAt: null,
      closedAt: null,
      contractor: {
        reportedName: "Synthetic Roofing LLC",
        verifiedCompanyId: null,
        license: "SYN-LICENSE",
        rating: null,
        licenseEvidence: {
          identifier: "SYN-LICENSE",
          type: "Residential Builder Company",
          status: "Issued",
          sourceUrl: "https://www.michigan.gov/lara",
          observedAt: "2026-10-28T01:00:00Z",
          matchBasis: "Synthetic exact business-name fixture",
          confidence: "medium",
        },
        ratingEvidence: {
          value: "A+",
          scale: "BBB",
          sourceUrl: "https://www.bbb.org/",
          observedAt: "2026-10-28T01:00:00Z",
          matchConfidence: "medium",
        },
      },
      matchEvidence: {
        basis: "exact_normalized_parcel",
        confidence: "high",
        score: 0.99,
        candidateCount: 1,
        addressAgreement: "agrees",
        caveats: ["Synthetic matching fixture."],
      },
      provenance: [
        {
          sourceId: "official-troy-issued-permits",
          recordId: "SYN-ISSUED",
          observedAt: "2026-10-28T01:00:00Z",
          digest: "a".repeat(64),
          kind: "synthetic",
        },
      ],
    },
  ];
  const requests: QueryInput[] = [];
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const json =
      pathname === "/api/health"
        ? {
            snapshotId: SNAPSHOT_ID,
            snapshotDigest: "a".repeat(64),
            mode: "real",
            dataMode: "protected-real",
            count: 1,
            addressCount: 1,
            buildId: "SYN-UI-TEST",
            accessMode: "local",
          }
        : pathname === "/api/runs" || pathname === "/api/coverage"
          ? []
          : pathname === "/api/manifest"
            ? { snapshotId: SNAPSHOT_ID }
            : pathname === "/api/search"
              ? (() => {
                  requests.push(route.request().postDataJSON());
                  return {
                    contractVersion: CONTRACT_VERSION,
                    snapshotId: SNAPSHOT_ID,
                    queryHash: "b".repeat(64),
                    rows: [{ ...property, distanceMeters: 1 }],
                    total: 1,
                    truncated: false,
                    nextCursor: null,
                    limitations: [],
                  };
                })()
              : pathname.startsWith("/api/properties/")
                ? property
                : {};
    await route.fulfill({ json });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Query lab/ }).click();
  await expect(page.locator(".query-panel")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator("tbody")).toContainText("Status unknown");
  await expect(page.locator("tbody")).not.toContainText("0 open");
  await page.getByLabel("Permit status").selectOption("unknown");
  await page.getByRole("button", { name: "Run query", exact: true }).click();
  await expect(page.locator(".query-panel")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(requests.at(-1)?.permitStatus).toBe("unknown");
  await expect(page.locator("tbody")).toContainText("Status unknown");
  await expect(page.locator("footer")).toContainText("Assessment");
  await page.getByLabel("Latest reported sale older than (years)").fill("10");
  await page.getByRole("button", { name: "Run query", exact: true }).click();
  await expect(page.locator(".query-panel")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(requests.at(-1)?.minReportedSaleAgeYears).toBe(10);
  expect(requests.at(-1)?.minOwnershipYears).toBeUndefined();
  await page
    .getByRole("button", { name: `Inspect evidence for ${property.id}` })
    .click();
  const drawer = page.locator(".drawer");
  await expect(drawer).toContainText(
    "Issuance does not establish that this permit remains open or that work was completed.",
  );
  await expect(drawer).toContainText("Issued 2011-01-01");
  await expect(drawer).toContainText("Status unknown (issued only)");
  await expect(drawer).toContainText("Opened unknown · Closed unknown");
  await expect(drawer).toContainText("Verified company: Unresolved");
  await expect(drawer).toContainText(
    "Business applicant (contractor role unverified): Synthetic Roofing LLC",
  );
  await expect(drawer).toContainText(
    "Residential Builder Company · Issued · medium match confidence",
  );
  await expect(drawer).toContainText("A+ on the BBB letter-grade scale");
  await expect(drawer).toContainText(
    "A BBB grade is not a numeric score or a license.",
  );
});
