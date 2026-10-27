import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  SearchResponse,
  QueryInput,
} from "../../packages/contracts/src/index.ts";
const evidence = process.env.PRISM_BROWSER_EVIDENCE;
const requestedByPage = new WeakMap<Page, QueryInput>();
async function sourceIdentity() {
  return {
    tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
      encoding: "utf8",
    }).trim(),
    head: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    uiSha256: createHash("sha256")
      .update(await readFile("apps/pipeline-web/src/main.tsx"))
      .digest("hex"),
    contractSha256: createHash("sha256")
      .update(await readFile("packages/contracts/src/index.ts"))
      .digest("hex"),
  };
}
async function proof(page: Page, name: string, extra: unknown = {}) {
  if (!evidence) return;
  await mkdir(evidence, { recursive: true });
  const panel = page.locator(".query-panel");
  const health = (await (await page.request.get("/api/health")).json()) as {
    mode: string;
    contractVersion: string;
  };
  const applied = JSON.parse(
    (await page.locator(".query-proof pre").textContent()) ?? "{}",
  ) as { query: QueryInput | null };
  const metadata = await panel.evaluate((e) => ({
    ...(e as HTMLElement).dataset,
  }));
  await page.screenshot({
    path: path.join(evidence, `${name}.png`),
    fullPage: true,
  });
  await writeFile(
    path.join(evidence, `${name}.json`),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        source: await sourceIdentity(),
        testName: test.info().title,
        contractVersion: health.contractVersion,
        dataMode: health.mode,
        requestedQuery: requestedByPage.get(page) ?? null,
        appliedQuery: applied.query,
        url: page.url(),
        ...metadata,
        extra,
      },
      null,
      2,
    ),
  );
}
async function open(page: Page) {
  page.on("request", (request) => {
    if (request.url().endsWith("/api/search") && request.method() === "POST")
      requestedByPage.set(page, request.postDataJSON() as QueryInput);
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Query lab" }).click();
  await expect(page.locator(".query-panel")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator(".query-panel")).toHaveAttribute(
    "data-query-hash",
    /^[a-f0-9]{64}$/,
  );
}
const minDays = (page: Page) =>
  page
    .locator("label")
    .filter({ hasText: "Minimum open days" })
    .locator("input");
test("P2-001/002 changed and pending filters expose no stale rows/details; late response ignored", async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByRole("button", { name: /Inspect evidence for/ }).first(),
  ).toBeVisible();
  await page.evaluate(() => {
    const original = window.fetch.bind(window),
      w = window as unknown as {
        prismHeld?: boolean;
        prismRelease?: () => void;
        prismDelivered?: boolean;
      };
    window.fetch = async (input, init) => {
      const q = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      if (q.permitStatus === "open" && q.minOpenDays === 1827) {
        const response = await original(input, { ...init, signal: undefined });
        w.prismHeld = true;
        await new Promise<void>((resolve) => (w.prismRelease = resolve));
        w.prismDelivered = true;
        return response;
      }
      return original(input, init);
    };
  });
  await page.getByLabel("Permit status", { exact: true }).selectOption("open");
  await minDays(page).fill("1827");
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Inspect evidence for/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Run query", exact: true }).click();
  await expect(page.locator(".query-panel")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { prismHeld?: boolean }).prismHeld,
      ),
    )
    .toBe(true);
  await proof(page, "P2-001-after-pending-cleared", {
    oldRows: 0,
    oldInspectActions: 0,
  });
  await page
    .getByLabel("Permit status", { exact: true })
    .selectOption("closed");
  await minDays(page).fill("0");
  await page.getByRole("button", { name: "Run query", exact: true }).click();
  await expect(page.locator(".query-panel")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const hash = await page
    .locator(".query-panel")
    .getAttribute("data-query-hash");
  await page.evaluate(() =>
    (window as unknown as { prismRelease: () => void }).prismRelease(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { prismDelivered?: boolean }).prismDelivered,
      ),
    )
    .toBe(true);
  await page.waitForTimeout(150);
  await expect(page.locator(".query-panel")).toHaveAttribute(
    "data-query-hash",
    hash!,
  );
  await proof(page, "P2-001-after-late-response-guard", {
    ignoredEarlierGeneration: true,
    nonCancellableActualResponseDelivered: true,
  });
});
test("every visible row satisfies exact radius, roof and long-open roof-permit predicates", async ({
  page,
}) => {
  await open(page);
  await page
    .locator("label")
    .filter({ hasText: "Roof older than" })
    .locator("input")
    .fill("15");
  await page.getByLabel("Permit status", { exact: true }).selectOption("open");
  await minDays(page).fill("1827");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/search") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Run query", exact: true }).click();
  const r = await response;
  expect(r.ok()).toBe(true);
  const data = (await r.json()) as SearchResponse;
  const q = r.request().postDataJSON() as QueryInput;
  await expect(page.locator(".query-panel")).toHaveAttribute(
    "data-query-hash",
    data.queryHash,
  );
  const predicateFailures: string[] = [];
  for (const p of data.rows) {
    if (p.distanceMeters > q.radiusMeters + 0.001)
      predicateFailures.push(`${p.id}:radius`);
    if (p.roof.ageYears === null || p.roof.ageYears < 15)
      predicateFailures.push(`${p.id}:roof`);
    if (
      !p.permits.some(
        (x) =>
          x.kind !== "other" &&
          x.status === "open" &&
          x.openedAt !== null &&
          (Date.parse(p.roof.asOf) - Date.parse(x.openedAt)) / 86400000 >= 1827,
      )
    )
      predicateFailures.push(`${p.id}:permit`);
  }
  expect(predicateFailures).toEqual([]);
  await expect(page.locator("tbody tr")).toHaveCount(data.rows.length);
  if (data.rows.length) {
    await page
      .getByRole("button", { name: /Inspect evidence for/ })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Close evidence" }).click();
  }
  await proof(page, "P2-002-after-predicate-proof", {
    query: q,
    total: data.total,
    visibleRows: data.rows.length,
    predicateFailures,
  });
});
test("real default UI presents complete selected layers and source-bound details", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.PRISM_TEST_MODE !== "real",
    "Separate synthetic demonstration suite",
  );
  const health = (await (await request.get("/api/health")).json()) as {
    mode: string;
    snapshotId: string;
    snapshotDigest: string;
    count: number;
    addressCount: number;
    contractVersion: string;
  };
  expect(health.mode).toBe("real");
  expect(health.count).toBeGreaterThan(100000);
  expect(health.addressCount).toBeGreaterThan(100000);
  await open(page);
  await expect(page.locator(".mode-pill")).toContainText("REAL");
  await expect(page.locator(".query-panel")).toHaveAttribute(
    "data-snapshot-id",
    health.snapshotId,
  );
  await expect(page.locator(".query-panel")).toHaveAttribute(
    "data-snapshot-digest",
    health.snapshotDigest,
  );
  expect(await page.locator("tbody tr").count()).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: /Inspect evidence for/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Official source evidence",
  );
  await expect(page.getByRole("dialog")).toContainText("Unknown");
  await proof(page, "P2-real-detail", {
    health,
    assertion: "Real source lineage and unknown unsupported evidence displayed",
  });
  await page.getByRole("button", { name: "Close evidence" }).click();
  await page.getByRole("button", { name: "Run overview" }).click();
  await expect(page.locator(".metrics")).toContainText(
    health.count.toLocaleString(),
  );
  await expect(page.locator(".coverage")).toContainText(
    "Complete selected layers",
  );
  if (evidence) {
    await page.screenshot({
      path: path.join(evidence, "P2-real-coverage.png"),
      fullPage: true,
    });
    await writeFile(
      path.join(evidence, "P2-real-coverage.json"),
      JSON.stringify(
        {
          health,
          source: await sourceIdentity(),
          capturedAt: new Date().toISOString(),
          kind: "coverage overview; no active query rows",
          url: page.url(),
          snapshotId: health.snapshotId,
          snapshotDigest: health.snapshotDigest,
          queryHash: null,
          noActiveQueryReason:
            "Coverage overview displays snapshot-level evidence, not an active query.",
          testName: test.info().title,
          contractVersion: health.contractVersion,
          dataMode: health.mode,
          requestedQuery: null,
          appliedQuery: null,
        },
        null,
        2,
      ),
    );
  }
  await page.getByRole("button", { name: "Artifacts & lineage" }).click();
  await expect(page.locator(".artifact-panel")).toContainText(
    "parcels.parquet",
  );
  if (evidence) {
    await page.screenshot({
      path: path.join(evidence, "P2-real-artifacts.png"),
      fullPage: true,
    });
    await writeFile(
      path.join(evidence, "P2-real-artifacts.json"),
      JSON.stringify(
        {
          health,
          source: await sourceIdentity(),
          capturedAt: new Date().toISOString(),
          kind: "artifact manifest; no active query rows",
          url: page.url(),
          snapshotId: health.snapshotId,
          snapshotDigest: health.snapshotDigest,
          queryHash: null,
          noActiveQueryReason:
            "Artifact manifest displays snapshot-level evidence, not an active query.",
          testName: test.info().title,
          contractVersion: health.contractVersion,
          dataMode: health.mode,
          requestedQuery: null,
          appliedQuery: null,
        },
        null,
        2,
      ),
    );
  }
});

