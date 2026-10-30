import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import {
  CONTRACT_VERSION,
  PropertySchema,
  QuerySchema,
  type Query,
} from "../../packages/contracts/src/index.ts";
import {
  compareQueryRows,
  distanceMeters,
  propertyMatchesQuery,
} from "../../packages/contracts/src/query-predicates.ts";
import { syntheticProperties } from "../../packages/test-support/src/fixtures.ts";

// Exercise the actual React application and its real-view markup with synthetic transport.
// Two known-age rows and one unknown row are NOT the admitted snapshot's 648/50 proof.
const SNAPSHOT =
  "synthetic-ui-00000000000000000000-protected-00000000000000000000";
const NOVI = { lat: 42.4810994939, lng: -83.4950218553 };
const fixtures = syntheticProperties(3).map((property, index) =>
  PropertySchema.parse({
    ...property,
    address: `Synthetic layout property ${index + 1}`,
    coordinates: { lat: NOVI.lat + index * 0.0001, lng: NOVI.lng },
    roof: {
      ...property.roof,
      ageYears: index === 2 ? null : index === 0 ? 20 : 30,
      basis: index === 2 ? "unknown" : "built_year",
      confidence: index === 2 ? "unknown" : "low",
      caveats: [
        "Synthetic building-year proxy fixture; not an installation date.",
      ],
      provenance: [],
    },
    permits: [],
  }),
);

