import { test, expect, type Page } from "@playwright/test";
import {
  CONTRACT_VERSION,
  QuerySchema,
  type Query,
} from "../../packages/contracts/src/index.ts";

// Synthetic transport only: exercise the actual React form and native browser validation.
async function open(page: Page, baseURL: string | undefined) {
  if (!baseURL) throw new Error("Explicit project baseURL required");
  const base = new URL(baseURL);
  if (
    base.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
  )
    throw new Error("Only the configured loopback origin is permitted");
  const origin = base.origin;
  const requests: Query[] = [];
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    external.push("blocked external origin");
    await route.abort();
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      external.push("blocked external API origin");
      await route.abort();
      return;
    }
    const name = url.pathname;
    if (name === "/api/health")
      return route.fulfill({
        json: {
          snapshotId: "synthetic-coordinate-regression",
          snapshotDigest: "a".repeat(64),
          mode: "synthetic",
          count: 0,
          buildId: "synthetic-coordinate-regression",
          accessMode: "local",
        },
      });
    if (name === "/api/runs" || name === "/api/coverage")
      return route.fulfill({ json: [] });
    if (name === "/api/manifest")
      return route.fulfill({
        json: { snapshotId: "synthetic-coordinate-regression" },
      });
    if (name === "/api/search") {
      const q = QuerySchema.parse(route.request().postDataJSON());
      requests.push(q);
      return route.fulfill({
        json: {
          contractVersion: CONTRACT_VERSION,
          snapshotId: q.snapshotId,
          queryHash: String(requests.length).repeat(64),
          rows: [],
          total: 0,
          truncated: false,
          nextCursor: null,
          limitations: ["Synthetic coordinate regression only"],
        },
      });
    }
    throw new Error("Unexpected synthetic route");
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Query lab/ }).click();
  await expect(page.locator(".query-panel")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect.poll(() => requests.length).toBe(1);
  const latitude = page.getByLabel("Center latitude", { exact: true });
  const longitude = page.getByLabel("Center longitude", { exact: true });
  const submit = page.getByRole("button", { name: "Run query", exact: true });
  const valid = () =>
    latitude.evaluate((input) =>
      (input as HTMLInputElement).form!.checkValidity(),
    );
  const clean = () => {
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  };
  return { requests, latitude, longitude, submit, valid, clean };
}

test("coordinate form submits full finite precision without rounding", async ({
  page,
  baseURL,
}) => {
  const f = await open(page, baseURL);
  const lat = Number("42.12345678901234"),
    lng = Number("-83.23456789012345");
  await f.latitude.fill(String(lat));
  await f.longitude.fill(String(lng));
  expect(await f.valid()).toBe(true);
  await f.submit.click();
  await expect.poll(() => f.requests.length).toBe(2);
  expect(f.requests[1]!.lat).toBe(lat);
  expect(f.requests[1]!.lng).toBe(lng);
  expect(f.requests[1]!.radiusMeters).toBe(8046.72);
  await expect(page.locator(".query-panel")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator(".query-panel")).toHaveAttribute(
    "data-query-hash",
    "2".repeat(64),
  );
  const bound = JSON.parse(
    (await page.locator(".query-proof pre").textContent())!,
  ) as { query: Query };
  expect(bound.query.lat).toBe(lat);
  expect(bound.query.lng).toBe(lng);
  f.clean();
});

test("native coordinate bounds block every out-of-range direction before transport", async ({
  page,
  baseURL,
}) => {
  const f = await open(page, baseURL);
  for (const [lat, lng, field, flag] of [
    [-90.01, 0, "lat", "rangeUnderflow"],
    [90.01, 0, "lat", "rangeOverflow"],
    [0, -180.01, "lng", "rangeUnderflow"],
    [0, 180.01, "lng", "rangeOverflow"],
  ] as const) {
    await f.latitude.fill(String(lat));
    await f.longitude.fill(String(lng));
    const invalid = field === "lat" ? f.latitude : f.longitude;
    expect(
      await invalid.evaluate(
        (input, key) => (input as HTMLInputElement).validity[key],
        flag,
      ),
    ).toBe(true);
    expect(await f.valid()).toBe(false);
    await f.submit.click();
    expect(f.requests).toHaveLength(1);
  }
  f.clean();
});

test("legal coordinate endpoints remain valid and exact", async ({
  page,
  baseURL,
}) => {
  const f = await open(page, baseURL);
  for (const [lat, lng] of [
    [-90, -180],
    [90, 180],
  ]) {
    await f.latitude.fill(String(lat));
    await f.longitude.fill(String(lng));
    expect(await f.valid()).toBe(true);
    const previous = f.requests.length;
    await f.submit.click();
    await expect.poll(() => f.requests.length).toBe(previous + 1);
    expect(f.requests.at(-1)!.lat).toBe(lat);
    expect(f.requests.at(-1)!.lng).toBe(lng);
    await expect(page.locator(".query-panel")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  }
  f.clean();
});