test("a late detail response cannot replace a newer selection or reopen after close", async ({
  page,
}) => {
  await open(page);
  const buttons = page.getByRole("button", { name: /Inspect evidence for/ });
  const first = await buttons.nth(0).getAttribute("aria-label"),
    second = await buttons.nth(1).getAttribute("aria-label");
  const firstId = first!.replace("Inspect evidence for ", ""),
    secondId = second!.replace("Inspect evidence for ", "");
  await page.evaluate((id) => {
    const native = window.fetch.bind(window),
      w = window as unknown as {
        prismDetailHeld?: boolean;
        prismReleaseDetail?: () => void;
        prismDetailDelivered?: boolean;
      };
    window.fetch = async (input, init) => {
      const u = new URL(
        input instanceof Request ? input.url : String(input),
        location.origin,
      );
      if (u.pathname === `/api/properties/${encodeURIComponent(id)}`) {
        const response = await native(input, { ...init, signal: undefined });
        w.prismDetailHeld = true;
        await new Promise<void>((r) => (w.prismReleaseDetail = r));
        w.prismDetailDelivered = true;
        return response;
      }
      return native(input, init);
    };
  }, firstId);
  await buttons.nth(0).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { prismDetailHeld?: boolean }).prismDetailHeld,
      ),
    )
    .toBe(true);
  await buttons.nth(1).click();
  await expect(page.getByRole("dialog")).toContainText(secondId);
  await page.evaluate(() =>
    (
      window as unknown as { prismReleaseDetail: () => void }
    ).prismReleaseDetail(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { prismDetailDelivered?: boolean })
            .prismDetailDelivered,
      ),
    )
    .toBe(true);
  await page.waitForTimeout(100);
  await expect(page.getByRole("dialog")).toContainText(secondId);
  await proof(page, "P2-detail-latest-selection", {
    lateDetail: firstId,
    currentDetail: secondId,
    nonCancellableActualResponseDelivered: true,
  });
  await page.getByRole("button", { name: "Close evidence" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => {
    const w = window as unknown as {
      prismDetailHeld?: boolean;
      prismDetailDelivered?: boolean;
    };
    w.prismDetailHeld = false;
    w.prismDetailDelivered = false;
  });
  await buttons.nth(0).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { prismDetailHeld?: boolean }).prismDetailHeld,
      ),
    )
    .toBe(true);
  await buttons.nth(1).click();
  await expect(page.getByRole("dialog")).toContainText(secondId);
  await page.getByRole("button", { name: "Close evidence" }).click();
  await page.evaluate(() =>
    (
      window as unknown as { prismReleaseDetail: () => void }
    ).prismReleaseDetail(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { prismDetailDelivered?: boolean })
            .prismDetailDelivered,
      ),
    )
    .toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("snapshot reload failure leaves no results or detail actions from the previous snapshot", async ({
  page,
}) => {
  await open(page);
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await page.route("**/api/properties/**", (route) =>
    route.fulfill({ status: 500, json: { message: "fixture detail failure" } }),
  );
  await page
    .getByRole("button", { name: /Inspect evidence for/ })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Retry connection" }),
  ).toBeVisible();
  const old = (await (
    await page.request.get("/api/health")
  ).json()) as HealthForTest;
  await page.route("**/api/health", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...old,
        snapshotId: "synthetic-next-snapshot",
        snapshotDigest: "b".repeat(64),
        buildId: "synthetic-build-b",
      },
    }),
  );
  await page.route("**/api/runs", (route) =>
    route.fulfill({
      status: 500,
      json: { message: "fixture metadata failure" },
    }),
  );
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Inspect evidence for/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".query-panel")).toHaveAttribute(
    "data-query-hash",
    "",
  );
  await expect(page.locator(".query-panel")).toHaveAttribute(
    "data-snapshot-digest",
    "",
  );
});
type HealthForTest = {
  snapshotId: string;
  snapshotDigest: string;
  buildId: string;
  mode: string;
  count: number;
};