async function openReact(page: Page, baseURL: string | undefined) {
  if (!baseURL) throw new Error("Explicit loopback baseURL required");
  const base = new URL(baseURL);
  if (
    base.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
  )
    throw new Error("Mobile fixture permits loopback only");
  const errors: string[] = [];
  const requested: Query[] = [];
  let currentHash = "";
  page.on("pageerror", () => errors.push("page-script-error"));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push("console-error");
  });
  page.on("requestfailed", () => errors.push("request-failed"));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push("http-error");
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base.origin) {
      errors.push("external-request-blocked");
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/health")
      return route.fulfill({
        json: {
          snapshotId: SNAPSHOT,
          snapshotDigest: "a".repeat(64),
          mode: "real",
          dataMode: "synthetic",
          count: fixtures.length,
          addressCount: fixtures.length,
          buildId: "synthetic-mobile-layout-regression",
          accessMode: "local",
          contractVersion: CONTRACT_VERSION,
        },
      });
    if (["/api/runs", "/api/coverage"].includes(url.pathname))
      return route.fulfill({ json: [] });
    if (url.pathname === "/api/manifest")
      return route.fulfill({ json: { snapshotId: SNAPSHOT } });
    if (url.pathname === "/api/search") {
      const query = QuerySchema.parse(route.request().postDataJSON());
      requested.push(query);
      currentHash = createHash("sha256")
        .update(JSON.stringify(query))
        .digest("hex");
      const rows = fixtures
        .filter((property) => propertyMatchesQuery(property, query))
        .map((property) => ({
          ...property,
          distanceMeters: distanceMeters(
            query.lat,
            query.lng,
            property.coordinates!.lat,
            property.coordinates!.lng,
          ),
        }))
        .sort((a, b) => compareQueryRows(a, b, query));
      return route.fulfill({
        json: {
          contractVersion: CONTRACT_VERSION,
          snapshotId: SNAPSHOT,
          queryHash: currentHash,
          rows,
          total: rows.length,
          truncated: false,
          nextCursor: null,
          limitations: [
            "Synthetic transport only; not admitted real-data counts.",
          ],
        },
      });
    }
    if (url.pathname.startsWith("/api/properties/")) {
      const id = decodeURIComponent(
        url.pathname.slice("/api/properties/".length),
      );
      const property = fixtures.find((row) => row.id === id);
      if (property && url.searchParams.get("snapshotId") === SNAPSHOT)
        return route.fulfill({ json: property });
    }
    errors.push("unexpected-api-route");
    return route.fulfill({
      status: 500,
      json: { message: "Unexpected fixture route" },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Query lab/ }).click();
  await expect(page.locator(".query-panel")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page
    .getByLabel("Center latitude", { exact: true })
    .fill(String(NOVI.lat));
  await page
    .getByLabel("Center longitude", { exact: true })
    .fill(String(NOVI.lng));
  await page.getByLabel("Roof older than (years)", { exact: true }).fill("15");
  await page.getByRole("button", { name: "Run query", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.locator(".query-panel")).toHaveAttribute(
    "data-query-hash",
    currentHash,
  );
  expect(requested.at(-1)).toMatchObject({
    snapshotId: SNAPSHOT,
    ...NOVI,
    radiusMeters: 8046.72,
    roofMinAgeYears: 15,
    includeUnknown: false,
    permitStatus: "any",
    minOpenDays: 0,
  });
  return { errors, requested, currentHash: () => currentHash };
}

async function layout(page: Page) {
  return page.locator(".query-panel .subtle-tag").evaluate((tag) => {
    const box = tag.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(tag);
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      fullIdentity: tag.textContent,
      tagClientWidth: tag.clientWidth,
      tagScrollWidth: tag.scrollWidth,
      tagBounds: {
        x: box.x,
        right: box.right,
        width: box.width,
        height: box.height,
      },
      textRects: Array.from(range.getClientRects(), (rect) => ({
        x: rect.x,
        right: rect.right,
      })),
      overflow: getComputedStyle(tag).overflow,
      textOverflow: getComputedStyle(tag).textOverflow,
      whiteSpace: getComputedStyle(tag).whiteSpace,
    };
  });
}

async function attachLayout(info: TestInfo, page: Page, stage: string) {
  const proof = {
    stage,
    transport: "SYNTHETIC_API_ACTUAL_REACT",
    real648MatchesProofClaimed: false,
    cssSha256: createHash("sha256")
      .update(await readFile("apps/pipeline-web/src/style.css"))
      .digest("hex"),
    layout: await layout(page),
  };
  await info.attach(stage, {
    body: JSON.stringify(proof, null, 2),
    contentType: "application/json",
  });
  return proof.layout;
}

for (const viewport of [
  { name: "mobile390", width: 390, height: 844, mobile: true },
  { name: "mobile360", width: 360, height: 800, mobile: true },
  { name: "desktop1440", width: 1440, height: 1000, mobile: false },
])
  test(`${viewport.name}: full identity, normal detail close/focus and stale query binding`, async ({
    browser,
    baseURL,
  }, info) => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
      serviceWorkers: "block",
    });
    try {
      const page = await context.newPage();
      const f = await openReact(page, baseURL);
      const measured = await attachLayout(info, page, "strict-query-layout");
      expect(measured.fullIdentity).toBe(SNAPSHOT);
      expect(measured.scrollWidth).toBeLessThanOrEqual(
        measured.clientWidth + 1,
      );
      expect(measured.tagScrollWidth).toBeLessThanOrEqual(
        measured.tagClientWidth + 1,
      );
      expect(measured.textOverflow).not.toBe("ellipsis");
      expect(measured.overflow).toBe("visible");
      expect(
        measured.textRects.every(
          (rect) => rect.x >= 0 && rect.right <= measured.clientWidth + 1,
        ),
      ).toBe(true);
      if (!viewport.mobile) expect(measured.whiteSpace).toBe("nowrap");

      const opener = page
        .getByRole("button", { name: /^Inspect evidence for / })
        .first();
      const dialog = page.getByRole("dialog");
      const close = page.getByRole("button", {
        name: "Close evidence",
        exact: true,
      });
      for (const action of viewport.mobile
        ? ["pointer", "touch", "escape"]
        : ["pointer", "escape"]) {
        await opener.click();
        await expect(dialog).toBeVisible();
        await expect(close).toBeFocused();
        if (action === "pointer") await close.click();
        else if (action === "touch") await close.tap();
        else await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
      }

      const oldHash = f.currentHash();
      await page
        .getByLabel("Roof older than (years)", { exact: true })
        .fill("25");
      await expect(page.locator("tbody tr")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /^Inspect evidence for / }),
      ).toHaveCount(0);
      await expect(dialog).toHaveCount(0);
      await expect(page.locator(".query-panel")).toHaveAttribute(
        "data-query-hash",
        "",
      );
      const cleared = JSON.parse(
        (await page.locator(".query-proof pre").textContent())!,
      );
      expect(cleared.query).toBeNull();
      expect(cleared.queryHash).toBeNull();
      await page
        .getByRole("button", { name: "Run query", exact: true })
        .click();
      await expect(page.locator("tbody tr")).toHaveCount(1);
      await expect(page.locator(".query-panel")).toHaveAttribute(
        "data-query-hash",
        f.currentHash(),
      );
      expect(f.currentHash()).not.toBe(oldHash);
      expect(f.requested.at(-1)?.roofMinAgeYears).toBe(25);
      const bound = JSON.parse(
        (await page.locator(".query-proof pre").textContent())!,
      );
      expect(bound.query.roofMinAgeYears).toBe(25);
      expect(bound.queryHash).toBe(f.currentHash());
      await attachLayout(info, page, "rerun-layout");
      expect(f.errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
